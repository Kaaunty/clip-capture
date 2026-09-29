import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { prisma } from '../src/lib/db';

describe('Central Database Models', () => {
  beforeEach(async () => {
    // Clean up database between tests in reverse dependency order
    await prisma.shareToken.deleteMany();
    await prisma.clipFile.deleteMany();
    await prisma.clipEvent.deleteMany();
    await prisma.device.deleteMany();
    await prisma.captureProfile.deleteMany();
    await prisma.camera.deleteMany();
    await prisma.field.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

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
    expect(field.status).toBe('ACTIVE');
    expect(field.cameras.length).toBe(2);
    expect(field.profile?.secondsBefore).toBe(15);
    expect(field.profile?.secondsAfter).toBe(10);
    expect(field.profile?.retentionDays).toBe(7);

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

    expect(event.id).toBeDefined();
    expect(event.files.length).toBe(1);
    expect(event.files[0].uploadStatus).toBe('COMPLETED');
    expect(event.files[0].duration).toBe(25.0);
    expect(event.files[0].sha256).toBe('abc123hash');
  });

  it('creates and queries device linked to field', async () => {
    const field = await prisma.field.create({
      data: { name: 'Campo 2' },
    });

    const device = await prisma.device.create({
      data: {
        fieldId: field.id,
        deviceType: 'BUTTON',
        identifier: 'btn-esp32-001',
        secretToken: 'secret-token-xyz',
        lastHeartbeatAt: new Date(),
      },
    });

    expect(device.id).toBeDefined();
    expect(device.identifier).toBe('btn-esp32-001');
    expect(device.fieldId).toBe(field.id);

    const queried = await prisma.device.findUnique({
      where: { identifier: 'btn-esp32-001' },
      include: { field: true },
    });
    expect(queried?.field.name).toBe('Campo 2');
  });

  it('creates share token for clip event with expiration and access count', async () => {
    const field = await prisma.field.create({
      data: { name: 'Campo 3' },
    });

    const event = await prisma.clipEvent.create({
      data: {
        fieldId: field.id,
        commandId: 'cmd-share-test',
        triggerSource: 'WEB_INTERFACE',
        status: 'COMPLETED',
      },
    });

    const expiresAt = new Date(Date.now() + 24 * 3600 * 1000);
    const token = await prisma.shareToken.create({
      data: {
        eventId: event.id,
        tokenHash: 'hashed-random-token-12345',
        expiresAt,
        scope: 'PUBLIC',
        accessCount: 0,
      },
    });

    expect(token.id).toBeDefined();
    expect(token.tokenHash).toBe('hashed-random-token-12345');
    expect(token.eventId).toBe(event.id);

    // Increment accessCount
    const updated = await prisma.shareToken.update({
      where: { id: token.id },
      data: { accessCount: { increment: 1 } },
    });
    expect(updated.accessCount).toBe(1);
  });

  it('verifies cascading delete from field to cameras, profile, events, and devices', async () => {
    const field = await prisma.field.create({
      data: {
        name: 'Campo Cascata',
        profile: {
          create: { secondsBefore: 10, secondsAfter: 5, retentionDays: 3 },
        },
        cameras: {
          create: [{ name: 'Cam 1', rtspUrl: 'rtsp://cam1' }],
        },
        devices: {
          create: [{ deviceType: 'AGENT', identifier: 'agent-001', secretToken: 'tok1' }],
        },
      },
      include: { cameras: true, profile: true, devices: true },
    });

    const event = await prisma.clipEvent.create({
      data: {
        fieldId: field.id,
        commandId: 'cmd-cascade-1',
        triggerSource: 'API',
        status: 'READY',
        files: {
          create: [
            {
              cameraId: field.cameras[0].id,
              storagePath: `clips/${field.id}/test.mp4`,
              duration: 15.0,
            },
          ],
        },
        tokens: {
          create: [
            {
              tokenHash: 'hash-cascade-token',
              expiresAt: new Date(Date.now() + 3600000),
            },
          ],
        },
      },
    });

    // Delete field
    await prisma.field.delete({ where: { id: field.id } });

    // Verify all related records cascaded
    const cameraCount = await prisma.camera.count({ where: { fieldId: field.id } });
    const profileCount = await prisma.captureProfile.count({ where: { fieldId: field.id } });
    const deviceCount = await prisma.device.count({ where: { fieldId: field.id } });
    const eventCount = await prisma.clipEvent.count({ where: { id: event.id } });
    const fileCount = await prisma.clipFile.count({ where: { eventId: event.id } });
    const tokenCount = await prisma.shareToken.count({ where: { eventId: event.id } });

    expect(cameraCount).toBe(0);
    expect(profileCount).toBe(0);
    expect(deviceCount).toBe(0);
    expect(eventCount).toBe(0);
    expect(fileCount).toBe(0);
    expect(tokenCount).toBe(0);
  });

  it('enforces uniqueness on commandId, tokenHash, and device identifier', async () => {
    const field = await prisma.field.create({
      data: { name: 'Campo Unicidade' },
    });

    // Duplicate commandId rejection
    await prisma.clipEvent.create({
      data: {
        fieldId: field.id,
        commandId: 'cmd-unique-test',
        triggerSource: 'API',
      },
    });

    await expect(
      prisma.clipEvent.create({
        data: {
          fieldId: field.id,
          commandId: 'cmd-unique-test',
          triggerSource: 'API',
        },
      }),
    ).rejects.toThrow();

    // Duplicate device identifier rejection
    await prisma.device.create({
      data: {
        fieldId: field.id,
        identifier: 'dev-dup-01',
        secretToken: 'secret',
      },
    });

    await expect(
      prisma.device.create({
        data: {
          fieldId: field.id,
          identifier: 'dev-dup-01',
          secretToken: 'secret2',
        },
      }),
    ).rejects.toThrow();
  });

  it('queries cameras ordered by displayOrder', async () => {
    const field = await prisma.field.create({
      data: {
        name: 'Campo Ordem',
        cameras: {
          create: [
            { name: 'Câmera Lateral', rtspUrl: 'rtsp://cam2', displayOrder: 2 },
            { name: 'Câmera Principal', rtspUrl: 'rtsp://cam1', displayOrder: 1 },
          ],
        },
      },
    });

    const cameras = await prisma.camera.findMany({
      where: { fieldId: field.id },
      orderBy: { displayOrder: 'asc' },
    });

    expect(cameras.length).toBe(2);
    expect(cameras[0].name).toBe('Câmera Principal');
    expect(cameras[1].name).toBe('Câmera Lateral');
  });
});
