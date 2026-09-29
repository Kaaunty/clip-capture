"""Entrypoint to launch the Clip Capture Local Field Agent."""

import logging
import os
from pathlib import Path
import subprocess
import threading
import time
import uvicorn

from apps.agent.src.buffer import CircularBufferManager
from apps.agent.src.config import AgentConfig
from apps.agent.src.db import LocalQueueDB
from apps.agent.src.extractor import ClipExtractor
from apps.agent.src.models import CameraConfig, CaptureProfileConfig
from apps.agent.src.queue import EventQueueManager
from apps.agent.src.server import create_agent_app
from apps.agent.src.uploader import UploadWorker

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("clip-capture-agent")


def run_synthetic_camera_feed(
    buffer_mgr: CircularBufferManager,
    cameras: list[CameraConfig],
    stop_event: threading.Event,
):
    """Periodically generate synthetic camera segments so circular buffer is continuously populated."""
    logger.info("Starting synthetic camera feed simulator...")
    seg_idx = 0
    seg_duration = 3.0

    while not stop_event.is_set():
        now = time.time()
        for cam in cameras:
            if not cam.is_active:
                continue
            cam_dir = buffer_mgr.get_camera_dir(cam.id)
            seg_file = cam_dir / f"seg_{seg_idx}_{cam.id}.mp4"
            cmd = [
                "ffmpeg",
                "-y",
                "-f",
                "lavfi",
                "-i",
                f"testsrc=duration={seg_duration}:size=320x240:rate=15",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-loglevel",
                "error",
                str(seg_file),
            ]
            try:
                subprocess.run(cmd, check=True)
                buffer_mgr.register_segment(cam.id, seg_file, start_ts=now, duration=seg_duration)
            except Exception as e:
                logger.warning("Error generating synthetic segment for %s: %s", cam.id, e)

        # Prune old segments to maintain buffer limits
        try:
            buffer_mgr.prune_old_segments()
        except Exception:
            pass

        seg_idx += 1
        stop_event.wait(timeout=2.8)


def main():
    field_id = os.getenv("FIELD_ID", "campo-1")
    central_api_url = os.getenv("CENTRAL_API_URL", "http://web:3000")
    device_token = os.getenv("DEVICE_TOKEN", "clip-capture-secret-demo-token")
    buffer_dir = Path(os.getenv("BUFFER_DIR", "/app/buffer"))
    db_path = Path(os.getenv("DB_PATH", "/app/data/queue.db"))
    port = int(os.getenv("PORT", "8000"))
    host = os.getenv("HOST", "0.0.0.0")
    mock_feed = os.getenv("MOCK_CAMERA_FEED", "true").lower() in ("true", "1", "yes")

    buffer_dir.mkdir(parents=True, exist_ok=True)
    db_path.parent.mkdir(parents=True, exist_ok=True)

    cameras = [
        CameraConfig(
            id="cam-1",
            name="Câmera Lateral / Linha Central",
            rtsp_url="rtsp://simulated-cam1/live",
            order=1,
            is_active=True,
        ),
        CameraConfig(
            id="cam-2",
            name="Câmera Gol Norte",
            rtsp_url="rtsp://simulated-cam2/live",
            order=2,
            is_active=True,
        ),
        CameraConfig(
            id="cam-3",
            name="Câmera Gol Sul (Offline)",
            rtsp_url="rtsp://simulated-cam3/live",
            order=3,
            is_active=False,
        ),
    ]

    agent_config = AgentConfig(
        field_id=field_id,
        central_api_url=central_api_url,
        device_token=device_token,
        buffer_dir=str(buffer_dir),
        default_profile=CaptureProfileConfig(seconds_before=15, seconds_after=10, retention_days=7),
        cameras=cameras,
    )

    buffer_mgr = CircularBufferManager(
        buffer_root=buffer_dir,
        config=agent_config,
    )
    extractor = ClipExtractor(buffer_mgr=buffer_mgr, config=agent_config)
    agent_db = LocalQueueDB(db_path=db_path)
    queue_mgr = EventQueueManager(db=agent_db, config=agent_config, extractor=extractor)

    # Initialize UploadWorker
    uploader = UploadWorker(
        queue_mgr=queue_mgr,
        config=agent_config,
    )
    uploader.start(poll_interval=1.5)
    logger.info("UploadWorker started in background.")

    stop_event = threading.Event()
    if mock_feed:
        sim_thread = threading.Thread(
            target=run_synthetic_camera_feed,
            args=(buffer_mgr, cameras, stop_event),
            daemon=True,
            name="SyntheticFeedThread",
        )
        sim_thread.start()

    app = create_agent_app(
        config=agent_config,
        db_path=db_path,
        queue_mgr=queue_mgr,
        extractor=extractor,
    )

    logger.info("Starting Clip Capture Agent server on %s:%d (Field ID: %s)", host, port, field_id)
    try:
        uvicorn.run(app, host=host, port=port, log_level="info")
    finally:
        stop_event.set()
        uploader.stop()


if __name__ == "__main__":
    main()
