"""Continuous circular buffer manager for RTSP camera streams."""

from collections import defaultdict
from enum import Enum
from pathlib import Path
import threading
import time
from typing import Iterable

from pydantic import BaseModel, ConfigDict

from apps.agent.src.models import AgentConfig, CameraConfig


class StreamStatus(str, Enum):
    """Operational status of a camera video stream."""

    ONLINE = "ONLINE"
    OFFLINE = "OFFLINE"
    DEGRADED = "DEGRADED"
    CAMERA_UNAVAILABLE = "CAMERA_UNAVAILABLE"


class CameraSegment(BaseModel):
    """Metadata describing a single video segment recorded for a camera stream."""

    model_config = ConfigDict(arbitrary_types_allowed=True)

    camera_id: str
    segment_path: Path
    start_ts: float
    duration: float

    def __init__(
        self,
        camera_id: str,
        segment_path: Path | str | None = None,
        start_ts: float = 0.0,
        duration: float = 0.0,
        path: Path | str | None = None,
        **kwargs,
    ):
        target_path = segment_path if segment_path is not None else path
        if target_path is None:
            raise ValueError("Either segment_path or path must be provided")
        super().__init__(
            camera_id=camera_id,
            segment_path=Path(target_path),
            start_ts=start_ts,
            duration=duration,
            **kwargs,
        )

    @property
    def path(self) -> Path:
        """Alias for segment_path."""
        return self.segment_path

    @property
    def end_ts(self) -> float:
        """Timestamp marking the end of this segment."""
        return self.start_ts + self.duration

    def overlaps(self, start_ts: float, end_ts: float) -> bool:
        """Return True if this segment intersects with the time window [start_ts, end_ts]."""
        return self.start_ts < end_ts and self.end_ts > start_ts


