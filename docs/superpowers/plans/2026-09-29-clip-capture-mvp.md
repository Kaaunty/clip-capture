# Clip Capture MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar o sistema completo Clip Capture MVP, composto pelo Agente Local de Campo (buffer contínuo circular RTSP, acionamento por botão/web, recorte por câmera e fila de upload resiliente) e Servidor Central/Web (API PostgreSQL, armazenamento S3, página responsiva de lances com link privado temporário e painel operacional).

**Architecture:** Monorepo composto por dois subsistemas: `apps/agent` em Python (FastAPI, SQLite local para fila persistente, FFmpeg para buffer circular e recorte multi-câmera) e `apps/web` em TypeScript/Node.js (Next.js App Router, Prisma ORM com PostgreSQL, cliente S3 para vídeos, tokens de compartilhamento com hash e expiração, e interface web responsiva).

**Tech Stack:** Python 3.14 (FastAPI, Pytest, Pydantic, SQLite, FFmpeg subprocess), TypeScript / Node.js 26 (Next.js 15, React 19, Tailwind CSS, Prisma, @aws-sdk/client-s3, Vitest).

**Spec:** docs/superpowers/specs/2026-09-28-clip-capture-design.md

## Global Constraints

- Cada campo possui várias câmeras e gera um arquivo separado por ângulo.
- A janela de captura é configurável por campo, com tempo anterior e posterior ao acionamento.
- O processamento e o buffer acontecem localmente no campo; a internet é usada somente para enviar clipes finalizados.
- O acesso ocorre por link privado com validade, adequado para compartilhamento por WhatsApp.
- Dois cliques: cada comando aceito cria um evento próprio; identificadores de comando evitam duplicar em retries rápidos (janela de 3s).
- Câmera offline: o evento continua com os demais ângulos e marca a câmera como indisponível sem travar o processamento dos demais.
- Internet fora do ar: os arquivos permanecem na fila local até a reconexão; upload interrompido retenta com backoff exponencial sem remover arquivo original antes de confirmação segura.
- Pouco espaço em disco: buffer circular remove segmentos antigos; clipes em fila não confirmados têm prioridade de preservação.
- Segurança e privacidade: credenciais RTSP não são expostas ao navegador nem gravadas em texto plano; storage S3 não é público; links usam tokens aleatórios criptográficos com expiração.

## Review Focus

1. **Cliques duplicados rápidos no botão físico:** detecção de duplicatas por `command_id` ou intervalo menor que 3 segundos para o mesmo botão/campo, respondendo de forma idempotente sem duplicar extração de vídeo. (Coberto em Task 4: `apps/agent/tests/test_server.py::test_duplicate_trigger_rejection`).
2. **Câmera offline ou queda de RTSP durante acionamento:** quando uma câmera falha, o agente prossegue gerando os clipes das câmeras ativas, registra status `CAMERA_UNAVAILABLE` para a câmera afetada e não aborta o evento. (Coberto em Task 3: `apps/agent/tests/test_extractor.py::test_extraction_with_offline_camera`).
3. **Queda de conexão à internet antes ou durante upload:** fila persistente local mantém os arquivos em disco e retenta com backoff exponencial, deletando os arquivos locais somente após validação de checksum e confirmação do servidor central. (Coberto em Task 5: `apps/agent/tests/test_uploader.py::test_upload_retry_with_backoff`).
4. **Link privado expirado ou token inválido:** acesso a `/share/[token]` com token inválido ou já expirado deve retornar erro HTTP 404/410 amigável sem expor URLs diretas nem permitir download. (Coberto em Task 8: `apps/web/tests/tokens.test.ts::test_expired_token_rejected`).
5. **Pressão de disco no agente de campo:** limpeza do buffer circular remove estritamente segmentos de histórico de streaming, protegendo clipes de eventos pendentes de upload ou ainda dentro do período de retenção local. (Coberto em Task 2: `apps/agent/tests/test_buffer.py::test_prune_preserves_unconfirmed_events`).

---

### Task 1: Monorepo Foundation & Contract Schemas

