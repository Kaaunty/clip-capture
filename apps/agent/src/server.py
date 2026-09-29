"""FastAPI HTTP service for local event ingestion and health monitoring."""

from pathlib import Path
import secrets
import time
from typing import Annotated

from fastapi import BackgroundTasks, FastAPI, Header, HTTPException, status
from fastapi.responses import JSONResponse

from apps.agent.src.config import AgentConfig
from apps.agent.src.db import LocalQueueDB
from apps.agent.src.extractor import ClipExtractor
from apps.agent.src.models import TriggerCommandPayload
from apps.agent.src.queue import DuplicateTriggerError, EventQueueManager


def create_agent_app(
    config: AgentConfig,
    db_path: Path | str | None = None,
    queue_mgr: EventQueueManager | None = None,
    extractor: ClipExtractor | None = None,
) -> FastAPI:
    """Create and configure FastAPI application for field agent."""
    app = FastAPI(title="Clip Capture Local Agent", version="0.1.0")

    if queue_mgr is None:
        db = LocalQueueDB(db_path=db_path or "queue.db")
        queue_mgr = EventQueueManager(db=db, config=config, extractor=extractor)

    app.state.config = config
    app.state.queue_mgr = queue_mgr
    app.state.extractor = extractor

    @app.get("/health")
    @app.get("/api/v1/health")
    async def health_check():
        return {"status": "ok", "field_id": config.field_id}

    @app.post("/api/v1/trigger")
    async def handle_trigger(
        payload: TriggerCommandPayload,
        background_tasks: BackgroundTasks,
        authorization: Annotated[str | None, Header()] = None,
    ):
        # 1. Bearer Token Authentication using constant-time comparison
        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Missing or malformed Authorization header",
            )
        token = authorization.removeprefix("Bearer ").strip()
        if not secrets.compare_digest(token, config.device_token):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid device authentication token",
            )

        field_id = payload.field_id or config.field_id
        trigger_ts = payload.timestamp if payload.timestamp is not None else time.time()

        # 2. Ingestion into persistent queue with duplicate / debounce check
        try:
            event_id = queue_mgr.enqueue_trigger(
                command_id=payload.command_id,
                field_id=field_id,
                trigger_source=payload.trigger_source,
                trigger_ts=trigger_ts,
            )
        except DuplicateTriggerError as e:
            return JSONResponse(
                status_code=status.HTTP_200_OK,
                content={
                    "status": "DUPLICATE_IGNORED",
                    "command_id": payload.command_id,
                    "event_id": e.existing_event_id,
                    "message": str(e),
                },
            )

        # 3. Schedule extraction if extractor configured with active cameras
        if extractor is not None and config.cameras:
            background_tasks.add_task(queue_mgr.schedule_extraction, event_id, trigger_ts)

        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={
                "status": "ACCEPTED",
                "event_id": event_id,
                "command_id": payload.command_id,
            },
        )

    return app
