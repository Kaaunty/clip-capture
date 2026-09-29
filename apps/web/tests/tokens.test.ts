import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { generateShareToken, resolveShareToken } from '../src/lib/tokens';
import { prisma } from '../src/lib/db';
import { POST as postShare } from '../src/app/api/v1/events/[id]/share/route';

describe('Share Tokens', () => {
  beforeEach(async () => {
    // Clear tokens, files, events, cameras, fields
    await prisma.shareToken.deleteMany();
    await prisma.clipFile.deleteMany();
    await prisma.clipEvent.deleteMany();
    await prisma.device.deleteMany();
    await prisma.captureProfile.deleteMany();
    await prisma.camera.deleteMany();
    await prisma.field.deleteMany();

    const field = await prisma.field.create({
      data: {
        id: 'field-token-test',
        name: 'Campo 1 - Arena Central',
        cameras: {
          create: [
            { id: 'cam-gn', name: 'Gol Norte', rtspUrl: 'rtsp://cam-gn', displayOrder: 1 },
            { id: 'cam-ld', name: 'Lateral Direita', rtspUrl: 'rtsp://cam-ld', displayOrder: 2 },
          ],
        },
      },
    });

    await prisma.clipEvent.create({
      data: {
        id: 'evt-valid',
        fieldId: field.id,
        commandId: 'cmd-valid-token-1',
        triggerSource: 'PHYSICAL_BUTTON',
        status: 'COMPLETED',
        files: {
          create: [
            {
              id: 'file-1',
              cameraId: 'cam-gn',
              storagePath: 'clips/evt-valid/cam-gn.mp4',
              duration: 15.0,
              uploadStatus: 'READY',
            },
            {
              id: 'file-2',
              cameraId: 'cam-ld',
              storagePath: 'clips/evt-valid/cam-ld.mp4',
              duration: 15.0,
              uploadStatus: 'CAMERA_UNAVAILABLE',
            },
          ],
        },
      },
    });

    await prisma.clipEvent.create({
      data: {
        id: 'evt-expired',
        fieldId: field.id,
        commandId: 'cmd-expired-token-1',
        triggerSource: 'PHYSICAL_BUTTON',
        status: 'COMPLETED',
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

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

  it('rejects invalid or non-existent token', async () => {
    const resolved = await resolveShareToken('completely-invalid-nonexistent-token');
    expect(resolved).toBeNull();
  });

  it('increments accessCount on each resolution', async () => {
    const { rawToken, tokenRecord } = await generateShareToken('evt-valid', 24);
    expect(tokenRecord.accessCount).toBe(0);

    const first = await resolveShareToken(rawToken);
    expect(first).not.toBeNull();

    const second = await resolveShareToken(rawToken);
    expect(second).not.toBeNull();

    const updated = await prisma.shareToken.findUnique({
      where: { id: tokenRecord.id },
    });
    expect(updated?.accessCount).toBe(2);
  });

  it('loads associated field, camera, and clip file records', async () => {
    const { rawToken } = await generateShareToken('evt-valid', 24);
    const resolved = await resolveShareToken(rawToken);

    expect(resolved).not.toBeNull();
    expect(resolved?.files).toHaveLength(2);
    const camNames = resolved?.files.map((f: any) => f.camera?.name).sort();
    expect(camNames).toEqual(['Gol Norte', 'Lateral Direita']);
  });

  describe('POST /api/v1/events/[id]/share', () => {
    it('creates share token via HTTP route for existing event', async () => {
      const req = new Request('http://localhost:3000/api/v1/events/evt-valid/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hoursValid: 48 }),
      });

      const res = await postShare(req, { params: Promise.resolve({ id: 'evt-valid' }) });
      expect(res.status).toBe(201);

      const json = await res.json();
      expect(json.shareUrl).toBeDefined();
      expect(json.rawToken).toBeDefined();
      expect(json.tokenRecord).toBeDefined();
      expect(json.expiresAt).toBeDefined();

      const resolved = await resolveShareToken(json.rawToken);
      expect(resolved).not.toBeNull();
      expect(resolved?.eventId).toBe('evt-valid');
    });

    it('returns 404 if event does not exist', async () => {
      const req = new Request('http://localhost:3000/api/v1/events/non-existent/share', {
        method: 'POST',
      });

      const res = await postShare(req, { params: Promise.resolve({ id: 'non-existent' }) });
      expect(res.status).toBe(404);

      const json = await res.json();
      expect(json.error).toBe('Event not found');
    });
  });
});
