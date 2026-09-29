"""Unit tests for multi-camera clip extractor."""

from pathlib import Path
import subprocess
import time
from unittest.mock import MagicMock, patch

import pytest

from apps.agent.src.buffer import CameraSegment, CircularBufferManager
from apps.agent.src.extractor import ClipExtractionResult, ClipExtractor
from apps.agent.src.models import CameraConfig, CaptureProfileConfig


def test_extract_clips_multi_camera(tmp_path):
    buffer_mgr = MagicMock(spec=CircularBufferManager)
    now = time.time()
    seg = tmp_path / "seg.mp4"
    seg.write_text("video-data")
    buffer_mgr.get_segments_for_window.return_value = [seg]

    extractor = ClipExtractor(buffer_mgr=buffer_mgr, output_dir=tmp_path / "clips")
    # Mock ffmpeg concat execution to generate valid dummy output
    extractor._run_ffmpeg_cut = MagicMock(side_effect=lambda inputs, out, s, d: out.write_text("mp4-content"))

    cameras = [
        CameraConfig(id="cam1", name="Gol 1", rtsp_url="rtsp://c1", order=1),
        CameraConfig(id="cam2", name="Gol 2", rtsp_url="rtsp://c2", order=2),
    ]
    profile = CaptureProfileConfig(seconds_before=10, seconds_after=5)

    results = extractor.extract_event_clips(event_id="evt-1", trigger_ts=now, profile=profile, cameras=cameras)
    assert len(results) == 2
    assert all(r.status == "EXTRACTED" for r in results)
    assert all(r.output_path.exists() for r in results)
    assert all(r.duration == 15.0 for r in results)


def test_extraction_with_offline_camera(tmp_path):
    buffer_mgr = MagicMock(spec=CircularBufferManager)
    now = time.time()
    seg = tmp_path / "seg.mp4"
    seg.write_text("video-data")

    # cam1 has segments, cam2 has none (offline)
    buffer_mgr.get_segments_for_window.side_effect = lambda cid, s, e: [seg] if cid == "cam1" else []

    extractor = ClipExtractor(buffer_mgr=buffer_mgr, output_dir=tmp_path / "clips")
    extractor._run_ffmpeg_cut = MagicMock(side_effect=lambda inputs, out, s, d: out.write_text("mp4-content"))

    cameras = [
        CameraConfig(id="cam1", name="Gol 1", rtsp_url="rtsp://c1", order=1),
        CameraConfig(id="cam2", name="Gol 2 (Offline)", rtsp_url="rtsp://c2", order=2),
    ]
    profile = CaptureProfileConfig(seconds_before=10, seconds_after=5)

    results = extractor.extract_event_clips(event_id="evt-2", trigger_ts=now, profile=profile, cameras=cameras)
    assert len(results) == 2
    r_cam1 = next(r for r in results if r.camera_id == "cam1")
    r_cam2 = next(r for r in results if r.camera_id == "cam2")
    assert r_cam1.status == "EXTRACTED"
    assert r_cam2.status == "CAMERA_UNAVAILABLE"
    assert r_cam2.output_path is None


def test_extraction_ffmpeg_failure_handled_gracefully(tmp_path):
    buffer_mgr = MagicMock(spec=CircularBufferManager)
    now = time.time()
    seg = tmp_path / "seg.mp4"
    seg.write_text("video-data")
    buffer_mgr.get_segments_for_window.return_value = [seg]

    extractor = ClipExtractor(buffer_mgr=buffer_mgr, output_dir=tmp_path / "clips")

    def mock_cut(inputs, out, s, d):
        if "cam2" in str(out):
            raise RuntimeError("FFmpeg corrupted bitstream error")
        out.write_text("mp4-content")

    extractor._run_ffmpeg_cut = MagicMock(side_effect=mock_cut)

    cameras = [
        CameraConfig(id="cam1", name="Gol 1", rtsp_url="rtsp://c1", order=1),
        CameraConfig(id="cam2", name="Gol 2", rtsp_url="rtsp://c2", order=2),
    ]
    profile = CaptureProfileConfig(seconds_before=10, seconds_after=5)

    results = extractor.extract_event_clips(event_id="evt-fail", trigger_ts=now, profile=profile, cameras=cameras)
    assert len(results) == 2
    r_cam1 = next(r for r in results if r.camera_id == "cam1")
    r_cam2 = next(r for r in results if r.camera_id == "cam2")

    assert r_cam1.status == "EXTRACTED"
    assert r_cam1.output_path is not None
    assert r_cam1.output_path.exists()

    assert r_cam2.status == "FAILED"
    assert r_cam2.output_path is None
    assert "FFmpeg corrupted bitstream error" in (r_cam2.error or "")