class CircularBufferManager:
    """Manages continuous circular video buffers across multiple RTSP camera streams.

    Maintains segment index by camera, calculates time window intersections,
    tracks stream health / heartbeats, and prunes expired segments while protecting
    reserved event paths.
    """

    def __init__(
        self,
        buffer_root: Path | str | None = None,
        config: AgentConfig | None = None,
        offline_threshold_seconds: float = 30.0,
    ):
        if config is not None:
            self.buffer_root = Path(buffer_root) if buffer_root is not None else Path(config.buffer_dir)
            self._config = config
        elif buffer_root is not None:
            self.buffer_root = Path(buffer_root)
            self._config = None
        else:
            self.buffer_root = Path("/tmp/clip-buffer")
            self._config = None

        self.buffer_root.mkdir(parents=True, exist_ok=True)
        self.offline_threshold_seconds = float(offline_threshold_seconds)

        self._lock = threading.RLock()
        self._segments: dict[str, list[CameraSegment]] = defaultdict(list)
        self._heartbeats: dict[str, float] = {}

        if self._config and self._config.cameras:
            for cam in self._config.cameras:
                if cam.id not in self._segments:
                    self._segments[cam.id] = []

    def get_camera_dir(self, camera_id: str) -> Path:
        """Returns the directory dedicated to a camera's buffer segments."""
        cam_dir = self.buffer_root / camera_id
        cam_dir.mkdir(parents=True, exist_ok=True)
        return cam_dir

    def register_segment(
        self,
        camera_id: str,
        segment_path: Path | str,
        start_ts: float,
        duration: float,
    ) -> CameraSegment:
        """Register a new segment in the buffer index."""
        path_obj = Path(segment_path)
        segment = CameraSegment(
            camera_id=camera_id,
            segment_path=path_obj,
            start_ts=start_ts,
            duration=duration,
        )

        with self._lock:
            cam_segs = self._segments[camera_id]
            existing_idx = next(
                (i for i, s in enumerate(cam_segs) if s.segment_path == path_obj),
                None,
            )
            if existing_idx is not None:
                cam_segs[existing_idx] = segment
            else:
                cam_segs.append(segment)
            cam_segs.sort(key=lambda s: s.start_ts)

            seg_end = start_ts + duration
            self._heartbeats[camera_id] = max(self._heartbeats.get(camera_id, 0.0), seg_end)

        return segment

    def get_segments_for_window(
        self,
        camera_id: str,
        start_ts: float,
        end_ts: float,
    ) -> list[Path]:
        """Return list of segment paths that overlap with the [start_ts, end_ts] window.

        Segments are returned in chronological order by start_ts.
        """
        if start_ts >= end_ts:
            return []

        with self._lock:
            cam_segs = self._segments.get(camera_id, [])
            return [
                s.segment_path
                for s in cam_segs
                if s.overlaps(start_ts, end_ts)
            ]

    def get_segment_info(
        self,
        camera_id: str,
        segment_path: Path | str,
    ) -> CameraSegment | None:
        """Return the CameraSegment metadata for a given camera and segment path, or None."""
        target_path = Path(segment_path)
        with self._lock:
            cam_segs = self._segments.get(camera_id, [])
            for seg in cam_segs:
                if seg.segment_path == target_path or str(seg.segment_path) == str(target_path):
                    return seg
                try:
                    if seg.segment_path.resolve() == target_path.resolve():
                        return seg
                except Exception:
                    pass
            return None

    def prune_old_segments(
        self,
        max_age_seconds: int,
        reserved_paths: Iterable[Path | str] | None = None,
        reserved_event_paths: Iterable[Path | str] | None = None,
        now: float | None = None,
    ) -> int:
        """Prune segments older than max_age_seconds while strictly protecting reserved paths.

        A segment is eligible for pruning if its entire duration is older than max_age_seconds
        (i.e. end_ts <= cutoff). If the segment's path is in reserved_paths, it is preserved.

        Returns:
            The number of pruned segments.
        """
        current_time = now if now is not None else time.time()
        cutoff = current_time - max_age_seconds

        protected: set[Path] = set()
        protected_str: set[str] = set()

        all_reserved: list[Path | str] = []
        if reserved_paths:
            all_reserved.extend(reserved_paths)
        if reserved_event_paths:
            all_reserved.extend(reserved_event_paths)

        for p in all_reserved:
            path_obj = Path(p)
            protected.add(path_obj)
            protected_str.add(str(path_obj))
            try:
                resolved = path_obj.resolve()
                protected.add(resolved)
                protected_str.add(str(resolved))
            except Exception:
                pass

        pruned_count = 0

        with self._lock:
            for camera_id, cam_segs in list(self._segments.items()):
                retained_segs: list[CameraSegment] = []
                for seg in cam_segs:
                    if seg.end_ts <= cutoff:
                        is_protected = (
                            seg.segment_path in protected
                            or str(seg.segment_path) in protected_str
                        )
                        if not is_protected:
                            try:
                                resolved = seg.segment_path.resolve()
                                if resolved in protected or str(resolved) in protected_str:
                                    is_protected = True
                            except Exception:
                                pass

                        if is_protected:
                            retained_segs.append(seg)
                        else:
                            success = True
                            try:
                                if seg.segment_path.exists():
                                    seg.segment_path.unlink()
                            except OSError:
                                success = False
                            
                            if success:
                                pruned_count += 1
                            else:
                                retained_segs.append(seg)
                    else:
                        retained_segs.append(seg)

                self._segments[camera_id] = retained_segs

        return pruned_count

    def record_heartbeat(
        self,
        camera_id: str,
        timestamp: float | None = None,
    ) -> None:
        """Record a heartbeat timestamp for a camera."""
        ts = timestamp if timestamp is not None else time.time()
        with self._lock:
            self._heartbeats[camera_id] = max(self._heartbeats.get(camera_id, 0.0), ts)

    def get_camera_health(
        self,
        camera_id: str,
        now: float | None = None,
    ) -> dict:
        """Return stream health and metrics for a specific camera."""
        current_time = now if now is not None else time.time()

        with self._lock:
            cam_segs = self._segments.get(camera_id, [])
            last_hb = self._heartbeats.get(camera_id)
            last_seg_ts = max((s.end_ts for s in cam_segs), default=None)

            active_ts_candidates = [t for t in (last_seg_ts, last_hb) if t is not None]
            latest_activity = max(active_ts_candidates, default=None)

            is_online = (
                latest_activity is not None
                and (current_time - latest_activity) <= self.offline_threshold_seconds
            )

            status = StreamStatus.ONLINE.value if is_online else StreamStatus.OFFLINE.value

            return {
                "camera_id": camera_id,
                "status": status,
                "is_healthy": is_online,
                "healthy": is_online,
                "last_heartbeat": last_hb,
                "last_segment_ts": last_seg_ts,
                "segment_count": len(cam_segs),
                "total_duration": sum(s.duration for s in cam_segs),
            }

    def get_all_cameras_health(
        self,
        now: float | None = None,
    ) -> dict[str, dict]:
        """Return health dictionary keyed by camera_id for all tracked cameras."""
        with self._lock:
            camera_ids = set(self._segments.keys()) | set(self._heartbeats.keys())
            if self._config and self._config.cameras:
                camera_ids.update(cam.id for cam in self._config.cameras)
            return {
                cid: self.get_camera_health(cid, now=now)
                for cid in sorted(camera_ids)
            }
