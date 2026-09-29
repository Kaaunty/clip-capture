"""Pydantic data models for Clip Capture Agent."""

from pathlib import Path
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field


class CameraConfig(BaseModel):
    """Configuration for an RTSP camera stream."""

    id: str
    name: str
    rtsp_url: str
    order: int = 1
    is_active: bool = True


class CaptureProfileConfig(BaseModel):
    """Configuration for capture window and retention policy."""

    seconds_before: int = Field(default=15, ge=0)
    seconds_after: int = Field(default=10, ge=0)
    retention_days: int = Field(default=7, ge=1)
    format: str = "mp4"


class AgentConfig(BaseModel):
    """Full operational configuration for the local field agent."""

    field_id: str
    central_api_url: str
    device_token: str
    buffer_dir: str
    storage_limit_mb: int = 5000
    default_profile: CaptureProfileConfig = Field(default_factory=CaptureProfileConfig)
    cameras: list[CameraConfig] = Field(default_factory=list)


class TriggerCommandPayload(BaseModel):
    """Payload received when a clip capture event is triggered."""

    command_id: str
    trigger_source: Literal["PHYSICAL_BUTTON", "WEB_INTERFACE", "API"] = "PHYSICAL_BUTTON"
    timestamp: float | None = None
    field_id: str | None = None


class ClipMetadata(BaseModel):
    """Metadata describing an extracted video clip before or during upload."""

    clip_id: str
    event_id: str
    camera_id: str
    file_path: str
    duration: float
    sha256: str | None = None
    status: str = "QUEUED"
    created_at: float | None = None


class ClipExtractionResult(BaseModel):
    """Outcome of clip extraction for a single camera stream."""

    model_config = ConfigDict(arbitrary_types_allowed=True)

    camera_id: str
    status: str
    output_path: Path | None = None
    duration: float = 0.0
    error: str | None = None

    def __init__(
        self,
        camera_id: str,
        status: str,
        output_path: Path | str | None = None,
        duration: float = 0.0,
        error: str | None = None,
        **kwargs,
    ):
        super().__init__(
            camera_id=camera_id,
            status=status,
            output_path=Path(output_path) if output_path is not None else None,
            duration=float(duration),
            error=error,
            **kwargs,
        )