def test_extraction_inactive_camera_marked_unavailable(tmp_path):
    buffer_mgr = MagicMock(spec=CircularBufferManager)
    now = time.time()
    seg = tmp_path / "seg.mp4"
    seg.write_text("video-data")
    buffer_mgr.get_segments_for_window.return_value = [seg]

    extractor = ClipExtractor(buffer_mgr=buffer_mgr, output_dir=tmp_path / "clips")
    extractor._run_ffmpeg_cut = MagicMock(side_effect=lambda inputs, out, s, d: out.write_text("mp4-content"))

    cameras = [
        CameraConfig(id="cam1", name="Gol 1", rtsp_url="rtsp://c1", order=1, is_active=True),
        CameraConfig(id="cam2", name="Gol 2 Inactive", rtsp_url="rtsp://c2", order=2, is_active=False),
    ]
    profile = CaptureProfileConfig(seconds_before=10, seconds_after=5)

    results = extractor.extract_event_clips(event_id="evt-inactive", trigger_ts=now, profile=profile, cameras=cameras)
    assert len(results) == 2
    r_cam2 = next(r for r in results if r.camera_id == "cam2")
    assert r_cam2.status == "CAMERA_UNAVAILABLE"
    assert r_cam2.output_path is None


def test_extractor_ffmpeg_fallback_to_reencode(tmp_path):
    buffer_mgr = MagicMock(spec=CircularBufferManager)
    extractor = ClipExtractor(buffer_mgr=buffer_mgr, output_dir=tmp_path / "clips")

    seg1 = tmp_path / "seg1.mp4"
    seg2 = tmp_path / "seg2.mp4"
    seg1.write_bytes(b"dummy1")
    seg2.write_bytes(b"dummy2")
    out_file = tmp_path / "out.mp4"

    calls = []

    def fake_subprocess_run(cmd, *args, **kwargs):
        calls.append(cmd)
        # First call is stream copy (-c copy), simulate failure
        if "-c" in cmd and "copy" in cmd:
            raise subprocess.CalledProcessError(returncode=1, cmd=cmd, stderr=b"Stream copy failed")
        # Second call is re-encode, succeed and create file
        out_file.write_bytes(b"reencoded-output")
        return subprocess.CompletedProcess(cmd, returncode=0)

    with patch("subprocess.run", side_effect=fake_subprocess_run):
        extractor._run_ffmpeg_cut(inputs=[seg1, seg2], output_path=out_file, start=1.5, duration=10.0)

    assert len(calls) == 2
    assert "copy" in calls[0]
    assert "libx264" in calls[1]
    assert out_file.exists()


def test_extractor_ffmpeg_both_fail_raises(tmp_path):
    buffer_mgr = MagicMock(spec=CircularBufferManager)
    extractor = ClipExtractor(buffer_mgr=buffer_mgr, output_dir=tmp_path / "clips")

    seg = tmp_path / "seg.mp4"
    seg.write_bytes(b"dummy")
    out_file = tmp_path / "out.mp4"

    with patch("subprocess.run", side_effect=subprocess.CalledProcessError(returncode=1, cmd="ffmpeg", stderr=b"Fatal")):
        with pytest.raises(RuntimeError, match="FFmpeg extraction failed"):
            extractor._run_ffmpeg_cut(inputs=[seg], output_path=out_file, start=0.0, duration=5.0)


def test_extractor_real_ffmpeg_cut(tmp_path):
    # Verify end-to-end execution of real ffmpeg CLI
    buffer_root = tmp_path / "buffer"
    buffer_mgr = CircularBufferManager(buffer_root=buffer_root)
    cam_dir = buffer_mgr.get_camera_dir("cam1")

    seg1 = cam_dir / "seg1.mp4"
    seg2 = cam_dir / "seg2.mp4"

    # Generate 2 valid 2-second video segments using ffmpeg
    subprocess.run(
        ["ffmpeg", "-y", "-f", "lavfi", "-i", "testsrc=duration=2:size=160x120:rate=10", "-c:v", "libx264", str(seg1)],
        check=True,
        capture_output=True,
    )
    subprocess.run(
        ["ffmpeg", "-y", "-f", "lavfi", "-i", "testsrc=duration=2:size=160x120:rate=10", "-c:v", "libx264", str(seg2)],
        check=True,
        capture_output=True,
    )

    t0 = 1000.0
    buffer_mgr.register_segment("cam1", seg1, start_ts=t0, duration=2.0)
    buffer_mgr.register_segment("cam1", seg2, start_ts=t0 + 2.0, duration=2.0)

    extractor = ClipExtractor(buffer_mgr=buffer_mgr, output_dir=tmp_path / "clips")
    camera = CameraConfig(id="cam1", name="Cam 1", rtsp_url="rtsp://dummy", order=1)
    profile = CaptureProfileConfig(seconds_before=1, seconds_after=1)

    # Trigger at t0 + 2.0: window is [t0 + 1.0, t0 + 3.0] (duration 2s, across both segments)
    results = extractor.extract_event_clips(
        event_id="evt-real",
        trigger_ts=t0 + 2.0,
        profile=profile,
        cameras=[camera],
    )

    assert len(results) == 1
    assert results[0].status == "EXTRACTED"
    assert results[0].output_path is not None
    assert results[0].output_path.exists()
    assert results[0].output_path.stat().st_size > 0
    assert results[0].duration == 2.0


