"""Sync & Resilient Upload Worker for field agent."""

import hashlib
import logging
from pathlib import Path
import threading
import time
from typing import Any

import httpx

from apps.agent.src.config import AgentConfig
from apps.agent.src.queue import ClipJob, EventQueueManager

logger = logging.getLogger(__name__)

__all__ = ["calculate_file_checksum", "UploadWorker"]


def calculate_file_checksum(file_path: Path | str, chunk_size: int = 65536) -> str:
    """Compute the SHA-256 checksum of a file by reading in chunks."""
    path = Path(file_path)
    if not path.is_file():
        raise FileNotFoundError(f"File not found: {path}")

    hasher = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(chunk_size):
            hasher.update(chunk)
    return hasher.hexdigest()


class UploadWorker:
    """Worker polling pending extracted clips and uploading them to central server with exponential backoff."""

    def __init__(
        self,
        queue_mgr: EventQueueManager,
        central_api_url: str | None = None,
        device_token: str | None = None,
        config: AgentConfig | None = None,
        retention_days: int | None = None,
        delete_after_upload: bool = False,
        timeout: float = 30.0,
        initial_backoff: float = 5.0,
        backoff_factor: float = 3.0,
        max_backoff: float = 300.0,
        client: httpx.Client | None = None,
    ):
        self.queue_mgr = queue_mgr
        self.config = config

        if config is not None:
            self.central_api_url = central_api_url or config.central_api_url
            self.device_token = device_token or config.device_token
            if retention_days is None and config.default_profile:
                self.retention_days = config.default_profile.retention_days
            else:
                self.retention_days = retention_days if retention_days is not None else 7
        else:
            self.central_api_url = central_api_url or ""
            self.device_token = device_token or ""
            self.retention_days = retention_days if retention_days is not None else 7

        self.delete_after_upload = delete_after_upload
        self.timeout = timeout
        self.initial_backoff = initial_backoff
        self.backoff_factor = backoff_factor
        self.max_backoff = max_backoff
        self.client = client

        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None

    def calculate_backoff(self, attempts: int) -> float:
        """Calculate exponential backoff seconds for retry attempt.

        For attempt 1: initial_backoff (e.g. 5s)
        For attempt 2: initial_backoff * factor (e.g. 15s)
        For attempt 3: initial_backoff * factor^2 (e.g. 45s)
        Capped at max_backoff (e.g. 300s).
        """
        if attempts <= 1:
            return min(self.max_backoff, float(self.initial_backoff))
        backoff = float(self.initial_backoff) * (float(self.backoff_factor) ** (attempts - 1))
        return min(self.max_backoff, backoff)

    def should_remove_local(self, job: ClipJob, file_path: Path) -> bool:
        """Evaluate if local retention policy permits removing the file after upload."""
        if self.delete_after_upload:
            return True

        if self.retention_days is not None:
            if self.retention_days <= 0:
                return True
            try:
                file_time = job.created_at or file_path.stat().st_mtime
            except OSError:
                file_time = time.time()
            age_seconds = time.time() - file_time
            if age_seconds >= (self.retention_days * 86400.0):
                return True

        return False

    def upload_job(self, job: ClipJob) -> bool:
        """Upload a single clip job to the central server.

        Returns True on successful upload, False otherwise.
        Never removes the local file unless central server acknowledges HTTP 200 and retention permits.
        """
        file_path = Path(job.file_path)
        if not file_path.is_file():
            attempts = job.attempts + 1
            backoff_seconds = self.calculate_backoff(attempts)
            err_msg = f"File not found: {file_path}"
            logger.error("Clip file %s missing on disk for job %s", file_path, job.clip_id)
            self.queue_mgr.mark_clip_failed(
                clip_id=job.clip_id,
                error=err_msg,
                attempts=attempts,
                backoff_seconds=backoff_seconds,
            )
            return False

        try:
            checksum = calculate_file_checksum(file_path)
            file_size = file_path.stat().st_size
        except Exception as exc:
            attempts = job.attempts + 1
            backoff_seconds = self.calculate_backoff(attempts)
            err_msg = f"Failed to compute file checksum: {exc}"
            logger.exception("Checksum computation error for clip %s: %s", job.clip_id, exc)
            self.queue_mgr.mark_clip_failed(
                clip_id=job.clip_id,
                error=err_msg,
                attempts=attempts,
                backoff_seconds=backoff_seconds,
            )
            return False

        upload_url = f"{self.central_api_url.rstrip('/')}/api/v1/clips/upload"
        headers = {
            "Authorization": f"Bearer {self.device_token}",
        }
        data = {
            "eventId": job.event_id,
            "cameraId": job.camera_id,
            "clipId": job.clip_id,
            "checksum": checksum,
            "duration": str(job.duration),
            "fileSize": str(file_size),
            "event_id": job.event_id,
            "camera_id": job.camera_id,
            "clip_id": job.clip_id,
            "sha256": checksum,
            "file_size": str(file_size),
        }

        post_fn = self.client.post if self.client is not None else httpx.post
        put_fn = self.client.put if self.client is not None else httpx.put

        try:
            with open(file_path, "rb") as f:
                files = {"file": (file_path.name, f, "video/mp4")}
                response = post_fn(
                    upload_url,
                    headers=headers,
                    data=data,
                    files=files,
                    timeout=self.timeout,
                )

            if response.status_code != 200:
                raise RuntimeError(f"HTTP {response.status_code}: {response.text}")

            # Check if response specifies a presigned upload URL to S3
            try:
                resp_json = response.json()
            except Exception:
                resp_json = {}

            if isinstance(resp_json, dict) and any(
                k in resp_json for k in ("upload_url", "uploadUrl", "presignedUrl")
            ):
                put_url = (
                    resp_json.get("upload_url")
                    or resp_json.get("uploadUrl")
                    or resp_json.get("presignedUrl")
                )
                with open(file_path, "rb") as pf:
                    put_resp = put_fn(
                        put_url,
                        content=pf.read(),
                        headers={"Content-Type": "video/mp4"},
                        timeout=self.timeout,
                    )
                if put_resp.status_code not in (200, 204):
                    raise RuntimeError(f"Presigned S3 PUT failed: HTTP {put_resp.status_code}")

                # Confirm upload to central server
                confirm_url = f"{self.central_api_url.rstrip('/')}/api/v1/clips/confirm"
                confirm_resp = post_fn(
                    confirm_url,
                    headers=headers,
                    json={
                        "eventId": job.event_id,
                        "cameraId": job.camera_id,
                        "clipId": job.clip_id,
                        "checksum": checksum,
                    },
                    timeout=self.timeout,
                )
                if confirm_resp.status_code != 200:
                    raise RuntimeError(f"Confirmation failed: HTTP {confirm_resp.status_code}")

        except Exception as exc:
            attempts = job.attempts + 1
            backoff_seconds = self.calculate_backoff(attempts)
            logger.warning(
                "Upload failed for clip %s (attempt %d): %s. Next retry in %.1fs",
                job.clip_id,
                attempts,
                exc,
                backoff_seconds,
            )
            # Local file MUST NOT be deleted on error
            self.queue_mgr.mark_clip_failed(
                clip_id=job.clip_id,
                error=str(exc),
                attempts=attempts,
                backoff_seconds=backoff_seconds,
            )
            return False

        # Mark successfully uploaded
        self.queue_mgr.mark_clip_uploaded(clip_id=job.clip_id, sha256=checksum)
        logger.info("Successfully uploaded clip %s with checksum %s", job.clip_id, checksum)

        # Only remove local file if local retention policy permits
        if self.should_remove_local(job, file_path):
            try:
                file_path.unlink(missing_ok=True)
                logger.info("Removed local clip %s according to retention policy", file_path)
            except Exception as ex:
                logger.warning("Failed to delete local clip %s: %s", file_path, ex)

        return True

    def process_pending_queue_once(self) -> int:
        """Poll and upload pending clips ready for upload.

        Returns count of successfully uploaded clips.
        """
        pending_jobs = self.queue_mgr.get_pending_clips()
        now = time.time()
        uploaded_count = 0

        for job in pending_jobs:
            if job.status == "FAILED" and job.next_retry_at > now:
                continue
            if job.status == "PROCESSING":
                continue

            self.queue_mgr.mark_clip_processing(job.clip_id)
            if self.upload_job(job):
                uploaded_count += 1

        return uploaded_count

    def run_loop(self, poll_interval: float = 2.0) -> None:
        """Run continuous polling loop until stopped."""
        logger.info("UploadWorker poll loop started (interval=%.1fs)", poll_interval)
        while not self._stop_event.is_set():
            try:
                self.process_pending_queue_once()
            except Exception as exc:
                logger.exception("Error in UploadWorker poll cycle: %s", exc)
            self._stop_event.wait(timeout=poll_interval)
        logger.info("UploadWorker poll loop stopped")

    def start(self, poll_interval: float = 2.0) -> None:
        """Start worker in a background thread."""
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self.run_loop,
            args=(poll_interval,),
            daemon=True,
            name="UploadWorkerThread",
        )
        self._thread.start()

    def stop(self, timeout: float = 5.0) -> None:
        """Signal worker to stop and wait for thread to terminate."""
        self._stop_event.set()
        if self._thread is not None and self._thread.is_alive():
            self._thread.join(timeout=timeout)
