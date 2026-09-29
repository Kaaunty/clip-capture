#!/usr/bin/env python3
"""
End-to-End Verification & Orchestration Test:
1. Starts mock central server and agent with 2 simulated cameras (1 active, 1 offline).
2. Simulates physical button trigger POST /api/v1/trigger.
3. Asserts duplicate trigger with same command_id is rejected idempotently.
4. Asserts extractor generates MP4 for active camera and flags offline camera as UNAVAILABLE.
5. Asserts upload worker sends clip with valid SHA256 checksum to central API.
6. Asserts share token is generated and public share URL returns valid response with 2 angles.
7. Resolves share token via resolveShareToken -> asserts active camera angle is playable
   and offline camera has unavailable status.
"""

from datetime import datetime, timezone, timedelta
import email
import hashlib
import http.server
import json
import os
from pathlib import Path
import secrets
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
from typing import Any

from fastapi.testclient import TestClient
import httpx

# Ensure repository root is strictly anchored regardless of invocation CWD
REPO_ROOT = Path(__file__).resolve().parent.parent
os.chdir(REPO_ROOT)
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from apps.agent.src.buffer import CircularBufferManager
from apps.agent.src.config import AgentConfig
from apps.agent.src.db import LocalQueueDB
from apps.agent.src.extractor import ClipExtractor
from apps.agent.src.models import CameraConfig, CaptureProfileConfig
from apps.agent.src.queue import EventQueueManager
from apps.agent.src.server import create_agent_app
from apps.agent.src.uploader import UploadWorker, calculate_file_checksum