def test_clip_extraction_result_model():
    res = ClipExtractionResult("cam1", "EXTRACTED", Path("/tmp/out.mp4"), 15.0, None)
    assert res.camera_id == "cam1"
    assert res.status == "EXTRACTED"
    assert res.output_path == Path("/tmp/out.mp4")
    assert res.duration == 15.0
    assert res.error is None

    # Test string path conversion and keyword args
    res2 = ClipExtractionResult(camera_id="cam2", status="CAMERA_UNAVAILABLE", output_path="/tmp/c2.mp4")
    assert isinstance(res2.output_path, Path)
    assert res2.error is None
    assert res2.duration == 0.0


def test_extractor_defaults_from_config(tmp_path):
    from apps.agent.src.models import AgentConfig

    cam1 = CameraConfig(id="cam1", name="Cam 1", rtsp_url="rtsp://c1")
    config = AgentConfig(
        field_id="field-1",
        central_api_url="https://api.test",
        device_token="token",
        buffer_dir=str(tmp_path / "buf"),
        cameras=[cam1],
    )
    buffer_mgr = MagicMock(spec=CircularBufferManager)
    extractor = ClipExtractor(buffer_mgr=buffer_mgr, config=config)
    assert extractor.output_dir == tmp_path / "buf" / "clips"
    assert extractor.output_dir.exists()

    # When cameras=None, falls back to config.cameras
    buffer_mgr.get_segments_for_window.return_value = []
    profile = CaptureProfileConfig(seconds_before=5, seconds_after=5)
    results = extractor.extract_event_clips(event_id="evt-cfg", trigger_ts=100.0, profile=profile)
    assert len(results) == 1
    assert results[0].camera_id == "cam1"
    assert results[0].status == "CAMERA_UNAVAILABLE"


def test_extractor_ffmpeg_timeout_handled_per_camera(tmp_path):
    buffer_mgr = MagicMock(spec=CircularBufferManager)
    extractor = ClipExtractor(buffer_mgr=buffer_mgr, output_dir=tmp_path / "clips")

    seg = tmp_path / "seg.mp4"
    seg.write_text("data")
    buffer_mgr.get_segments_for_window.return_value = [seg]

    # cam1 hangs / times out, cam2 succeeds
    def mock_cut(inputs, out, s, d):
        if "cam1" in str(out):
            raise subprocess.TimeoutExpired(cmd="ffmpeg", timeout=60)
        out.write_text("mp4-content")

    extractor._run_ffmpeg_cut = MagicMock(side_effect=mock_cut)

    cameras = [
        CameraConfig(id="cam1", name="Gol 1", rtsp_url="rtsp://c1", order=1),
        CameraConfig(id="cam2", name="Gol 2", rtsp_url="rtsp://c2", order=2),
    ]
    profile = CaptureProfileConfig(seconds_before=10, seconds_after=5)

    results = extractor.extract_event_clips(event_id="evt-timeout", trigger_ts=100.0, profile=profile, cameras=cameras)
    assert len(results) == 2
    r_cam1 = next(r for r in results if r.camera_id == "cam1")
    r_cam2 = next(r for r in results if r.camera_id == "cam2")

    assert r_cam1.status == "FAILED"
    assert r_cam1.output_path is None
    assert "timed out after 60" in (r_cam1.error or "")

    assert r_cam2.status == "EXTRACTED"
    assert r_cam2.output_path is not None
    assert r_cam2.output_path.exists()


def test_extractor_cleans_partial_output_on_failure(tmp_path):
    buffer_mgr = MagicMock(spec=CircularBufferManager)
    extractor = ClipExtractor(buffer_mgr=buffer_mgr, output_dir=tmp_path / "clips")

    seg = tmp_path / "seg.mp4"
    seg.write_text("data")
    buffer_mgr.get_segments_for_window.return_value = [seg]

    def failing_cut_with_partial_file(inputs, out, s, d):
        out.write_text("corrupted partial content")
        raise RuntimeError("Encoding crashed mid-stream")

    extractor._run_ffmpeg_cut = MagicMock(side_effect=failing_cut_with_partial_file)
    camera = CameraConfig(id="cam1", name="Cam 1", rtsp_url="rtsp://dummy")
    profile = CaptureProfileConfig(seconds_before=5, seconds_after=5)

    results = extractor.extract_event_clips(event_id="evt-partial", trigger_ts=100.0, profile=profile, cameras=[camera])
    assert len(results) == 1
    assert results[0].status == "FAILED"
    # Ensure partial file was unlinked and does not remain on disk
    expected_output = tmp_path / "clips" / "event_evt-partial_cam_cam1.mp4"
    assert not expected_output.exists()


