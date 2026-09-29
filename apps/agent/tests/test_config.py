import pytest
from pydantic import ValidationError
from apps.agent.src.config import load_agent_config
from apps.agent.src.models import CameraConfig, CaptureProfileConfig, AgentConfig, TriggerCommandPayload, ClipMetadata


def test_load_agent_config_valid():
    raw = {
        "field_id": "field-1",
        "central_api_url": "https://api.clipcapture.local",
        "device_token": "secret-token-123",
        "buffer_dir": "/tmp/clip-buffer",
        "storage_limit_mb": 5000,
        "default_profile": {"seconds_before": 15, "seconds_after": 10},
        "cameras": [
            {"id": "cam-1", "name": "Gol Norte", "rtsp_url": "rtsp://camera1:554/live", "order": 1}
        ],
    }
    cfg = load_agent_config(raw)
    assert cfg.field_id == "field-1"
    assert len(cfg.cameras) == 1
    assert cfg.default_profile.seconds_before == 15
    assert cfg.default_profile.seconds_after == 10


def test_load_agent_config_invalid():
    raw = {
        "field_id": "field-1",
    }
    with pytest.raises(ValidationError):
        load_agent_config(raw)


def test_trigger_command_payload_model():
    payload = TriggerCommandPayload(
        command_id="cmd-123",
        trigger_source="PHYSICAL_BUTTON",
        timestamp=1700000000.0,
    )
    assert payload.command_id == "cmd-123"
    assert payload.trigger_source == "PHYSICAL_BUTTON"


def test_clip_metadata_model():
    meta = ClipMetadata(
        clip_id="clip-1",
        event_id="evt-1",
        camera_id="cam-1",
        file_path="/tmp/c1.mp4",
        duration=15.0,
        sha256="abc123hash",
        status="EXTRACTED",
    )
    assert meta.clip_id == "clip-1"
    assert meta.duration == 15.0
