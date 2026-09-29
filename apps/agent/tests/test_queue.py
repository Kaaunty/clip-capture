import time
import pytest
from apps.agent.src.db import LocalQueueDB
from apps.agent.src.queue import EventQueueManager, ClipJob, DuplicateTriggerError


def test_queue_persists_across_instances(tmp_path):
    db_file = tmp_path / "queue.db"
    db1 = LocalQueueDB(db_path=db_file)
    q1 = EventQueueManager(db=db1)

    evt_id = q1.enqueue_trigger(
        command_id="cmd-1",
        field_id="f1",
        trigger_source="BUTTON",
        trigger_ts=time.time(),
    )
    q1.add_clip_to_event(
        event_id=evt_id,
        camera_id="cam1",
        file_path="/tmp/c1.mp4",
        duration=15.0,
    )

    # Re-instantiate DB from file
    db2 = LocalQueueDB(db_path=db_file)
    q2 = EventQueueManager(db=db2)
    pending = q2.get_pending_clips()
    assert len(pending) == 1
    assert pending[0].event_id == evt_id
    assert pending[0].camera_id == "cam1"
    assert pending[0].duration == 15.0


def test_queue_deduplication_identical_command(tmp_path):
    db_file = tmp_path / "queue.db"
    db = LocalQueueDB(db_path=db_file)
    q = EventQueueManager(db=db)

    now = time.time()
    evt1 = q.enqueue_trigger(
        command_id="cmd-dup-1",
        field_id="f1",
        trigger_source="PHYSICAL_BUTTON",
        trigger_ts=now,
    )
    assert evt1 is not None

    with pytest.raises(DuplicateTriggerError):
        q.enqueue_trigger(
            command_id="cmd-dup-1",
            field_id="f1",
            trigger_source="PHYSICAL_BUTTON",
            trigger_ts=now + 0.5,
        )


def test_queue_deduplication_button_within_3s(tmp_path):
    db_file = tmp_path / "queue.db"
    db = LocalQueueDB(db_path=db_file)
    q = EventQueueManager(db=db)

    base_time = time.time()
    evt1 = q.enqueue_trigger(
        command_id="cmd-btn-1",
        field_id="f1",
        trigger_source="PHYSICAL_BUTTON",
        trigger_ts=base_time,
    )
    assert evt1 is not None

    # Another button press within 2.0s on the same field with a different command_id
    with pytest.raises(DuplicateTriggerError):
        q.enqueue_trigger(
            command_id="cmd-btn-2",
            field_id="f1",
            trigger_source="PHYSICAL_BUTTON",
            trigger_ts=base_time + 2.0,
        )


def test_queue_allows_button_after_3s(tmp_path):
    db_file = tmp_path / "queue.db"
    db = LocalQueueDB(db_path=db_file)
    q = EventQueueManager(db=db)

    base_time = 1000.0
    evt1 = q.enqueue_trigger(
        command_id="cmd-btn-1",
        field_id="f1",
        trigger_source="PHYSICAL_BUTTON",
        trigger_ts=base_time,
    )
    assert evt1 is not None

    # After 3.5s, second button press is accepted
    evt2 = q.enqueue_trigger(
        command_id="cmd-btn-2",
        field_id="f1",
        trigger_source="PHYSICAL_BUTTON",
        trigger_ts=base_time + 3.5,
    )
    assert evt2 is not None
    assert evt2 != evt1


def test_queue_clip_lifecycle_transitions(tmp_path):
    db_file = tmp_path / "queue.db"
    db = LocalQueueDB(db_path=db_file)
    q = EventQueueManager(db=db)

    evt_id = q.enqueue_trigger(
        command_id="cmd-lifecycle",
        field_id="f1",
        trigger_source="API",
        trigger_ts=time.time(),
    )
    job = q.add_clip_to_event(
        event_id=evt_id,
        camera_id="cam1",
        file_path="/tmp/c1.mp4",
        duration=10.0,
    )
    assert isinstance(job, ClipJob)
    assert job.status == "EXTRACTED"
    assert job.attempts == 0

    # Mark clip processing
    q.mark_clip_processing(job.clip_id)
    clips = q.get_event_clips(evt_id)
    assert clips[0].status == "PROCESSING"

    # Mark clip failed with backoff
    q.mark_clip_failed(
        clip_id=job.clip_id,
        attempts=1,
        backoff_seconds=15.0,
        error="Network error",
    )
    clips = q.get_event_clips(evt_id)
    assert clips[0].status == "FAILED"
    assert clips[0].attempts == 1
    assert clips[0].error == "Network error"
    assert clips[0].next_retry_at > time.time()

    # Mark clip uploaded
    q.mark_clip_uploaded(job.clip_id, sha256="abc123sha")
    clips = q.get_event_clips(evt_id)
    assert clips[0].status == "UPLOADED"
    assert clips[0].sha256 == "abc123sha"

    # Verify no pending uploads remain
    assert len(q.get_pending_clips()) == 0
    assert len(q.get_pending_uploads()) == 0