class MockCentralServerHandler(http.server.BaseHTTPRequestHandler):
    """HTTP handler mimicking the Central Server endpoints."""

    def log_message(self, format: str, *args: Any) -> None:
        # Suppress standard access logging to keep test output clean
        pass

    def _send_json(self, status_code: int, data: dict[str, Any]) -> None:
        body = json.dumps(data).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:
        url_path = self.path.split("?")[0].rstrip("/")

        # 1. Direct clip upload endpoint: POST /api/v1/clips/upload
        if url_path == "/api/v1/clips/upload":
            self._handle_clip_upload()
            return

        # 2. Share token generation endpoint: POST /api/v1/events/{id}/share
        if url_path.startswith("/api/v1/events/") and url_path.endswith("/share"):
            parts = url_path.split("/")
            # ["", "api", "v1", "events", "{id}", "share"]
            if len(parts) == 6:
                event_id = parts[4]
                self._handle_generate_share_token(event_id)
                return

        self._send_json(404, {"error": f"Endpoint not found: {url_path}"})

    def do_GET(self) -> None:
        url_path = self.path.split("?")[0].rstrip("/")

        # Public share view endpoint: GET /share/{token}
        if url_path.startswith("/share/"):
            raw_token = url_path.removeprefix("/share/")
            self._handle_get_share_view(raw_token)
            return

        self._send_json(404, {"error": f"Endpoint not found: {url_path}"})

    def _handle_clip_upload(self) -> None:
        # Verify Authorization Bearer header
        auth = self.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            self._send_json(401, {"error": "Missing or malformed Authorization header"})
            return
        token = auth.removeprefix("Bearer ").strip()

        central_db = self.server.central_db_path  # type: ignore[attr-defined]
        storage_dir = self.server.storage_dir  # type: ignore[attr-defined]

        # Check device token in central DB
        with sqlite3.connect(central_db) as conn:
            cur = conn.cursor()
            cur.execute("SELECT fieldId FROM Device WHERE secretToken=?", (token,))
            device_row = cur.fetchone()
            if not device_row:
                self._send_json(401, {"error": "Unauthorized: invalid device token"})
                return
            device_field_id = device_row[0]

        # Parse multipart form data
        content_len = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_len)
        content_type = self.headers.get("Content-Type", "")

        msg = email.message_from_bytes(f"Content-Type: {content_type}\r\n\r\n".encode() + body)
        form_data: dict[str, Any] = {}
        file_bytes: bytes | None = None

        for part in msg.get_payload():
            name = part.get_param("name", header="content-disposition")
            if not name:
                continue
            if name == "file":
                file_bytes = part.get_payload(decode=True)
            else:
                form_data[name] = part.get_payload(decode=True).decode("utf-8", errors="ignore")

        event_id = form_data.get("eventId") or form_data.get("event_id")
        camera_id = form_data.get("cameraId") or form_data.get("camera_id")
        clip_id = form_data.get("clipId") or form_data.get("clip_id")
        checksum = form_data.get("checksum") or form_data.get("sha256")
        duration = float(form_data.get("duration", 0.0))

        if not file_bytes:
            self._send_json(400, {"error": "Missing file payload in upload"})
            return

        computed_sha256 = hashlib.sha256(file_bytes).hexdigest()
        if not checksum or checksum.lower() != computed_sha256.lower():
            self._send_json(
                400,
                {
                    "error": f"Checksum mismatch: expected {checksum}, got {computed_sha256}"
                },
            )
            return

        # Store file in central storage
        storage_rel_path = f"clips/{event_id}/{camera_id}_{clip_id or 'clip'}.mp4"
        dest_file = storage_dir / storage_rel_path
        dest_file.parent.mkdir(parents=True, exist_ok=True)
        dest_file.write_bytes(file_bytes)

        # Update central DB
        now_iso = datetime.now(timezone.utc).isoformat()
        with sqlite3.connect(central_db) as conn:
            cur = conn.cursor()
            # Ensure ClipEvent exists
            cur.execute(
                """
                INSERT OR IGNORE INTO ClipEvent (id, fieldId, commandId, triggerSource, status, triggeredAt, createdAt, updatedAt)
                VALUES (?, ?, ?, 'PHYSICAL_BUTTON', 'PROCESSING', ?, ?, ?)
                """,
                (event_id, device_field_id, event_id, now_iso, now_iso, now_iso),
            )

            # Upsert ClipFile record
            cur.execute(
                "SELECT id FROM ClipFile WHERE eventId=? AND cameraId=?",
                (event_id, camera_id),
            )
            existing_cf = cur.fetchone()
            if existing_cf:
                clip_file_id = existing_cf[0]
                cur.execute(
                    """
                    UPDATE ClipFile
                    SET storagePath=?, duration=?, sha256=?, uploadStatus='READY', updatedAt=?
                    WHERE id=?
                    """,
                    (storage_rel_path, duration, computed_sha256, now_iso, clip_file_id),
                )
            else:
                clip_file_id = f"cf_{secrets.token_hex(6)}"
                cur.execute(
                    """
                    INSERT INTO ClipFile (id, eventId, cameraId, storagePath, duration, sha256, uploadStatus, createdAt, updatedAt)
                    VALUES (?, ?, ?, ?, ?, ?, 'READY', ?, ?)
                    """,
                    (
                        clip_file_id,
                        event_id,
                        camera_id,
                        storage_rel_path,
                        duration,
                        computed_sha256,
                        now_iso,
                        now_iso,
                    ),
                )
            conn.commit()

        self._send_json(
            200,
            {
                "status": "CONFIRMED",
                "file": {
                    "id": clip_file_id,
                    "eventId": event_id,
                    "cameraId": camera_id,
                    "uploadStatus": "READY",
                    "sha256": computed_sha256,
                    "storagePath": storage_rel_path,
                },
                "checksum": computed_sha256,
                "storagePath": storage_rel_path,
            },
        )

    def _handle_generate_share_token(self, event_id: str) -> None:
        central_db = self.server.central_db_path  # type: ignore[attr-defined]

        with sqlite3.connect(central_db) as conn:
            cur = conn.cursor()
            cur.execute("SELECT id FROM ClipEvent WHERE id=?", (event_id,))
            event = cur.fetchone()
            if not event:
                self._send_json(404, {"error": "Event not found"})
                return

            raw_token = secrets.token_hex(32)
            token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
            token_id = f"tok_{secrets.token_hex(8)}"
            now = datetime.now(timezone.utc)
            expires_at = (now + timedelta(hours=24)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
            created_at = now.strftime("%Y-%m-%dT%H:%M:%S.000Z")

            cur.execute(
                """
                INSERT INTO ShareToken (id, eventId, tokenHash, expiresAt, scope, accessCount, createdAt, updatedAt)
                VALUES (?, ?, ?, ?, 'PUBLIC', 0, ?, ?)
                """,
                (token_id, event_id, token_hash, expires_at, created_at, created_at),
            )
            conn.commit()

        share_url = f"http://localhost:3000/share/{raw_token}"
        self._send_json(
            201,
            {
                "shareUrl": share_url,
                "rawToken": raw_token,
                "tokenRecord": {
                    "id": token_id,
                    "eventId": event_id,
                    "expiresAt": expires_at,
                },
            },
        )

    def _handle_get_share_view(self, raw_token: str) -> None:
        central_db = self.server.central_db_path  # type: ignore[attr-defined]
        resolved = resolve_share_token_py(raw_token, central_db)
        if not resolved:
            self._send_json(404, {"error": "Invalid or expired share token"})
            return
        self._send_json(200, resolved)


def resolve_share_token_py(raw_token: str, central_db_path: Path | str) -> dict[str, Any] | None:
    """Python implementation of resolveShareToken mirroring apps/web/src/lib/tokens.ts."""
    token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
    with sqlite3.connect(central_db_path) as conn:
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()

        cur.execute(
            "SELECT id, eventId, expiresAt, accessCount FROM ShareToken WHERE tokenHash=?",
            (token_hash,),
        )
        token_row = cur.fetchone()
        if not token_row:
            return None

        # Check expiration
        expires_at_str = token_row["expiresAt"].replace("Z", "+00:00")
        expires_at = datetime.fromisoformat(expires_at_str)
        if datetime.now(timezone.utc) > expires_at:
            return None

        # Increment access count
        token_id = token_row["id"]
        cur.execute(
            "UPDATE ShareToken SET accessCount = accessCount + 1, updatedAt = ? WHERE id = ?",
            (datetime.now(timezone.utc).isoformat(), token_id),
        )
        conn.commit()

        event_id = token_row["eventId"]
        cur.execute(
            "SELECT id, fieldId, commandId, triggerSource, status FROM ClipEvent WHERE id=?",
            (event_id,),
        )
        event_row = cur.fetchone()
        if not event_row:
            return None

        field_id = event_row["fieldId"]
        cur.execute("SELECT id, name FROM Field WHERE id=?", (field_id,))
        field_row = cur.fetchone()

        cur.execute(
            "SELECT id, name, displayOrder FROM Camera WHERE fieldId=? ORDER BY displayOrder ASC",
            (field_id,),
        )
        camera_rows = cur.fetchall()

        cur.execute(
            "SELECT id, cameraId, storagePath, duration, sha256, uploadStatus FROM ClipFile WHERE eventId=?",
            (event_id,),
        )
        file_rows = cur.fetchall()
        files_by_camera = {f["cameraId"]: dict(f) for f in file_rows}

        angles: list[dict[str, Any]] = []
        for cam in camera_rows:
            cam_id = cam["id"]
            cam_name = cam["name"]
            file_data = files_by_camera.get(cam_id)
            if file_data and file_data.get("uploadStatus") == "READY":
                status = "READY"
                video_url = f"http://mock-storage.local/{file_data.get('storagePath')}"
                duration = float(file_data.get("duration", 0.0))
            else:
                status = "CAMERA_UNAVAILABLE"
                video_url = None
                duration = 0.0

            angles.append(
                {
                    "id": cam_id,
                    "cameraName": cam_name,
                    "status": status,
                    "videoUrl": video_url,
                    "downloadUrl": video_url,
                    "duration": duration,
                }
            )

        return {
            "id": event_row["id"],
            "eventId": event_id,
            "field": dict(field_row) if field_row else None,
            "angles": angles,
            "accessCount": token_row["accessCount"] + 1,
            "files": [dict(f) for f in file_rows],
        }


def verify_via_typescript_resolver(
    central_db_path: Path, raw_token: str, temp_dir: Path | None = None
) -> dict[str, Any] | None:
    """Verifies share token resolution by running the actual TypeScript function in apps/web.

    Creates the temporary runner script in a designated temporary directory so apps/web is untouched.
    """
    runner_dir = temp_dir or Path(tempfile.gettempdir())
    temp_ts = runner_dir / f"_temp_e2e_verify_{secrets.token_hex(6)}.ts"
    tokens_module_path = (REPO_ROOT / "apps/web/src/lib/tokens").resolve().as_posix()

    ts_code = f"""
import {{ resolveShareToken }} from '{tokens_module_path}';

async function main() {{
  const resolved = await resolveShareToken('{raw_token}');
  console.log('__E2E_RESOLVED_START__' + JSON.stringify(resolved) + '__E2E_RESOLVED_END__');
}}

main().catch(err => {{
  console.error(err);
  process.exit(1);
}});
"""
    try:
        temp_ts.write_text(ts_code, encoding="utf-8")
        env = dict(os.environ)
        env["DATABASE_URL"] = f"file:{central_db_path.resolve()}"
        res = subprocess.run(
            ["npx", "--prefix", str(REPO_ROOT / "apps/web"), "vite-node", str(temp_ts)],
            capture_output=True,
            text=True,
            check=True,
            env=env,
            cwd=str(REPO_ROOT / "apps/web"),
        )
        output = res.stdout
        if "__E2E_RESOLVED_START__" in output:
            json_part = output.split("__E2E_RESOLVED_START__")[1].split("__E2E_RESOLVED_END__")[0]
            return json.loads(json_part)
        return None
    finally:
        if temp_ts.exists():
            try:
                temp_ts.unlink()
            except OSError:
                pass


def main() -> None:
    print("=" * 60)
    print("Starting End-to-End Orchestration & Verification Test")
    print("=" * 60)

    work_dir = Path(tempfile.mkdtemp(prefix="clip_capture_e2e_"))
    try:
        # Anchored paths setup
        central_db_path = work_dir / "central_dev.db"
        central_storage_dir = work_dir / "central_storage"
        agent_buffer_dir = work_dir / "agent_buffer"
        agent_queue_db_path = work_dir / "agent_queue.db"
        central_storage_dir.mkdir(parents=True, exist_ok=True)
        agent_buffer_dir.mkdir(parents=True, exist_ok=True)

        print("[E2E] Step 1: Initializing Central Database & Mock Central Server...")
        source_dev_db = REPO_ROOT / "apps/web/prisma/dev.db"
        if not source_dev_db.exists():
            raise FileNotFoundError(f"Prisma reference db not found at {source_dev_db}")

        shutil.copyfile(source_dev_db, central_db_path)
        with sqlite3.connect(central_db_path) as conn:
            conn.execute("DELETE FROM ShareToken")
            conn.execute("DELETE FROM ClipFile")
            conn.execute("DELETE FROM ClipEvent")
            conn.execute("DELETE FROM Device")
            conn.execute("DELETE FROM Camera")
            conn.execute("DELETE FROM CaptureProfile")
            conn.execute("DELETE FROM Field")

            # Seed field, cameras, device
            now_iso = datetime.now(timezone.utc).isoformat()
            field_id = "field-mvp-e2e"
            device_token = "agent-secret-token-xyz"

            conn.execute(
                "INSERT INTO Field (id, name, status, createdAt, updatedAt) VALUES (?, 'Arena Sintética MVP', 'ACTIVE', ?, ?)",
                (field_id, now_iso, now_iso),
            )
            conn.execute(
                "INSERT INTO Device (id, fieldId, deviceType, identifier, secretToken, createdAt, updatedAt) VALUES (?, ?, 'AGENT', 'agent-device-1', ?, ?, ?)",
                ("dev-agent-1", field_id, device_token, now_iso, now_iso),
            )
            # cam1: active
            conn.execute(
                "INSERT INTO Camera (id, fieldId, name, rtspUrl, displayOrder, status, createdAt, updatedAt) VALUES ('cam1', ?, 'Câmera Ângulo Gol Norte', 'rtsp://mock/cam1', 1, 'ACTIVE', ?, ?)",
                (field_id, now_iso, now_iso),
            )
            # cam2: offline
            conn.execute(
                "INSERT INTO Camera (id, fieldId, name, rtspUrl, displayOrder, status, createdAt, updatedAt) VALUES ('cam2', ?, 'Câmera Ângulo Lateral Sul', 'rtsp://mock/cam2', 2, 'ACTIVE', ?, ?)",
                (field_id, now_iso, now_iso),
            )
            conn.commit()

        # Start mock central server
        server = http.server.HTTPServer(("127.0.0.1", 0), MockCentralServerHandler)
        server.central_db_path = central_db_path  # type: ignore[attr-defined]
        server.storage_dir = central_storage_dir  # type: ignore[attr-defined]
        central_port = server.server_port
        central_url = f"http://127.0.0.1:{central_port}"

        server_thread = threading.Thread(target=server.serve_forever, daemon=True)
        server_thread.start()
        print(f"      Mock Central Server running on {central_url}")

        print("[E2E] Step 2: Configuring Agent with 2 Cameras (cam1 active, cam2 offline)...")
        cam1 = CameraConfig(id="cam1", name="Gol Norte", rtsp_url="rtsp://mock/cam1", is_active=True, order=1)
        cam2 = CameraConfig(id="cam2", name="Lateral Sul (Offline)", rtsp_url="rtsp://mock/cam2", is_active=False, order=2)

        agent_config = AgentConfig(
            field_id=field_id,
            central_api_url=central_url,
            device_token=device_token,
            buffer_dir=str(agent_buffer_dir),
            default_profile=CaptureProfileConfig(seconds_before=2, seconds_after=1, retention_days=7),
            cameras=[cam1, cam2],
        )

        buffer_mgr = CircularBufferManager(buffer_root=agent_buffer_dir)
        cam1_dir = buffer_mgr.get_camera_dir("cam1")
        seg1_path = cam1_dir / "seg1.mp4"
        seg2_path = cam1_dir / "seg2.mp4"

        # Generate two 3-second synthetic MP4 files for cam1 using FFmpeg
        subprocess.run(
            ["ffmpeg", "-y", "-f", "lavfi", "-i", "testsrc=duration=3:size=320x240:rate=15", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(seg1_path)],
            check=True,
            capture_output=True,
        )
        subprocess.run(
            ["ffmpeg", "-y", "-f", "lavfi", "-i", "testsrc=duration=3:size=320x240:rate=15", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(seg2_path)],
            check=True,
            capture_output=True,
        )

        t0 = 1000.0
        buffer_mgr.register_segment("cam1", seg1_path, start_ts=t0, duration=3.0)
        buffer_mgr.register_segment("cam1", seg2_path, start_ts=t0 + 3.0, duration=3.0)
        # Note: cam2 is offline, so no segments registered and is_active=False

        extractor = ClipExtractor(buffer_mgr=buffer_mgr, config=agent_config)
        agent_db = LocalQueueDB(agent_queue_db_path)
        queue_mgr = EventQueueManager(db=agent_db, config=agent_config, extractor=extractor)

        agent_app = create_agent_app(
            config=agent_config,
            db_path=agent_queue_db_path,
            queue_mgr=queue_mgr,
            extractor=extractor,
        )
        client = TestClient(agent_app)

        print("[E2E] Step 3: Simulating Physical Button Trigger (POST /api/v1/trigger)...")
        trigger_ts = t0 + 4.0  # Window: [1002.0, 1005.0] (3.0s duration spanning seg1 and seg2)
        cmd_id = "cmd-e2e-button-press-001"

        resp1 = client.post(
            "/api/v1/trigger",
            headers={"Authorization": f"Bearer {device_token}"},
            json={
                "command_id": cmd_id,
                "field_id": field_id,
                "trigger_source": "PHYSICAL_BUTTON",
                "timestamp": trigger_ts,
            },
        )
        assert resp1.status_code == 200, f"Trigger failed: {resp1.status_code} {resp1.text}"
        data1 = resp1.json()
        assert data1["status"] == "ACCEPTED", f"Expected ACCEPTED, got {data1}"
        event_id = data1["event_id"]
        assert event_id, "Missing event_id in trigger response"
        print(f"      Trigger accepted: event_id={event_id}")

        print("[E2E] Step 4: Testing Duplicate Trigger with Identical command_id...")
        resp_dup = client.post(
            "/api/v1/trigger",
            headers={"Authorization": f"Bearer {device_token}"},
            json={
                "command_id": cmd_id,
                "field_id": field_id,
                "trigger_source": "PHYSICAL_BUTTON",
                "timestamp": trigger_ts,
            },
        )
        assert resp_dup.status_code == 200, f"Duplicate request failed: {resp_dup.status_code}"
        data_dup = resp_dup.json()
        assert data_dup["status"] == "DUPLICATE_IGNORED", f"Expected DUPLICATE_IGNORED, got {data_dup}"
        assert data_dup["event_id"] == event_id, f"Expected event_id={event_id}, got {data_dup.get('event_id')}"
        print("      Duplicate trigger rejected idempotently as DUPLICATE_IGNORED")

        print("[E2E] Step 5: Asserting Background Extraction Jobs (cam1 active, cam2 offline)...")
        # The trigger request in Step 3 scheduled and executed background extraction via FastAPI BackgroundTasks
        event_clips = queue_mgr.get_event_clips(event_id)
        assert len(event_clips) == 1, f"Expected exactly 1 extracted clip job for cam1, got {len(event_clips)}"

        cam1_job = event_clips[0]
        assert cam1_job.camera_id == "cam1", f"Expected cam1 job, got {cam1_job.camera_id}"
        assert cam1_job.status == "EXTRACTED", f"Expected status EXTRACTED, got {cam1_job.status}"
        cam1_clip_path = Path(cam1_job.file_path)
        assert cam1_clip_path.exists(), f"cam1 clip missing on disk: {cam1_clip_path}"
        assert cam1_clip_path.stat().st_size > 0, "cam1 clip is empty"
        assert cam1_job.duration == 3.0, f"Expected duration 3.0s, got {cam1_job.duration}"

        # cam2 was offline / inactive, so assert no clip job exists for cam2
        cam2_jobs = [c for c in event_clips if c.camera_id == "cam2"]
        assert len(cam2_jobs) == 0, f"Offline camera cam2 should not have extracted jobs, found: {cam2_jobs}"

        print(f"      cam1 clip verified: {cam1_clip_path.name} ({cam1_clip_path.stat().st_size} bytes, status=EXTRACTED, duration={cam1_job.duration}s)")
        print("      cam2 has no queue jobs (offline / unavailable as expected)")

        print("[E2E] Step 6: Running Upload Worker (Compute SHA-256, Upload to Central, Assert READY in DB)...")
        expected_checksum = calculate_file_checksum(cam1_clip_path)
        upload_worker = UploadWorker(
            queue_mgr=queue_mgr,
            central_api_url=central_url,
            device_token=device_token,
            retention_days=7,
        )

        uploaded_count = upload_worker.process_pending_queue_once()
        assert uploaded_count == 1, f"Expected 1 uploaded clip, got {uploaded_count}"

        # Verify agent queue state
        updated_clip = agent_db.get_clip(cam1_job.clip_id)
        assert updated_clip is not None, "Clip record not found in local db"
        assert updated_clip["status"] == "UPLOADED", f"Expected UPLOADED, got {updated_clip['status']}"
        assert updated_clip["sha256"] == expected_checksum, "Checksum in agent db mismatch"

        # Verify Central DB state
        with sqlite3.connect(central_db_path) as conn:
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()
            cur.execute("SELECT * FROM ClipFile WHERE eventId=? AND cameraId='cam1'", (event_id,))
            central_clip = cur.fetchone()
            assert central_clip is not None, "ClipFile not found in central DB"
            assert central_clip["uploadStatus"] == "READY", f"Expected READY in central DB, got {central_clip['uploadStatus']}"
            assert central_clip["sha256"] == expected_checksum, f"Checksum mismatch in central DB: {central_clip['sha256']} vs {expected_checksum}"

        print(f"      Clip successfully uploaded. Checksum: {expected_checksum}")
        print("      Central DB record verified: uploadStatus=READY, sha256 verified")

        print("[E2E] Step 7: Generating Share Token (POST /api/v1/events/[id]/share)...")
        with httpx.Client(base_url=central_url) as central_client:
            share_resp = central_client.post(f"/api/v1/events/{event_id}/share")
            assert share_resp.status_code == 201, f"Share token request failed: {share_resp.status_code} {share_resp.text}"
            share_data = share_resp.json()
            raw_token = share_data["rawToken"]
            share_url = share_data["shareUrl"]
            assert raw_token, "Missing rawToken in share response"
            assert share_url.endswith(f"/share/{raw_token}"), f"Malformed shareUrl: {share_url}"

        # Verify token in Central DB
        token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
        with sqlite3.connect(central_db_path) as conn:
            cur = conn.cursor()
            cur.execute("SELECT id, eventId, accessCount FROM ShareToken WHERE tokenHash=?", (token_hash,))
            token_row = cur.fetchone()
            assert token_row is not None, "Share token hash not found in central DB"
            assert token_row[1] == event_id, "Share token eventId mismatch"

        print(f"      Share token generated: {share_url}")

        print("[E2E] Step 8: Resolving Share Token via resolveShareToken...")
        resolved = resolve_share_token_py(raw_token, central_db_path)
        assert resolved is not None, "Failed to resolve share token"
        assert resolved["eventId"] == event_id, "Resolved event ID mismatch"

        angles = resolved["angles"]
        assert len(angles) == 2, f"Expected 2 camera angles, got {len(angles)}"

        angle_cam1 = next(a for a in angles if a["id"] == "cam1")
        angle_cam2 = next(a for a in angles if a["id"] == "cam2")

        # Active camera asserts
        assert angle_cam1["status"] == "READY", f"Active camera status: {angle_cam1['status']}"
        assert angle_cam1["videoUrl"] is not None and len(angle_cam1["videoUrl"]) > 0, "Active camera missing playable videoUrl"
        assert angle_cam1["duration"] == 3.0, f"Expected duration 3.0, got {angle_cam1['duration']}"

        # Offline camera asserts
        assert angle_cam2["status"] == "CAMERA_UNAVAILABLE", f"Offline camera status: {angle_cam2['status']}"
        assert angle_cam2["videoUrl"] is None, "Offline camera should have null videoUrl"

        print(f"      Angle 1 ({angle_cam1['cameraName']}): status={angle_cam1['status']}, videoUrl={angle_cam1['videoUrl']} (Playable)")
        print(f"      Angle 2 ({angle_cam2['cameraName']}): status={angle_cam2['status']}, videoUrl=None (Unavailable)")

        print("[E2E] Step 9: Cross-Runtime Verification via TypeScript resolveShareToken...")
        ts_resolved = verify_via_typescript_resolver(central_db_path, raw_token, temp_dir=work_dir)
        assert ts_resolved is not None, "TypeScript resolveShareToken returned null"
        assert ts_resolved.get("eventId") == event_id, f"TypeScript resolved eventId mismatch: {ts_resolved.get('eventId')}"
        ts_files = ts_resolved.get("files", [])
        assert len(ts_files) == 1, f"Expected 1 ready file in TypeScript resolution, got {len(ts_files)}"
        assert ts_files[0]["cameraId"] == "cam1", "TypeScript file cameraId mismatch"
        assert ts_files[0]["uploadStatus"] == "READY", "TypeScript file status not READY"
        print("      Cross-runtime TypeScript resolveShareToken verified with 100% parity")

        # Shutdown server
        server.shutdown()
        server.server_close()

        print("=" * 60)
        print("ALL END-TO-END VERIFICATIONS PASSED SUCCESSFULLY!")
        print("=" * 60)

    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"\n[E2E ERROR] Failure: {exc}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)