**Files:**
- Create: `apps/agent/pyproject.toml`
- Create: `apps/agent/src/__init__.py`
- Create: `apps/agent/src/config.py`
- Create: `apps/agent/src/models.py`
- Create: `apps/web/package.json`
- Create: `apps/web/src/types/contracts.ts`
- Test: `apps/agent/tests/test_config.py`
- Test: `apps/web/tests/contracts.test.ts`

**Interfaces:**
- Consumes: None (Root setup)
- Produces:
  - Python: `AgentConfig`, `CameraConfig`, `CaptureProfileConfig`, `TriggerCommandPayload`, `ClipMetadata`
  - TypeScript: `FieldContract`, `CameraContract`, `ClipEventContract`, `ClipFileContract`, `ShareTokenContract`

- [ ] **Step 1: Write failing tests for configuration parsing and validation**

In `apps/agent/tests/test_config.py`:
```python
from apps.agent.src.config import load_agent_config
from apps.agent.src.models import CameraConfig, CaptureProfileConfig

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
        ]
    }
    cfg = load_agent_config(raw)
    assert cfg.field_id == "field-1"
    assert len(cfg.cameras) == 1
    assert cfg.default_profile.seconds_before == 15
    assert cfg.default_profile.seconds_after == 10
```

In `apps/web/tests/contracts.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { validateClipEventPayload } from '../src/types/contracts';

describe('Contracts Validation', () => {
  it('validates a valid event payload', () => {
    const payload = {
      fieldId: 'field-1',
      triggeredAt: new Date().toISOString(),
      commandId: 'cmd-123',
      triggerSource: 'PHYSICAL_BUTTON' as const,
    };
    expect(validateClipEventPayload(payload)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest apps/agent/tests/test_config.py -v`
Expected: FAIL with ModuleNotFoundError or ImportError

- [ ] **Step 3: Implement project configuration and contract schemas**

Implement `apps/agent/pyproject.toml`, `apps/agent/src/config.py`, `apps/agent/src/models.py`, `apps/web/package.json`, and `apps/web/src/types/contracts.ts` using Pydantic in Python and TypeScript interfaces/validators.

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest apps/agent/tests/test_config.py -v && npx vitest run apps/web/tests/contracts.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/agent apps/web
git commit -m "feat: initialize monorepo structure and shared contracts"
```

---

### Task 2: Agent - Continuous Circular Buffer Manager

**Files:**
- Create: `apps/agent/src/buffer.py`
- Test: `apps/agent/tests/test_buffer.py`

**Interfaces:**
- Consumes: `CameraConfig`, `AgentConfig` from Task 1
- Produces: `CircularBufferManager`, `CameraSegment`, `StreamStatus`
  - `CircularBufferManager.register_segment(camera_id: str, segment_path: Path, start_ts: float, duration: float)`
  - `CircularBufferManager.get_segments_for_window(camera_id: str, start_ts: float, end_ts: float) -> list[Path]`
  - `CircularBufferManager.prune_old_segments(max_age_seconds: int, reserved_event_paths: set[Path]) -> int`
  - `CircularBufferManager.get_camera_health(camera_id: str) -> dict`

- [ ] **Step 1: Write failing tests for circular buffer segmentation and pruning**

In `apps/agent/tests/test_buffer.py`:
```python
import time
from pathlib import Path
from apps.agent.src.buffer import CircularBufferManager

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest apps/agent/tests/test_buffer.py -v`
Expected: FAIL with ImportError: cannot import name 'CircularBufferManager'

- [ ] **Step 3: Implement `CircularBufferManager` in `apps/agent/src/buffer.py`**

Implement segment indexing by camera, timestamp intersection calculations, stream heartbeat tracking, and safe pruning logic respecting `reserved_paths`.

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest apps/agent/tests/test_buffer.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/agent/src/buffer.py apps/agent/tests/test_buffer.py
git commit -m "feat(agent): implement circular buffer manager and segment pruning"
```

---

### Task 3: Agent - Multi-Camera Clip Extractor

**Files:**
- Create: `apps/agent/src/extractor.py`
- Test: `apps/agent/tests/test_extractor.py`

