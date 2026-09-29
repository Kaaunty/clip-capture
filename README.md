# Clip Capture

Multi-camera automated sports replay & instant clip capture system.

Clip Capture provides edge-buffered RTSP video recording, physical and remote event triggers, resilient SQLite-backed offline uploads, and a mobile-optimized public replay web application.

---

## Architecture Overview

```
+-----------------------------------------------------------+
|                        EDGE / LOCAL                       |
|                                                           |
|   [RTSP Cameras] ---> [Circular Buffer (Disk/RAM)]        |
|                              |                            |
|   [Physical Button / API] -> [Trigger API (FastAPI)]      |
|                              |                            |
|                       [Clip Extractor (FFmpeg)]           |
|                              |                            |
|                     [SQLite Queue (WAL)]                  |
|                              |                            |
|                     [Upload Worker (Daemon)]              |
+------------------------------|----------------------------+
                               | HTTPS + SHA-256 Checksum
+------------------------------v----------------------------+
|                       CENTRAL CLOUD                       |
|                                                           |
|             [Next.js 15 API & Ingestion Router]           |
|                              |                            |
|       +----------------------+----------------------+     |
|       |                                             |     |
|  [Prisma ORM (PostgreSQL/SQLite)]          [S3 Storage]   |
|       |                                             |     |
|  [Admin Operations Dashboard]              [Public Replay]|
+-----------------------------------------------------------+
```

### Key Principles & Fault Tolerance
- **Continuous Circular Buffer:** Edge nodes record low-latency RTSP camera streams into rotating segmented files (`.ts`/`.mp4`). Old segments are continuously pruned to maintain bounded disk usage.
- **Physical & Remote Triggers:** Physical button press or remote contingency triggers initiate extraction with configurable pre- and post-roll margins (e.g. 30s before, 10s after). Rapid double-presses are debounced within a 3-second window.
- **Offline Resilience:** If network connectivity drops, clips remain safely queued in edge SQLite storage with exponential backoff retry. Local clip files are **never deleted** prior to receiving central HTTP 200 upload confirmation.
- **Camera Fault Tolerance:** If a camera is offline during an event, other camera angles are extracted and uploaded normally without blocking processing.
- **Cryptographic Share Tokens:** 256-bit cryptographically secure tokens are generated per event with configurable expiration, suitable for sharing via WhatsApp or QR codes.
- **Admin Dashboard & Contingency:** Central web dashboard allows monitoring field health, re-triggering contingency recordings remotely, and viewing redacted RTSP camera configurations.

---

## Monorepo Layout

- `apps/agent`: Python edge service (FastAPI, SQLite WAL, FFmpeg subprocess, resilient upload daemon).
- `apps/web`: Next.js 15 App Router web application (Prisma ORM, S3 SigV4 storage, Tailwind CSS, Admin and Share views).
- `scripts/`: E2E verification test suite (`test_e2e_flow.py`) and test orchestrator (`run_all_tests.sh`).
- `docs/superpowers/specs/`: Architectural specifications and engineering design docs.

---

## Getting Started

### Prerequisites
- Python 3.11+
- Node.js 20+ and npm
- FFmpeg (for video extraction and segment stitching)

### 1. Local Agent (`apps/agent`)

```bash
cd apps/agent

# Install dependencies (or use a virtualenv)
pip install -r requirements.txt

# Run unit and integration tests
pytest -v
```

### 2. Central Web App (`apps/web`)

```bash
cd apps/web

# Install dependencies
npm install

# Generate Prisma Client and initialize database
npx prisma generate
npx prisma db push

# Run unit and integration tests
npm test

# Build production Next.js bundle
npm run build
```

### 3. Automated End-to-End Test Suite

Run the full end-to-end verification script which orchestrates a mock RTSP pipeline, edge agent, central server, clip generation, upload, and token verification:

```bash
# Run all tests (Agent pytest + Web vitest + Web build + Full E2E flow)
./scripts/run_all_tests.sh
```

---

## License

MIT License.
