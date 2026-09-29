"""Multi-camera video clip extractor for event triggers."""

import logging
from pathlib import Path
import subprocess
import tempfile
import time
from typing import Sequence

from apps.agent.src.buffer import CircularBufferManager
from apps.agent.src.models import (
    AgentConfig,
    CameraConfig,
    CaptureProfileConfig,
    ClipExtractionResult,
)

logger = logging.getLogger(__name__)

__all__ = ["ClipExtractor", "ClipExtractionResult"]


class ClipExtractor:
    """Extracts and stitches multi-camera video clips for event triggers."""

    def __init__(
        self,
        buffer_mgr: CircularBufferManager,
        output_dir: Path | str | None = None,
        config: AgentConfig | None = None,
    ):
        self.buffer_mgr = buffer_mgr
        self.config = config

        if output_dir is not None:
            self.output_dir = Path(output_dir)
        elif config and hasattr(config, "buffer_dir"):
            self.output_dir = Path(config.buffer_dir) / "clips"
        else:
            self.output_dir = Path("/tmp/clip-events")

        self.output_dir.mkdir(parents=True, exist_ok=True)

    def extract_event_clips(
        self,
        event_id: str,
        trigger_ts: float,
        profile: CaptureProfileConfig,
        cameras: Sequence[CameraConfig] | None = None,
    ) -> list[ClipExtractionResult]:
        """Compute capture window and extract clip for each camera in cameras.

        Returns a list of ClipExtractionResult for all cameras. If a camera has no
        segments or is offline, records status="CAMERA_UNAVAILABLE" without blocking
        or failing other cameras.
        """
        if cameras is not None:
            target_cameras = list(cameras)
        elif self.config and self.config.cameras:
            target_cameras = list(self.config.cameras)
        else:
            target_cameras = []

        window_start = trigger_ts - profile.seconds_before
        window_end = trigger_ts + profile.seconds_after
        target_duration = float(profile.seconds_before + profile.seconds_after)

        results: list[ClipExtractionResult] = []

        for cam in target_cameras:
            if not cam.is_active:
                logger.info("Camera %s is marked inactive; skipping extraction", cam.id)
                results.append(
                    ClipExtractionResult(
                        camera_id=cam.id,
                        status="CAMERA_UNAVAILABLE",
                        output_path=None,
                        duration=0.0,
                        error="Camera is inactive",
                    )
                )
                continue

            segments = self.buffer_mgr.get_segments_for_window(
                cam.id,
                window_start,
                window_end,
            )

            if not segments:
                logger.warning(
                    "No segments found for camera %s in window [%.2f, %.2f]",
                    cam.id,
                    window_start,
                    window_end,
                )
                results.append(
                    ClipExtractionResult(
                        camera_id=cam.id,
                        status="CAMERA_UNAVAILABLE",
                        output_path=None,
                        duration=0.0,
                        error="No segments available in buffer window",
                    )
                )
                continue

            # Calculate offset into first segment if known
            start_offset = 0.0
            if hasattr(self.buffer_mgr, "_segments") and isinstance(self.buffer_mgr._segments, dict):
                cam_segs = self.buffer_mgr._segments.get(cam.id, [])
                for s in cam_segs:
                    if getattr(s, "segment_path", None) == segments[0] or getattr(s, "path", None) == segments[0]:
                        if window_start > s.start_ts:
                            start_offset = window_start - s.start_ts
                        break

            output_filename = f"event_{event_id}_cam_{cam.id}.mp4"
            output_path = self.output_dir / output_filename

            try:
                self._run_ffmpeg_cut(
                    segments,
                    output_path,
                    start_offset,
                    target_duration,
                )
                if not output_path.exists():
                    raise RuntimeError(f"Expected output clip {output_path} does not exist after cut")

                results.append(
                    ClipExtractionResult(
                        camera_id=cam.id,
                        status="EXTRACTED",
                        output_path=output_path,
                        duration=target_duration,
                        error=None,
                    )
                )
            except Exception as exc:
                logger.exception("Failed to extract clip for camera %s", cam.id)
                results.append(
                    ClipExtractionResult(
                        camera_id=cam.id,
                        status="FAILED",
                        output_path=None,
                        duration=0.0,
                        error=str(exc),
                    )
                )

        return results

    def _run_ffmpeg_cut(
        self,
        inputs: list[Path],
        output_path: Path,
        start: float = 0.0,
        duration: float = 0.0,
    ) -> None:
        """Stitch and trim segments using FFmpeg CLI with copy/re-encode fallback."""
        if not inputs:
            raise ValueError("No input segments provided for FFmpeg cut")

        output_path.parent.mkdir(parents=True, exist_ok=True)
        manifest_file: Path | None = None

        try:
            if len(inputs) == 1:
                input_args = ["-ss", f"{start:.3f}", "-i", str(inputs[0].resolve())]
                if duration > 0:
                    input_args.extend(["-t", f"{duration:.3f}"])
            else:
                with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as f:
                    manifest_file = Path(f.name)
                    for seg in inputs:
                        escaped_path = str(seg.resolve()).replace("'", "'\\''")
                        f.write(f"file '{escaped_path}'\n")

                input_args = [
                    "-f", "concat",
                    "-safe", "0",
                    "-i", str(manifest_file.resolve()),
                    "-ss", f"{start:.3f}",
                ]
                if duration > 0:
                    input_args.extend(["-t", f"{duration:.3f}"])

            # Attempt 1: Fast stream copy
            cmd_copy = [
                "ffmpeg", "-y",
                *input_args,
                "-c", "copy",
                "-avoid_negative_ts", "make_zero",
                "-movflags", "+faststart",
                str(output_path.resolve()),
            ]

            try:
                subprocess.run(
                    cmd_copy,
                    check=True,
                    capture_output=True,
                )
                return
            except subprocess.CalledProcessError as copy_err:
                logger.warning(
                    "FFmpeg stream copy cut failed, attempting fallback re-encode: %s",
                    copy_err.stderr.decode("utf-8", errors="replace") if copy_err.stderr else str(copy_err),
                )

            # Attempt 2: Re-encode fallback with H.264 and AAC
            cmd_reencode = [
                "ffmpeg", "-y",
                *input_args,
                "-c:v", "libx264",
                "-preset", "ultrafast",
                "-pix_fmt", "yuv420p",
                "-c:a", "aac",
                "-movflags", "+faststart",
                str(output_path.resolve()),
            ]

            try:
                subprocess.run(
                    cmd_reencode,
                    check=True,
                    capture_output=True,
                )
            except subprocess.CalledProcessError as reencode_err:
                err_msg = (
                    reencode_err.stderr.decode("utf-8", errors="replace")
                    if reencode_err.stderr
                    else str(reencode_err)
                )
                raise RuntimeError(f"FFmpeg extraction failed (copy and re-encode failed): {err_msg}") from reencode_err

        finally:
            if manifest_file is not None and manifest_file.exists():
                try:
                    manifest_file.unlink()
                except OSError:
                    pass