**Interfaces:**
- Consumes: `CircularBufferManager` from Task 2, `CaptureProfileConfig` from Task 1
- Produces: `ClipExtractor`, `ClipExtractionResult`
  - `ClipExtractor.extract_event_clips(event_id: str, trigger_ts: float, profile: CaptureProfileConfig, cameras: list[CameraConfig]) -> list[ClipExtractionResult]`
  - `ClipExtractionResult(camera_id: str, status: str, output_path: Path | None, duration: float, error: str | None)`

- [ ] **Step 1: Write failing tests for clip extraction and offline camera handling**

In `apps/agent/tests/test_extractor.py`:
```python
import time
from pathlib import Path
from unittest.mock import MagicMock
from apps.agent.src.extractor import ClipExtractor
from apps.agent.src.models import CameraConfig, CaptureProfileConfig
from apps.agent.src.buffer import CircularBufferManager

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest apps/agent/tests/test_extractor.py -v`
Expected: FAIL with ImportError: cannot import name 'ClipExtractor'

- [ ] **Step 3: Implement `ClipExtractor` in `apps/agent/src/extractor.py`**

Implement window segment aggregation, FFmpeg concat/trim wrapper using `ffmpeg` CLI with copy/re-encode fallback, output naming convention `event_{event_id}_cam_{camera_id}.mp4`, and non-blocking handling of cameras without segments.

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest apps/agent/tests/test_extractor.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/agent/src/extractor.py apps/agent/tests/test_extractor.py
git commit -m "feat(agent): implement multi-camera clip extractor with offline fallback"
```

---

### Task 4: Agent - Local Event Ingestion & Persistent Job Queue

**Files:**
- Create: `apps/agent/src/db.py`
- Create: `apps/agent/src/queue.py`
- Create: `apps/agent/src/server.py`
- Test: `apps/agent/tests/test_queue.py`
- Test: `apps/agent/tests/test_server.py`

**Interfaces:**
- Consumes: `ClipExtractor` from Task 3, `TriggerCommandPayload` from Task 1
- Produces: `LocalQueueDB`, `EventQueueManager`, FastAPI endpoint `POST /api/v1/trigger`
  - `EventQueueManager.enqueue_trigger(command_id: str, field_id: str, trigger_source: str, trigger_ts: float) -> str (event_id)`
  - `EventQueueManager.get_pending_uploads() -> list[ClipJob]`
  - Deduplication: rejects identical `command_id` or same button trigger within 3 seconds.

- [ ] **Step 1: Write failing tests for queue persistence and deduplication**

In `apps/agent/tests/test_queue.py`:
```python
import time
from apps.agent.src.db import LocalQueueDB
from apps.agent.src.queue import EventQueueManager

def test_queue_persists_across_instances(tmp_path):
    db_file = tmp_path / "queue.db"
    db1 = LocalQueueDB(db_path=db_file)
    q1 = EventQueueManager(db=db1)
    
    evt_id = q1.enqueue_trigger(command_id="cmd-1", field_id="f1", trigger_source="BUTTON", trigger_ts=time.time())
    q1.add_clip_to_event(event_id=evt_id, camera_id="cam1", file_path="/tmp/c1.mp4", duration=15.0)

    # Re-instantiate DB from file
    db2 = LocalQueueDB(db_path=db_file)
    q2 = EventQueueManager(db=db2)
    pending = q2.get_pending_clips()
    assert len(pending) == 1
    assert pending[0].event_id == evt_id
    assert pending[0].camera_id == "cam1"
```

In `apps/agent/tests/test_server.py`:
```python
import time
from fastapi.testclient import TestClient
from apps.agent.src.server import create_agent_app
from apps.agent.src.config import AgentConfig, CaptureProfileConfig

