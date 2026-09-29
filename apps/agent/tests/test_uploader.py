"""Tests for Agent Sync & Resilient Upload Worker."""

import hashlib
from pathlib import Path
import time
from unittest.mock import MagicMock, patch
import httpx
import pytest

from apps.agent.src.uploader import UploadWorker, calculate_file_checksum
from apps.agent.src.queue import EventQueueManager, ClipJob
from apps.agent.src.models import AgentConfig, CaptureProfileConfig


def test_calculate_file_checksum(tmp_path):
    sample = tmp_path / "test.mp4"
    sample.write_bytes(b"sample-video-content-bytes")
    expected = hashlib.sha256(b"sample-video-content-bytes").hexdigest()
    assert calculate_file_checksum(sample) == expected


def test_calculate_file_checksum_large_chunks(tmp_path):
    sample = tmp_path / "large.mp4"
    # Create ~150KB content to test multiple read chunks
    content = b"x" * (150 * 1024)
    sample.write_bytes(content)
    expected = hashlib.sha256(content).hexdigest()
    assert calculate_file_checksum(sample, chunk_size=65536) == expected


def test_calculate_file_checksum_file_not_found(tmp_path):
    missing = tmp_path / "non_existent.mp4"
    with pytest.raises(FileNotFoundError):
        calculate_file_checksum(missing)


def test_upload_retry_with_backoff(tmp_path):
    queue_mgr = MagicMock(spec=EventQueueManager)
    test_file = tmp_path / "clip.mp4"
    test_file.write_bytes(b"content")

    job = ClipJob(
        clip_id="c1",
        event_id="e1",
        camera_id="cam1",
        file_path=str(test_file),
        status="EXTRACTED",
        attempts=0,
        next_retry_at=0,
    )
    queue_mgr.get_pending_clips.return_value = [job]

    worker = UploadWorker(
        queue_mgr=queue_mgr,
        central_api_url="https://api.test",
        device_token="token-123",
    )

    # First attempt fails with network error
    with patch("httpx.post", side_effect=Exception("Network dropped")):
        uploaded = worker.process_pending_queue_once()
        assert uploaded == 0
        assert test_file.exists()  # Local file MUST NOT be deleted
        queue_mgr.mark_clip_failed.assert_called_once()
        # Verify next_retry_at was set with backoff
        _, kwargs = queue_mgr.mark_clip_failed.call_args
        assert kwargs["attempts"] == 1
        assert kwargs["backoff_seconds"] > 0


def test_upload_retry_exponential_backoff_calculation(tmp_path):
    queue_mgr = MagicMock(spec=EventQueueManager)
    worker = UploadWorker(
        queue_mgr=queue_mgr,
        central_api_url="https://api.test",
        device_token="token-123",
        initial_backoff=5.0,
        backoff_factor=3.0,
        max_backoff=300.0,
    )

    # Test backoff progression: 5, 15, 45, 135, capped at 300
    assert worker.calculate_backoff(attempts=1) == 5.0
    assert worker.calculate_backoff(attempts=2) == 15.0
    assert worker.calculate_backoff(attempts=3) == 45.0
    assert worker.calculate_backoff(attempts=4) == 135.0
    assert worker.calculate_backoff(attempts=5) == 300.0
    assert worker.calculate_backoff(attempts=10) == 300.0


