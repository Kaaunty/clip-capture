import time
from pathlib import Path
import pytest

from apps.agent.src.buffer import (
    CircularBufferManager,
    CameraSegment,
    StreamStatus,
)
from apps.agent.src.models import AgentConfig, CameraConfig


def test_circular_buffer_window_retrieval(tmp_path):
    mgr = CircularBufferManager(buffer_root=tmp_path)
    now = time.time()
    # Segments of 5 seconds each
    seg1 = tmp_path / "cam1_seg1.mp4"
    seg2 = tmp_path / "cam1_seg2.mp4"
    seg3 = tmp_path / "cam1_seg3.mp4"
    seg1.write_text("dummy1")
    seg2.write_text("dummy2")
    seg3.write_text("dummy3")

    mgr.register_segment("cam1", seg1, start_ts=now - 15, duration=5.0)
    mgr.register_segment("cam1", seg2, start_ts=now - 10, duration=5.0)
    mgr.register_segment("cam1", seg3, start_ts=now - 5, duration=5.0)

    # Window from now - 12 to now - 2 should include seg1, seg2, seg3
    window_segs = mgr.get_segments_for_window("cam1", start_ts=now - 12, end_ts=now - 2)
    assert window_segs == [seg1, seg2, seg3]


def test_prune_preserves_unconfirmed_events(tmp_path):
    mgr = CircularBufferManager(buffer_root=tmp_path)
    now = time.time()
    old_seg = tmp_path / "old.mp4"
    protected_seg = tmp_path / "protected.mp4"
    old_seg.write_text("old")
    protected_seg.write_text("protected")

    mgr.register_segment("cam1", old_seg, start_ts=now - 1000, duration=5.0)
    mgr.register_segment("cam1", protected_seg, start_ts=now - 1000, duration=5.0)

    # Prune segments older than 100s, but protect protected_seg
    pruned = mgr.prune_old_segments(max_age_seconds=100, reserved_paths={protected_seg})
    assert old_seg.exists() is False
    assert protected_seg.exists() is True
    assert pruned == 1


def test_camera_segment_model(tmp_path):
    seg_file = tmp_path / "test_seg.mp4"
    seg_file.write_text("dummy")

    seg = CameraSegment(
        camera_id="cam1",
        segment_path=seg_file,
        start_ts=100.0,
        duration=5.0,
    )
    assert seg.camera_id == "cam1"
    assert seg.path == seg_file
    assert seg.end_ts == 105.0
    assert seg.overlaps(95.0, 101.0) is True
    assert seg.overlaps(104.0, 110.0) is True
    assert seg.overlaps(101.0, 104.0) is True
    assert seg.overlaps(80.0, 99.0) is False
    assert seg.overlaps(106.0, 120.0) is False


def test_window_retrieval_edge_cases(tmp_path):
    mgr = CircularBufferManager(buffer_root=tmp_path)
    now = time.time()

    # Unknown camera
    assert mgr.get_segments_for_window("nonexistent", start_ts=now - 10, end_ts=now) == []

    # Inverted window
    assert mgr.get_segments_for_window("cam1", start_ts=now, end_ts=now - 10) == []

    # Segments outside window
    seg_past = tmp_path / "past.mp4"
    seg_future = tmp_path / "future.mp4"
    seg_past.write_text("past")
    seg_future.write_text("future")

    mgr.register_segment("cam1", seg_past, start_ts=10.0, duration=5.0)
    mgr.register_segment("cam1", seg_future, start_ts=100.0, duration=5.0)

    # Window [30.0, 50.0] has no overlap
    assert mgr.get_segments_for_window("cam1", start_ts=30.0, end_ts=50.0) == []


def test_prune_variations(tmp_path):
    mgr = CircularBufferManager(buffer_root=tmp_path)
    now = time.time()

    seg_old = tmp_path / "old2.mp4"
    seg_old.write_text("old")
    seg_recent = tmp_path / "recent.mp4"
    seg_recent.write_text("recent")

    mgr.register_segment("cam1", seg_old, start_ts=now - 500, duration=5.0)
    mgr.register_segment("cam1", seg_recent, start_ts=now - 10, duration=5.0)

    # Test reserved_event_paths parameter name as alias
    pruned = mgr.prune_old_segments(max_age_seconds=100, reserved_event_paths=set())
    assert pruned == 1
    assert seg_old.exists() is False
    assert seg_recent.exists() is True

    # Segments for window should not return the pruned segment
    segs = mgr.get_segments_for_window("cam1", start_ts=now - 600, end_ts=now)
    assert segs == [seg_recent]


def test_camera_health_tracking(tmp_path):
    mgr = CircularBufferManager(buffer_root=tmp_path, offline_threshold_seconds=10.0)
    now = time.time()

    # Unknown camera
    health_unknown = mgr.get_camera_health("cam_unknown")
    assert health_unknown["status"] == StreamStatus.OFFLINE.value
    assert health_unknown["is_healthy"] is False
    assert health_unknown["segment_count"] == 0

    # Camera with recent segment
    seg_live = tmp_path / "live.mp4"
    seg_live.write_text("live")
    mgr.register_segment("cam1", seg_live, start_ts=now - 2, duration=2.0)

    health_cam1 = mgr.get_camera_health("cam1", now=now)
    assert health_cam1["status"] == StreamStatus.ONLINE.value
    assert health_cam1["is_healthy"] is True
    assert health_cam1["segment_count"] == 1
    assert health_cam1["total_duration"] == 2.0

    # Camera after threshold expires
    health_cam1_later = mgr.get_camera_health("cam1", now=now + 20)
    assert health_cam1_later["status"] == StreamStatus.OFFLINE.value
    assert health_cam1_later["is_healthy"] is False

    # Manual heartbeat restores online status
    mgr.record_heartbeat("cam1", timestamp=now + 25)
    health_cam1_heartbeat = mgr.get_camera_health("cam1", now=now + 26)
    assert health_cam1_heartbeat["status"] == StreamStatus.ONLINE.value
    assert health_cam1_heartbeat["is_healthy"] is True


def test_manager_initialized_with_agent_config(tmp_path):
    cfg = AgentConfig(
        field_id="field-1",
        central_api_url="http://central.test",
        device_token="tok-123",
        buffer_dir=str(tmp_path / "cfg_buffer"),
        cameras=[
            CameraConfig(id="camA", name="Camera A", rtsp_url="rtsp://a"),
            CameraConfig(id="camB", name="Camera B", rtsp_url="rtsp://b"),
        ],
    )
    mgr = CircularBufferManager(config=cfg)
    assert mgr.buffer_root == tmp_path / "cfg_buffer"
    assert mgr.buffer_root.exists()

    all_health = mgr.get_all_cameras_health()
    assert "camA" in all_health
    assert "camB" in all_health
    assert all_health["camA"]["status"] == StreamStatus.OFFLINE.value


def test_get_segment_info(tmp_path):
    mgr = CircularBufferManager(buffer_root=tmp_path)
    seg1 = tmp_path / "seg1.mp4"
    seg1.write_text("data")
    mgr.register_segment("cam1", seg1, start_ts=100.0, duration=5.0)

    info = mgr.get_segment_info("cam1", seg1)
    assert info is not None
    assert info.camera_id == "cam1"
    assert info.start_ts == 100.0
    assert info.duration == 5.0

    # Non-existent segment returns None
    assert mgr.get_segment_info("cam1", tmp_path / "nonexistent.mp4") is None
    assert mgr.get_segment_info("cam2", seg1) is None