def test_duplicate_trigger_rejection(tmp_path):
    config = AgentConfig(
        field_id="f1",
        central_api_url="https://api.test",
        device_token="valid-token",
        buffer_dir=str(tmp_path / "buf"),
        storage_limit_mb=1000,
        default_profile=CaptureProfileConfig(seconds_before=10, seconds_after=5),
        cameras=[]
    )
    app = create_agent_app(config=config, db_path=tmp_path / "test.db")
    client = TestClient(app)

    now = time.time()
    payload = {"command_id": "cmd-abc", "trigger_source": "PHYSICAL_BUTTON", "timestamp": now}
    headers = {"Authorization": "Bearer valid-token"}

    # First call succeeds
    res1 = client.post("/api/v1/trigger", json=payload, headers=headers)
    assert res1.status_code == 200
    assert res1.json()["status"] == "ACCEPTED"

    # Immediate second call with same command_id is idempotent / deduplicated
    res2 = client.post("/api/v1/trigger", json=payload, headers=headers)
    assert res2.status_code == 200
    assert res2.json()["status"] == "DUPLICATE_IGNORED"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest apps/agent/tests/test_queue.py apps/agent/tests/test_server.py -v`
Expected: FAIL with ModuleNotFoundError or ImportError

- [ ] **Step 3: Implement SQLite DB, Queue Manager, and FastAPI trigger server**

Implement `apps/agent/src/db.py` (SQLite tables: `events`, `clips`, `recent_commands`), `apps/agent/src/queue.py` (idempotency checks, status transitions: `QUEUED`, `PROCESSING`, `EXTRACTED`, `UPLOADED`, `FAILED`), and `apps/agent/src/server.py` with auth middleware and POST `/api/v1/trigger`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest apps/agent/tests/test_queue.py apps/agent/tests/test_server.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/agent/src/db.py apps/agent/src/queue.py apps/agent/src/server.py apps/agent/tests/test_queue.py apps/agent/tests/test_server.py
git commit -m "feat(agent): implement persistent sqlite queue and deduplicated trigger api"
```

---

### Task 5: Agent - Sync & Resilient Upload Worker

**Files:**
- Create: `apps/agent/src/uploader.py`
- Test: `apps/agent/tests/test_uploader.py`

**Interfaces:**
- Consumes: `EventQueueManager` from Task 4, `AgentConfig` from Task 1
- Produces: `UploadWorker`, `calculate_file_checksum(file_path: Path) -> str`
  - `UploadWorker.process_pending_queue_once() -> int`
  - Retries with exponential backoff on HTTP/connection errors
  - Never deletes local file until central API returns HTTP 200 confirmed

- [ ] **Step 1: Write failing tests for checksum calculation and upload retry backoff**

In `apps/agent/tests/test_uploader.py`:
```python
import hashlib
from pathlib import Path
from unittest.mock import MagicMock, patch
from apps.agent.src.uploader import UploadWorker, calculate_file_checksum
from apps.agent.src.queue import EventQueueManager, ClipJob

def test_calculate_file_checksum(tmp_path):
    sample = tmp_path / "test.mp4"
    sample.write_bytes(b"sample-video-content-bytes")
    expected = hashlib.sha256(b"sample-video-content-bytes").hexdigest()
    assert calculate_file_checksum(sample) == expected

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
        next_retry_at=0
    )
    queue_mgr.get_pending_clips.return_value = [job]

    worker = UploadWorker(
        queue_mgr=queue_mgr,
        central_api_url="https://api.test",
        device_token="token-123"
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest apps/agent/tests/test_uploader.py -v`
Expected: FAIL with ImportError: cannot import name 'UploadWorker'

- [ ] **Step 3: Implement `UploadWorker` in `apps/agent/src/uploader.py`**

Implement SHA-256 calculation, HTTP client with multipart / presigned upload protocol to central server, exponential backoff (e.g. 5s, 15s, 45s, max 300s), and retention acknowledgment logic.

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest apps/agent/tests/test_uploader.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/agent/src/uploader.py apps/agent/tests/test_uploader.py
git commit -m "feat(agent): implement resilient upload worker with sha256 and backoff"
```

---

### Task 6: Central Web/API - Prisma Schema & Database Models

**Files:**
- Create: `apps/web/prisma/schema.prisma`
- Create: `apps/web/src/lib/db.ts`
- Test: `apps/web/tests/db.test.ts`

**Interfaces:**
- Consumes: `apps/web/src/types/contracts.ts` from Task 1
- Produces: Prisma ORM models: `Field`, `Camera`, `CaptureProfile`, `ClipEvent`, `ClipFile`, `ShareToken`, `Device`
  - Relationship: `Field` 1:N `Camera`, `Field` 1:1 `CaptureProfile`, `Field` 1:N `ClipEvent`, `ClipEvent` 1:N `ClipFile`, `ClipEvent` 1:N `ShareToken`

- [ ] **Step 1: Write failing tests for database model relations and operations**

In `apps/web/tests/db.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../src/lib/db';