def test_upload_success_preserves_local_file_under_retention(tmp_path):
    queue_mgr = MagicMock(spec=EventQueueManager)
    test_file = tmp_path / "clip.mp4"
    test_file.write_bytes(b"content")

    job = ClipJob(
        clip_id="c2",
        event_id="e2",
        camera_id="cam1",
        file_path=str(test_file),
        status="EXTRACTED",
        attempts=0,
        next_retry_at=0,
        created_at=time.time(),
    )
    queue_mgr.get_pending_clips.return_value = [job]

    worker = UploadWorker(
        queue_mgr=queue_mgr,
        central_api_url="https://api.test",
        device_token="token-123",
        retention_days=7,
        delete_after_upload=False,
    )

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {"status": "CONFIRMED"}

    with patch("httpx.post", return_value=mock_resp) as mock_post:
        uploaded = worker.process_pending_queue_once()
        assert uploaded == 1
        assert test_file.exists()  # Kept within 7-day retention window
        queue_mgr.mark_clip_uploaded.assert_called_once()
        _, kwargs = queue_mgr.mark_clip_uploaded.call_args
        assert kwargs["clip_id"] == "c2"
        expected_sha = hashlib.sha256(b"content").hexdigest()
        assert kwargs["sha256"] == expected_sha

        # Verify request parameters
        mock_post.assert_called_once()
        call_args, call_kwargs = mock_post.call_args
        assert call_args[0] == "https://api.test/api/v1/clips/upload"
        assert call_kwargs["headers"]["Authorization"] == "Bearer token-123"
        assert call_kwargs["data"]["eventId"] == "e2"
        assert call_kwargs["data"]["cameraId"] == "cam1"
        assert call_kwargs["data"]["checksum"] == expected_sha


def test_upload_success_deletes_local_file_when_policy_permits(tmp_path):
    queue_mgr = MagicMock(spec=EventQueueManager)
    test_file = tmp_path / "clip.mp4"
    test_file.write_bytes(b"content")

    job = ClipJob(
        clip_id="c3",
        event_id="e3",
        camera_id="cam1",
        file_path=str(test_file),
        status="EXTRACTED",
        attempts=0,
        next_retry_at=0,
    )
    queue_mgr.get_pending_clips.return_value = [job]

    # delete_after_upload=True permits local removal once confirmed
    worker = UploadWorker(
        queue_mgr=queue_mgr,
        central_api_url="https://api.test",
        device_token="token-123",
        delete_after_upload=True,
    )

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {"status": "CONFIRMED"}

    with patch("httpx.post", return_value=mock_resp):
        uploaded = worker.process_pending_queue_once()
        assert uploaded == 1
        assert not test_file.exists()  # Local file deleted per retention policy
        queue_mgr.mark_clip_uploaded.assert_called_once()


def test_upload_http_500_retries_with_backoff_and_preserves_file(tmp_path):
    queue_mgr = MagicMock(spec=EventQueueManager)
    test_file = tmp_path / "clip.mp4"
    test_file.write_bytes(b"content")

    job = ClipJob(
        clip_id="c4",
        event_id="e4",
        camera_id="cam1",
        file_path=str(test_file),
        status="EXTRACTED",
        attempts=1,
        next_retry_at=0,
    )
    queue_mgr.get_pending_clips.return_value = [job]

    worker = UploadWorker(
        queue_mgr=queue_mgr,
        central_api_url="https://api.test",
        device_token="token-123",
        delete_after_upload=True,  # Even with delete_after_upload=True, file MUST NOT be deleted on error
    )

    mock_resp = MagicMock()
    mock_resp.status_code = 500
    mock_resp.text = "Internal Server Error"

    with patch("httpx.post", return_value=mock_resp):
        uploaded = worker.process_pending_queue_once()
        assert uploaded == 0
        assert test_file.exists()  # Local file MUST NOT be deleted
        queue_mgr.mark_clip_failed.assert_called_once()
        _, kwargs = queue_mgr.mark_clip_failed.call_args
        assert kwargs["attempts"] == 2
        assert kwargs["backoff_seconds"] == 15.0


def test_upload_missing_local_file_marks_failed(tmp_path):
    queue_mgr = MagicMock(spec=EventQueueManager)
    missing_file = tmp_path / "non_existent.mp4"

    job = ClipJob(
        clip_id="c5",
        event_id="e5",
        camera_id="cam1",
        file_path=str(missing_file),
        status="EXTRACTED",
        attempts=0,
        next_retry_at=0,
    )
    queue_mgr.get_pending_clips.return_value = [job]

    worker = UploadWorker(
        queue_mgr=queue_mgr,
        central_api_url="https://api.test",
        device_token="token-123",
    )

    uploaded = worker.process_pending_queue_once()
    assert uploaded == 0
    queue_mgr.mark_clip_failed.assert_called_once()
    _, kwargs = queue_mgr.mark_clip_failed.call_args
    assert kwargs["attempts"] == 1
    assert "File not found" in kwargs["error"]