def test_schedule_extraction_with_extracted_status(tmp_path):
    from unittest.mock import MagicMock
    from apps.agent.src.config import AgentConfig, CameraConfig, CaptureProfileConfig
    from apps.agent.src.models import ClipExtractionResult
    from apps.agent.src.extractor import ClipExtractor

    db_file = tmp_path / "queue.db"
    db = LocalQueueDB(db_path=db_file)
    clip_file = tmp_path / "cam1_clip.mp4"
    clip_file.write_bytes(b"dummy-video-data")

    config = AgentConfig(
        field_id="f1",
        central_api_url="https://api.test",
        device_token="valid-token",
        buffer_dir=str(tmp_path / "buf"),
        storage_limit_mb=1000,
        default_profile=CaptureProfileConfig(seconds_before=10, seconds_after=5),
        cameras=[CameraConfig(id="cam1", name="Angle 1", rtsp_url="rtsp://test/1")],
    )

    mock_extractor = MagicMock(spec=ClipExtractor)
    mock_extractor.extract_event_clips.return_value = [
        ClipExtractionResult(
            camera_id="cam1",
            status="EXTRACTED",
            output_path=clip_file,
            duration=15.0,
        )
    ]

    q = EventQueueManager(db=db, config=config, extractor=mock_extractor)
    evt_id = q.enqueue_trigger(
        command_id="cmd-extract",
        field_id="f1",
        trigger_source="PHYSICAL_BUTTON",
        trigger_ts=time.time(),
    )
    assert q.get_event(evt_id)["status"] == "QUEUED"

    jobs = q.schedule_extraction(event_id=evt_id, trigger_ts=time.time())
    assert len(jobs) == 1
    assert jobs[0].event_id == evt_id
    assert jobs[0].camera_id == "cam1"
    assert jobs[0].status == "EXTRACTED"
    assert jobs[0].file_path == str(clip_file)

    # Event status should have transitioned to EXTRACTED
    evt_record = q.get_event(evt_id)
    assert evt_record["status"] == "EXTRACTED"


def test_schedule_extraction_handles_unexpected_exception(tmp_path):
    from unittest.mock import MagicMock
    from apps.agent.src.config import AgentConfig, CameraConfig, CaptureProfileConfig
    from apps.agent.src.extractor import ClipExtractor

    db_file = tmp_path / "queue.db"
    db = LocalQueueDB(db_path=db_file)

    config = AgentConfig(
        field_id="f1",
        central_api_url="https://api.test",
        device_token="valid-token",
        buffer_dir=str(tmp_path / "buf"),
        storage_limit_mb=1000,
        default_profile=CaptureProfileConfig(seconds_before=10, seconds_after=5),
        cameras=[CameraConfig(id="cam1", name="Angle 1", rtsp_url="rtsp://test/1")],
    )

    mock_extractor = MagicMock(spec=ClipExtractor)
    mock_extractor.extract_event_clips.side_effect = RuntimeError("Extraction crashed")

    q = EventQueueManager(db=db, config=config, extractor=mock_extractor)
    evt_id = q.enqueue_trigger(
        command_id="cmd-crash",
        field_id="f1",
        trigger_source="PHYSICAL_BUTTON",
        trigger_ts=time.time(),
    )

    jobs = q.schedule_extraction(event_id=evt_id, trigger_ts=time.time())
    assert jobs == []

    # Event status should be marked FAILED on unexpected crash
    evt_record = q.get_event(evt_id)
    assert evt_record["status"] == "FAILED"


def test_reboot_recovers_stale_processing_clips(tmp_path):
    db_file = tmp_path / "queue.db"
    db = LocalQueueDB(db_path=db_file)
    q = EventQueueManager(db=db)

    evt_id = q.enqueue_trigger(
        command_id="cmd-reboot-test",
        field_id="f1",
        trigger_source="PHYSICAL_BUTTON",
        trigger_ts=time.time(),
    )
    job = q.add_clip_to_event(
        event_id=evt_id,
        camera_id="cam1",
        file_path="/tmp/c_reboot.mp4",
        duration=10.0,
    )

    # Mark clip processing as if an upload was mid-flight
    q.mark_clip_processing(job.clip_id)
    assert db.get_clip(job.clip_id)["status"] == "PROCESSING"

    # Simulate agent crash & reboot: new EventQueueManager initialized on same DB
    rebooted_q = EventQueueManager(db=db, reset_stale_on_init=True)

    # Verify clip status was recovered back to EXTRACTED and is pending upload
    clip_after_reboot = db.get_clip(job.clip_id)
    assert clip_after_reboot["status"] == "EXTRACTED"
    pending = rebooted_q.get_pending_clips()
    assert any(c.clip_id == job.clip_id for c in pending)
