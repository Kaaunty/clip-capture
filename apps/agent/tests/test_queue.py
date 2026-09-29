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