def test_upload_skips_jobs_whose_retry_time_has_not_arrived(tmp_path):
    queue_mgr = MagicMock(spec=EventQueueManager)
    test_file = tmp_path / "clip.mp4"
    test_file.write_bytes(b"content")

    future_retry = time.time() + 100.0
    job = ClipJob(
        clip_id="c6",
        event_id="e6",
        camera_id="cam1",
        file_path=str(test_file),
        status="FAILED",
        attempts=2,
        next_retry_at=future_retry,
    )
    queue_mgr.get_pending_clips.return_value = [job]

    worker = UploadWorker(
        queue_mgr=queue_mgr,
        central_api_url="https://api.test",
        device_token="token-123",
    )

    with patch("httpx.post") as mock_post:
        uploaded = worker.process_pending_queue_once()
        assert uploaded == 0
        mock_post.assert_not_called()
        queue_mgr.mark_clip_failed.assert_not_called()


def test_upload_presigned_url_protocol(tmp_path):
    queue_mgr = MagicMock(spec=EventQueueManager)
    test_file = tmp_path / "clip.mp4"
    test_file.write_bytes(b"content")

    job = ClipJob(
        clip_id="c7",
        event_id="e7",
        camera_id="cam1",
        file_path=str(test_file),
        status="EXTRACTED",
        attempts=0,
        next_retry_at=0,
    )
    queue_mgr.get_pending_clips.return_value = [job]

    worker = UploadWorker(
        queue_mgr=queue_mgr,
        central_api_url="https://api.test",
        device_token="token-123",
    )

    # Initial POST returns presigned PUT URL
    mock_post_upload = MagicMock()
    mock_post_upload.status_code = 200
    mock_post_upload.json.return_value = {"upload_url": "https://s3.aws.test/presigned-put"}

    mock_put_s3 = MagicMock()
    mock_put_s3.status_code = 200

    mock_post_confirm = MagicMock()
    mock_post_confirm.status_code = 200
    mock_post_confirm.json.return_value = {"status": "READY"}

    def side_effect_post(url, *args, **kwargs):
        if "upload" in url:
            return mock_post_upload
        if "confirm" in url:
            return mock_post_confirm
        raise ValueError(f"Unexpected url {url}")

    with patch("httpx.post", side_effect=side_effect_post) as mock_post, \
         patch("httpx.put", return_value=mock_put_s3) as mock_put:
        uploaded = worker.process_pending_queue_once()
        assert uploaded == 1
        queue_mgr.mark_clip_uploaded.assert_called_once()
        mock_put.assert_called_once()
        assert mock_post.call_count == 2


def test_upload_worker_initialized_with_agent_config(tmp_path):
    queue_mgr = MagicMock(spec=EventQueueManager)
    config = AgentConfig(
        field_id="field-1",
        central_api_url="https://api.agent-config.test",
        device_token="token-agent-config",
        buffer_dir=str(tmp_path),
        default_profile=CaptureProfileConfig(retention_days=14),
    )

    worker = UploadWorker(queue_mgr=queue_mgr, config=config)
    assert worker.central_api_url == "https://api.agent-config.test"
    assert worker.device_token == "token-agent-config"
    assert worker.retention_days == 14


def test_upload_worker_thread_lifecycle(tmp_path):
    queue_mgr = MagicMock(spec=EventQueueManager)
    queue_mgr.get_pending_clips.return_value = []

    worker = UploadWorker(
        queue_mgr=queue_mgr,
        central_api_url="https://api.test",
        device_token="token-123",
    )

    worker.start(poll_interval=0.02)
    assert worker._thread is not None
    assert worker._thread.is_alive()
    time.sleep(0.06)
    worker.stop(timeout=1.0)
    assert not worker._thread.is_alive()


