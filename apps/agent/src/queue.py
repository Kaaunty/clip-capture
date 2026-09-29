"""Queue and event management for local clip ingestion and state tracking."""

import logging
import time
import uuid
from typing import Any, Sequence

from pydantic import BaseModel, Field

from apps.agent.src.config import AgentConfig
from apps.agent.src.db import LocalQueueDB
from apps.agent.src.extractor import ClipExtractor

logger = logging.getLogger(__name__)


class DuplicateTriggerError(Exception):
    """Raised when a trigger command is rejected as duplicate."""

    def __init__(self, message: str = "Duplicate trigger rejected", existing_event_id: str | None = None):
        super().__init__(message)
        self.existing_event_id = existing_event_id


class ClipJob(BaseModel):
    """Persistent job state for an individual camera clip extraction & upload."""

    clip_id: str
    event_id: str
    camera_id: str
    file_path: str
    duration: float = 0.0
    status: str = "EXTRACTED"  # QUEUED, PROCESSING, EXTRACTED, UPLOADED, FAILED
    sha256: str | None = None
    attempts: int = 0
    next_retry_at: float = 0.0
    error: str | None = None
    created_at: float = Field(default_factory=time.time)
    updated_at: float = Field(default_factory=time.time)


class EventQueueManager:
    """Coordinates trigger ingestion, clip extraction, deduplication, and persistence."""

    def __init__(
        self,
        db: LocalQueueDB,
        config: AgentConfig | None = None,
        extractor: ClipExtractor | None = None,
    ):
        self.db = db
        self.config = config
        self.extractor = extractor

    def is_duplicate(
        self,
        command_id: str,
        field_id: str,
        trigger_source: str,
        trigger_ts: float,
        window_seconds: float = 3.0,
    ) -> bool:
        """Check whether a trigger matches a recent command_id or button press."""
        is_dup, _ = self.db.check_duplicate(
            command_id=command_id,
            field_id=field_id,
            trigger_source=trigger_source,
            trigger_ts=trigger_ts,
            window_seconds=window_seconds,
        )
        return is_dup

    def enqueue_trigger(
        self,
        command_id: str,
        field_id: str,
        trigger_source: str,
        trigger_ts: float,
        window_seconds: float = 3.0,
    ) -> str:
        """Validate and enqueue a new trigger command.
        
        Raises DuplicateTriggerError if command is duplicate or within debounce window.
        Returns event_id.
        """
        is_dup, reason = self.db.check_duplicate(
            command_id=command_id,
            field_id=field_id,
            trigger_source=trigger_source,
            trigger_ts=trigger_ts,
            window_seconds=window_seconds,
        )
        if is_dup:
            existing_event = self.db.get_event_by_command_id(command_id)
            existing_id = existing_event["event_id"] if existing_event else None
            raise DuplicateTriggerError(
                message=reason or "Duplicate trigger rejected",
                existing_event_id=existing_id,
            )

        event_id = f"evt_{int(trigger_ts)}_{uuid.uuid4().hex[:8]}"
        self.db.record_event(
            event_id=event_id,
            command_id=command_id,
            field_id=field_id,
            trigger_source=trigger_source,
            trigger_ts=trigger_ts,
            status="QUEUED",
        )
        logger.info(
            "Enqueued trigger event %s (cmd=%s, field=%s, src=%s)",
            event_id,
            command_id,
            field_id,
            trigger_source,
        )
        return event_id

    def add_clip_to_event(
        self,
        event_id: str,
        camera_id: str,
        file_path: str,
        duration: float = 0.0,
        clip_id: str | None = None,
        status: str = "EXTRACTED",
        sha256: str | None = None,
    ) -> ClipJob:
        """Record an extracted clip job for an event."""
        actual_clip_id = clip_id or f"clip_{uuid.uuid4().hex[:10]}"
        self.db.add_clip(
            clip_id=actual_clip_id,
            event_id=event_id,
            camera_id=camera_id,
            file_path=file_path,
            duration=duration,
            status=status,
            sha256=sha256,
        )
        clip_data = self.db.get_clip(actual_clip_id)
        if not clip_data:
            raise RuntimeError(f"Failed to retrieve clip {actual_clip_id} after insertion")
        return ClipJob(**clip_data)

    def get_pending_clips(self) -> list[ClipJob]:
        """Fetch all clips requiring upload."""
        rows = self.db.get_pending_clips()
        return [ClipJob(**row) for row in rows]

    def get_pending_uploads(self) -> list[ClipJob]:
        """Alias for get_pending_clips."""
        return self.get_pending_clips()

    def get_event_clips(self, event_id: str) -> list[ClipJob]:
        """Fetch all clips for an event."""
        rows = self.db.get_clips_by_event(event_id)
        return [ClipJob(**row) for row in rows]

    def get_event(self, event_id: str) -> dict[str, Any] | None:
        """Fetch event record by ID."""
        return self.db.get_event(event_id)

    def mark_clip_processing(self, clip_id: str) -> None:
        """Transition clip to PROCESSING status."""
        self.db.update_clip_status(clip_id, status="PROCESSING")

    def mark_clip_failed(
        self,
        clip_id: str,
        error: str | None = None,
        attempts: int = 1,
        backoff_seconds: float = 0.0,
        **kwargs: Any,
    ) -> None:
        """Record upload failure and schedule next retry."""
        next_retry = time.time() + float(backoff_seconds)
        self.db.update_clip_status(
            clip_id=clip_id,
            status="FAILED",
            attempts=attempts,
            next_retry_at=next_retry,
            error=error,
        )

    def mark_clip_uploaded(self, clip_id: str, sha256: str | None = None) -> None:
        """Mark clip as successfully uploaded and complete event if all clips uploaded."""
        clip = self.db.get_clip(clip_id)
        if not clip:
            return

        self.db.update_clip_status(clip_id=clip_id, status="UPLOADED", sha256=sha256)

        event_id = clip["event_id"]
        event_clips = self.db.get_clips_by_event(event_id)
        if event_clips and all(c["status"] == "UPLOADED" for c in event_clips):
            self.db.update_event_status(event_id, "COMPLETED")

    def schedule_extraction(self, event_id: str, trigger_ts: float) -> list[ClipJob]:
        """Execute clip extraction for event across all configured cameras."""
        if not self.extractor or not self.config:
            logger.warning("No extractor or config configured; cannot run extraction for %s", event_id)
            return []

        self.db.update_event_status(event_id, "PROCESSING")
        profile = self.config.default_profile
        results = self.extractor.extract_event_clips(
            event_id=event_id,
            trigger_ts=trigger_ts,
            profile=profile,
            cameras=self.config.cameras,
        )

        jobs: list[ClipJob] = []
        for r in results:
            if r.status == "SUCCESS" and r.output_path:
                job = self.add_clip_to_event(
                    event_id=event_id,
                    camera_id=r.camera_id,
                    file_path=str(r.output_path),
                    duration=r.duration,
                    status="EXTRACTED",
                )
                jobs.append(job)

        if jobs:
            self.db.update_event_status(event_id, "EXTRACTED")
        else:
            self.db.update_event_status(event_id, "FAILED")

        return jobs
