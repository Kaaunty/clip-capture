import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import crypto from 'crypto';
import { prisma } from '../src/lib/db';
import { StorageService, storageService } from '../src/lib/storage';
import {
  handleCreateEvent,
  handleUploadClip,
  handleConfirmClip,
} from '../src/app/api/v1/events/handlers';
import { POST as postEvent } from '../src/app/api/v1/events/route';
import { POST as postUpload } from '../src/app/api/v1/clips/upload/route';
import { POST as postConfirm } from '../src/app/api/v1/clips/confirm/route';

describe('Agent Ingest API', () => {
  beforeEach(async () => {
    storageService.resetMock();

    // Clean up database in reverse dependency order
    await prisma.shareToken.deleteMany();
    await prisma.clipFile.deleteMany();
    await prisma.clipEvent.deleteMany();
    await prisma.device.deleteMany();
    await prisma.captureProfile.deleteMany();
    await prisma.camera.deleteMany();
    await prisma.field.deleteMany();

    // Seed test field, camera, event, and device
    const field = await prisma.field.create({
      data: {
        id: 'field-1',
        name: 'Campo Sintético Alpha',
        cameras: {
          create: [
            { id: 'cam-1', name: 'Câmera Principal', rtspUrl: 'rtsp://cam1', displayOrder: 1 },
          ],
        },
        devices: {
          create: [
            {
              identifier: 'agent-dev-1',
              secretToken: 'test-device-token',
              deviceType: 'AGENT',
            },
          ],
        },
      },
    });

    await prisma.clipEvent.create({
      data: {
        id: 'evt-1',
        fieldId: field.id,
        commandId: 'cmd-test-1',
        triggerSource: 'PHYSICAL_BUTTON',
        status: 'PROCESSING',
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('rejects unauthenticated requests', async () => {
    const res = await handleCreateEvent({ headers: {}, body: {} });
    expect(res.status).toBe(401);
  });

  it('validates checksum and stores clip file as READY', async () => {
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

    // Verify clip file in database has uploadStatus READY
    const clip = await prisma.clipFile.findFirst({
      where: { eventId: 'evt-1', cameraId: 'cam-1' },
    });
    expect(clip).toBeDefined();
    expect(clip?.uploadStatus).toBe('READY');
    expect(clip?.sha256).toBe(validChecksum);
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

  it('creates clip event with authenticated device and status PROCESSING', async () => {
    const res = await handleCreateEvent({
      headers: { authorization: 'Bearer test-device-token' },
      body: {
        commandId: 'cmd-new-trigger',
        triggerSource: 'PHYSICAL_BUTTON',
      },
    });

    expect(res.status).toBe(200);
    expect(res.data.event).toBeDefined();
    expect(res.data.event.commandId).toBe('cmd-new-trigger');
    expect(res.data.event.status).toBe('PROCESSING');
  });

  it('rejects cross-tenant event creation when fieldId does not match device', async () => {
    const res = await handleCreateEvent({
      headers: { authorization: 'Bearer test-device-token' },
      body: {
        fieldId: 'foreign-field-id',
        commandId: 'cmd-cross-tenant',
      },
    });

    expect(res.status).toBe(403);
    expect(res.data.error).toContain('Forbidden');
  });

  it('confirms clip upload with valid token and marks ClipFile as READY', async () => {
    // Upload object to storage first to simulate client presigned PUT
    await storageService.uploadObject('clips/evt-1/cam-1_clip-1.mp4', Buffer.from('presigned-clip-bytes'));

    const res = await handleConfirmClip({
      headers: { authorization: 'Bearer test-device-token' },
      body: {
        eventId: 'evt-1',
        cameraId: 'cam-1',
        clipId: 'clip-1',
        checksum: 'hash-presigned-123',
      },
    });

    expect(res.status).toBe(200);
    expect(res.data.status).toBe('CONFIRMED');

    const clip = await prisma.clipFile.findFirst({
      where: { eventId: 'evt-1', cameraId: 'cam-1' },
    });
    expect(clip).toBeDefined();
    expect(clip?.uploadStatus).toBe('READY');
    expect(clip?.sha256).toBe('hash-presigned-123');
  });

  it('rejects confirmation if file does not exist in storage', async () => {
    const res = await handleConfirmClip({
      headers: { authorization: 'Bearer test-device-token' },
      body: {
        eventId: 'evt-1',
        cameraId: 'cam-1',
        clipId: 'missing-clip',
        checksum: 'hash-missing',
      },
    });

    expect(res.status).toBe(404);
    expect(res.data.error).toContain('not found in storage');
  });

  it('rejects cross-tenant clip confirmation for foreign event', async () => {
    // Create foreign field and event
    const otherField = await prisma.field.create({
      data: { name: 'Foreign Field' },
    });
    const otherEvent = await prisma.clipEvent.create({
      data: {
        id: 'foreign-evt',
        fieldId: otherField.id,
        commandId: 'cmd-foreign',
      },
    });

    const res = await handleConfirmClip({
      headers: { authorization: 'Bearer test-device-token' },
      body: {
        eventId: otherEvent.id,
        cameraId: 'cam-1',
        checksum: 'hash',
      },
    });

    expect(res.status).toBe(403);
  });
});

describe('HTTP Route Handlers', () => {
  it('handles multipart/form-data upload via POST /api/v1/clips/upload', async () => {
    const fileBytes = Buffer.from('video-payload-content');
    const validChecksum = crypto.createHash('sha256').update(fileBytes).digest('hex');

    const formData = new FormData();
    formData.append('file', new Blob([fileBytes], { type: 'video/mp4' }), 'angle1.mp4');
    formData.append('eventId', 'evt-1');
    formData.append('cameraId', 'cam-1');
    formData.append('checksum', validChecksum);
    formData.append('duration', '20.5');

    const req = new Request('http://localhost:3000/api/v1/clips/upload', {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-device-token',
      },
      body: formData,
    });

    const res = await postUpload(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('CONFIRMED');
  });

  it('handles JSON event registration via POST /api/v1/events', async () => {
    const req = new Request('http://localhost:3000/api/v1/events', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer test-device-token',
      },
      body: JSON.stringify({
        commandId: 'cmd-http-test',
        triggerSource: 'WEB_INTERFACE',
      }),
    });

    const res = await postEvent(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('CONFIRMED');
    expect(body.event.commandId).toBe('cmd-http-test');
  });

  it('handles JSON confirmation via POST /api/v1/clips/confirm', async () => {
    await storageService.uploadObject('clips/evt-1/cam-1_clip.mp4', Buffer.from('confirmed-bytes'));

    const req = new Request('http://localhost:3000/api/v1/clips/confirm', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer test-device-token',
      },
      body: JSON.stringify({
        eventId: 'evt-1',
        cameraId: 'cam-1',
        checksum: 'confirmed-hash',
      }),
    });

    const res = await postConfirm(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('CONFIRMED');
  });
});

describe('StorageService', () => {
  it('provides uploadObject, getPresignedPutUrl, and getPresignedGetUrl in mock and client mode', async () => {
    const service = new StorageService({ mock: true });
    const buffer = Buffer.from('test-video-bytes');
    const uploadResult = await service.uploadObject('test/path.mp4', buffer, 'video/mp4');

    expect(uploadResult.key).toBe('test/path.mp4');
    expect(uploadResult.url).toBeDefined();

    const putUrl = await service.getPresignedPutUrl('test/path2.mp4', 3600);
    expect(putUrl).toContain('test/path2.mp4');

    const getUrl = await service.getPresignedGetUrl('test/path.mp4', 3600);
    expect(getUrl).toContain('test/path.mp4');
  });

  it('correctly formats presigned URL path for custom endpoint (path-style MinIO)', async () => {
    const service = new StorageService({
      mock: false,
      bucket: 'custom-bucket',
      endpoint: 'http://minio:9000',
      region: 'us-east-1',
      accessKeyId: 'MINIO_KEY',
      secretAccessKey: 'MINIO_SECRET',
    });

    const putUrl = await service.getPresignedPutUrl('clips/test.mp4', 3600);
    expect(putUrl).toContain('http://minio:9000/custom-bucket/clips/test.mp4');
    expect(putUrl).toContain('X-Amz-Signature');
  });
});