def test_upload_worker_custom_client_injected(tmp_path):
    queue_mgr = MagicMock(spec=EventQueueManager)
    test_file = tmp_path / "clip.mp4"
    test_file.write_bytes(b"content")

    job = ClipJob(
        clip_id="c8",
        event_id="e8",
        camera_id="cam1",
        file_path=str(test_file),
        status="EXTRACTED",
        attempts=0,
        next_retry_at=0,
    )
    queue_mgr.get_pending_clips.return_value = [job]

    mock_client = MagicMock(spec=httpx.Client)
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {"status": "CONFIRMED"}
    mock_client.post.return_value = mock_resp

    worker = UploadWorker(
        queue_mgr=queue_mgr,
        central_api_url="https://api.test",
        device_token="token-123",
        client=mock_client,
    )

    uploaded = worker.process_pending_queue_once()
    assert uploaded == 1
    mock_client.post.assert_called_once()
    queue_mgr.mark_clip_uploaded.assert_called_once()


def test_upload_worker_real_db_integration(tmp_path):
    from apps.agent.src.db import LocalQueueDB

    db = LocalQueueDB(db_path=tmp_path / "test_queue.db")
    queue_mgr = EventQueueManager(db=db)

    # 1. Enqueue trigger event
    event_id = queue_mgr.enqueue_trigger(
        command_id="cmd-int-1",
        field_id="field-int",
        trigger_source="PHYSICAL_BUTTON",
        trigger_ts=time.time(),
    )

    # 2. Add an extracted clip
    test_clip_file = tmp_path / "int_clip.mp4"
    test_clip_file.write_bytes(b"real-db-video-bytes")

    job = queue_mgr.add_clip_to_event(
        event_id=event_id,
        camera_id="cam_main",
        file_path=str(test_clip_file),
        duration=15.0,
        clip_id="clip_int_1",
    )

    worker = UploadWorker(
        queue_mgr=queue_mgr,
        central_api_url="https://api.real.test",
        device_token="token-real",
        retention_days=7,
    )

    # First attempt: network error -> verify DB records FAILED with attempts=1 and next_retry_at > now
    with patch("httpx.post", side_effect=Exception("Connection reset")):
        uploaded = worker.process_pending_queue_once()
        assert uploaded == 0

    clip_after_fail = db.get_clip("clip_int_1")
    assert clip_after_fail is not None
    assert clip_after_fail["status"] == "FAILED"
    assert clip_after_fail["attempts"] == 1
    assert clip_after_fail["next_retry_at"] > time.time()
    assert "Connection reset" in clip_after_fail["error"]
    assert test_clip_file.exists()

    # Second attempt while retry time is in future: skipped
    with patch("httpx.post") as mock_post:
        uploaded = worker.process_pending_queue_once()
        assert uploaded == 0
        mock_post.assert_not_called()

    # Fast forward retry time to allow retry
    db.update_clip_status("clip_int_1", status="FAILED", next_retry_at=time.time() - 1.0)

    # Third attempt: success -> verify DB records UPLOADED and event completed
    mock_ok = MagicMock()
    mock_ok.status_code = 200
    mock_ok.json.return_value = {"status": "CONFIRMED"}

    with patch("httpx.post", return_value=mock_ok):
        uploaded = worker.process_pending_queue_once()
        assert uploaded == 1

    clip_after_success = db.get_clip("clip_int_1")
    assert clip_after_success is not None
    assert clip_after_success["status"] == "UPLOADED"
    expected_sha = hashlib.sha256(b"real-db-video-bytes").hexdigest()
    assert clip_after_success["sha256"] == expected_sha

    event_record = db.get_event(event_id)
    assert event_record is not None
    assert event_record["status"] == "COMPLETED"
    assert test_clip_file.exists()  # Retained per 7-day retention policy