describe('Central Database Models', () => {
  it('creates field with camera, profile and creates clip event with files', async () => {
    const field = await prisma.field.create({
      data: {
        name: 'Campo Sintético 1',
        profile: {
          create: {
            secondsBefore: 15,
            secondsAfter: 10,
            retentionDays: 7,
          },
        },
        cameras: {
          create: [
            { name: 'Ângulo Gol Norte', rtspUrl: 'rtsp://cam1', displayOrder: 1 },
            { name: 'Ângulo Gol Sul', rtspUrl: 'rtsp://cam2', displayOrder: 2 },
          ],
        },
      },
      include: { cameras: true, profile: true },
    });

    expect(field.id).toBeDefined();
    expect(field.cameras.length).toBe(2);
    expect(field.profile?.secondsBefore).toBe(15);

    const event = await prisma.clipEvent.create({
      data: {
        fieldId: field.id,
        commandId: 'cmd-test-1',
        triggerSource: 'PHYSICAL_BUTTON',
        status: 'PROCESSING',
        files: {
          create: [
            {
              cameraId: field.cameras[0].id,
              storagePath: `clips/${field.id}/evt1_cam1.mp4`,
              duration: 25.0,
              sha256: 'abc123hash',
              uploadStatus: 'COMPLETED',
            },
          ],
        },
      },
      include: { files: true },
    });

    expect(event.files.length).toBe(1);
    expect(event.files[0].uploadStatus).toBe('COMPLETED');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/web/tests/db.test.ts`
Expected: FAIL with schema/prisma missing

- [ ] **Step 3: Implement `apps/web/prisma/schema.prisma` and `apps/web/src/lib/db.ts`**

Define PostgreSQL-compatible Prisma models matching Section 6 of the spec (`Field`, `Camera`, `CaptureProfile`, `ClipEvent`, `ClipFile`, `ShareToken`, `Device`), run `prisma generate`, and configure singleton client `apps/web/src/lib/db.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/web/tests/db.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/prisma apps/web/src/lib/db.ts apps/web/tests/db.test.ts
git commit -m "feat(web): configure prisma schema and relational database models"
```

---

### Task 7: Central Web/API - Agent Ingestion & S3 Storage Layer

**Files:**
- Create: `apps/web/src/lib/storage.ts`
- Create: `apps/web/src/app/api/v1/events/route.ts`
- Create: `apps/web/src/app/api/v1/clips/upload/route.ts`
- Create: `apps/web/src/app/api/v1/clips/confirm/route.ts`
- Test: `apps/web/tests/api-ingest.test.ts`

**Interfaces:**
- Consumes: `prisma` from Task 6
- Produces:
  - `StorageService`: uploads buffer/stream to S3, returns presigned GET/PUT URLs
  - `POST /api/v1/events`: creates ClipEvent from field agent
  - `POST /api/v1/clips/upload`: multipart/direct clip upload with checksum verification
  - `POST /api/v1/clips/confirm`: confirms successful upload and marks ClipFile as `READY`

- [ ] **Step 1: Write failing tests for device authentication and clip upload confirmation**

In `apps/web/tests/api-ingest.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { handleCreateEvent, handleUploadClip } from '../src/app/api/v1/events/handlers';
import crypto from 'crypto';

describe('Agent Ingest API', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await handleCreateEvent({ headers: {}, body: {} });
    expect(res.status).toBe(401);
  });

  it('validates checksum and stores clip file', async () => {
    const data = Buffer.from('fake-mp4-stream');
    const validChecksum = crypto.createHash('sha256').update(data).digest('hex');

    const res = await handleUploadClip({
      headers: { authorization: 'Bearer test-device-token' },
      body: {
        eventId: 'evt-1',
        cameraId: 'cam-1',
        fileBuffer: data,
        checksum: validChecksum,
      },
    });

    expect(res.status).toBe(200);
    expect(res.data.status).toBe('CONFIRMED');
  });

  it('rejects uploads with mismatched checksum', async () => {
    const data = Buffer.from('fake-mp4-stream');
    const res = await handleUploadClip({
      headers: { authorization: 'Bearer test-device-token' },
      body: {
        eventId: 'evt-1',
        cameraId: 'cam-1',
        fileBuffer: data,
        checksum: 'corrupted-sha256',
      },
    });

    expect(res.status).toBe(400);
    expect(res.data.error).toContain('Checksum mismatch');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/web/tests/api-ingest.test.ts`
Expected: FAIL with Cannot find module

- [ ] **Step 3: Implement S3 Storage Service and API Route Handlers**

Implement `apps/web/src/lib/storage.ts` using `@aws-sdk/client-s3`, device token verification middleware, event registration endpoint, and clip upload endpoint with SHA-256 validation and S3 putObject.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/web/tests/api-ingest.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/storage.ts apps/web/src/app/api/v1/events apps/web/src/app/api/v1/clips apps/web/tests/api-ingest.test.ts
git commit -m "feat(web): implement agent ingestion api and s3 storage service with checksum validation"
```

---

### Task 8: Central Web/API - Share Tokens & Responsive Clip Event Page

**Files:**
- Create: `apps/web/src/lib/tokens.ts`
- Create: `apps/web/src/app/api/v1/events/[id]/share/route.ts`
- Create: `apps/web/src/app/share/[token]/page.tsx`
- Test: `apps/web/tests/tokens.test.ts`
- Test: `apps/web/tests/share-page.test.tsx`

**Interfaces:**
- Consumes: `prisma` from Task 6, `StorageService` from Task 7
- Produces:
  - `generateShareToken(eventId: string, hoursValid: number) -> { rawToken: string, shareUrl: string }`
  - `resolveShareToken(rawToken: string) -> { event: ClipEvent, files: ClipFile[] } | null`
  - Public route `/share/[token]` rendering video players per angle, download links, and handling expired tokens.

- [ ] **Step 1: Write failing tests for token generation, expiration, and page resolution**

In `apps/web/tests/tokens.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { generateShareToken, resolveShareToken } from '../src/lib/tokens';
import { prisma } from '../src/lib/db';

describe('Share Tokens', () => {
  it('generates secure random token and resolves active event', async () => {
    const { rawToken, tokenRecord } = await generateShareToken('evt-valid', 24);
    expect(rawToken.length).toBeGreaterThanOrEqual(32);
    expect(tokenRecord.tokenHash).not.toBe(rawToken); // Stored as hash

    const resolved = await resolveShareToken(rawToken);
    expect(resolved).not.toBeNull();
    expect(resolved?.eventId).toBe('evt-valid');
  });

  it('test_expired_token_rejected', async () => {
    // Generates token that expired 1 hour ago
    const { rawToken } = await generateShareToken('evt-expired', -1);
    const resolved = await resolveShareToken(rawToken);
    expect(resolved).toBeNull();
  });
});
```

In `apps/web/tests/share-page.test.tsx`:
```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ShareEventView from '../src/app/share/[token]/ShareEventView';

describe('ShareEventView', () => {
  it('renders multiple camera angles and unavailable badge', () => {
    const props = {
      eventName: 'Lance 28/09 18:30 - Campo 1',
      angles: [
        { id: '1', cameraName: 'Gol Norte', status: 'READY', videoUrl: 'https://s3/c1.mp4' },
        { id: '2', cameraName: 'Lateral Direita', status: 'CAMERA_UNAVAILABLE', videoUrl: null },
      ],
    };
    render(<ShareEventView {...props} />);
    expect(screen.getByText('Gol Norte')).toBeDefined();
    expect(screen.getByText('Lateral Direita')).toBeDefined();
    expect(screen.getByText('Câmera Indisponível')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/web/tests/tokens.test.ts apps/web/tests/share-page.test.tsx`
Expected: FAIL with module not found

- [ ] **Step 3: Implement Token Service and Responsive Share Page**

Implement cryptographic token generation using `crypto.randomBytes(32)` and SHA-256 hash storage in `apps/web/src/lib/tokens.ts`, share token API endpoint, and mobile-first responsive event view in `apps/web/src/app/share/[token]/page.tsx` with WhatsApp share button and HTML5 `<video>` controls.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/web/tests/tokens.test.ts apps/web/tests/share-page.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/tokens.ts apps/web/src/app/api/v1/events apps/web/src/app/share apps/web/tests
git commit -m "feat(web): implement share tokens and responsive clip player page"
```

---

### Task 9: Central Web/API - Operational Dashboard & Contingency Trigger

**Files:**
- Create: `apps/web/src/app/admin/fields/page.tsx`
- Create: `apps/web/src/app/admin/events/[id]/page.tsx`
- Create: `apps/web/src/app/api/v1/trigger-contingency/route.ts`
- Test: `apps/web/tests/admin.test.ts`

**Interfaces:**
- Consumes: `prisma` from Task 6, `TriggerCommandPayload` from Task 1
- Produces:
  - Admin field view with camera statuses and agent heartbeat
  - Admin event view with upload progress per angle and retry actions
  - `POST /api/v1/trigger-contingency` sending trigger signal to field agent or creating central contingency event

- [ ] **Step 1: Write failing tests for contingency trigger and health metrics**

In `apps/web/tests/admin.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { handleContingencyTrigger } from '../src/app/api/v1/trigger-contingency/route';

describe('Admin Operational Endpoints', () => {
  it('dispatches contingency trigger to field agent', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ACCEPTED', event_id: 'evt-web-1' }),
    });
    global.fetch = mockFetch;

    const res = await handleContingencyTrigger({
      fieldId: 'field-1',
      triggerSource: 'WEB_INTERFACE',
    });

    expect(res.status).toBe(200);
    expect(res.data.status).toBe('ACCEPTED');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/web/tests/admin.test.ts`
Expected: FAIL with module not found

- [ ] **Step 3: Implement Admin Dashboard and Contingency Trigger API**

Implement field status listing, camera heartbeat indicators, queue lag warning, and contingency trigger endpoint communicating with agent's local IP or fallback event table.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/web/tests/admin.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/admin apps/web/src/app/api/v1/trigger-contingency apps/web/tests/admin.test.ts
git commit -m "feat(web): add operational dashboard and web contingency trigger"
```

---

### Task 10: End-to-End Verification & Orchestration Test

**Files:**
- Create: `scripts/test_e2e_flow.py`
- Create: `scripts/run_all_tests.sh`
- Test: `scripts/test_e2e_flow.py`

**Interfaces:**
- Consumes: All modules from Tasks 1-9
- Produces: Verification suite validating full lifecycle from physical trigger to WhatsApp share link

- [ ] **Step 1: Write failing integration test script simulating entire lifecycle**

In `scripts/test_e2e_flow.py`:
```python
"""
End-to-End Verification:
1. Starts mock central server and agent with 2 simulated cameras (1 active, 1 offline).
2. Simulates physical button trigger POST /api/v1/trigger.
3. Asserts duplicate trigger with same command_id is rejected idempotently.
4. Asserts extractor generates MP4 for active camera and flags offline camera as UNAVAILABLE.
5. Asserts upload worker sends clip with valid SHA256 checksum to central API.
6. Asserts share token is generated and public share URL returns valid response with 2 angles.
"""
import sys
# verification code here...
```

- [ ] **Step 2: Run test to verify it fails before wiring**

Run: `python3 scripts/test_e2e_flow.py`
Expected: FAIL

- [ ] **Step 3: Implement complete E2E verification test harness**

Complete `scripts/test_e2e_flow.py` and `scripts/run_all_tests.sh` (which runs agent pytest + web vitest + e2e integration).

- [ ] **Step 4: Run complete suite to verify everything passes**

Run: `bash scripts/run_all_tests.sh`
Expected: PASS (All unit, contract, and E2E tests passing)

- [ ] **Step 5: Commit**

```bash
git add scripts/test_e2e_flow.py scripts/run_all_tests.sh
git commit -m "test: add end-to-end integration test harness and verification script"
```
