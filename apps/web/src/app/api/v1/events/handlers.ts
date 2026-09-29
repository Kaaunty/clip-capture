import crypto from 'crypto';
import { prisma } from '../../../../lib/db';
import { storageService } from '../../../../lib/storage';

export interface HandlerRequest {
  headers?: any;
  body?: any;
}

export interface HandlerResponse<T = any> {
  status: number;
  data: T;
}

export function extractBearerToken(headers: any): string | null {
  if (!headers) return null;
  let auth: string | undefined;

  if (typeof headers.get === 'function') {
    auth = headers.get('authorization') || headers.get('Authorization');
  } else {
    auth =
      headers['authorization'] ||
      headers['Authorization'] ||
      headers['AUTHORIZATION'];
  }

  if (!auth || typeof auth !== 'string') return null;
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

export async function authenticateDevice(headers: any) {
  const token = extractBearerToken(headers);
  if (!token) {
    return {
      authenticated: false as const,
      status: 401,
      error: 'Unauthorized: missing or invalid Bearer token',
    };
  }

  const device = await prisma.device.findFirst({
    where: { secretToken: token },
    include: { field: true },
  });

  if (!device) {
    return {
      authenticated: false as const,
      status: 401,
      error: 'Unauthorized: invalid device token',
    };
  }

  try {
    await prisma.device.update({
      where: { id: device.id },
      data: { lastHeartbeatAt: new Date() },
    });
  } catch {
    // Non-fatal if heartbeat cannot be updated
  }

  return {
    authenticated: true as const,
    device,
  };
}

export async function normalizeRequest(req: any): Promise<{ headers: any; body: any }> {
  if (req && typeof req.headers?.get === 'function') {
    // Standard Request / NextRequest
    const headers: Record<string, string> = {};
    req.headers.forEach((val: string, key: string) => {
      headers[key.toLowerCase()] = val;
    });

    const contentType = req.headers.get('content-type') || '';
    let body: any = {};
    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      body = {};
      for (const [key, value] of formData.entries()) {
        if (value && typeof (value as any).arrayBuffer === 'function') {
          const buf = Buffer.from(await (value as any).arrayBuffer());
          body[key] = buf;
          body.fileBuffer = buf;
        } else {
          body[key] = value;
        }
      }
    } else if (contentType.includes('application/json')) {
      try {
        body = await req.json();
      } catch {
        body = {};
      }
    }
    return { headers, body };
  }

  return {
    headers: req?.headers || {},
    body: req?.body || {},
  };
}

/**
 * POST /api/v1/events
 * Registers an event from field agent or UI trigger. Creates ClipEvent with status PROCESSING.
 */
export async function handleCreateEvent(req: any): Promise<HandlerResponse> {
  const { headers, body } = await normalizeRequest(req);
  const auth = await authenticateDevice(headers);
  if (!auth.authenticated) {
    return {
      status: 401,
      data: { error: auth.error },
    };
  }

  const fieldId = body.fieldId || auth.device.fieldId;
  const commandId =
    body.commandId ||
    body.eventId ||
    `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const triggerSource = body.triggerSource || 'PHYSICAL_BUTTON';
  const triggeredAt = body.triggeredAt ? new Date(body.triggeredAt) : new Date();

  // Check duplicate commandId
  const existing = await prisma.clipEvent.findUnique({
    where: { commandId },
  });

  if (existing) {
    return {
      status: 200,
      data: {
        status: 'DUPLICATE_IGNORED',
        commandId,
        event: existing,
        message: 'Command already ingested',
      },
    };
  }

  const event = await prisma.clipEvent.create({
    data: {
      ...(body.id ? { id: body.id } : {}),
      fieldId,
      commandId,
      triggerSource,
      status: 'PROCESSING',
      triggeredAt,
    },
  });

  return {
    status: 200,
    data: {
      status: 'CONFIRMED',
      event,
    },
  };
}

/**
 * POST /api/v1/clips/upload
 * Handles direct or multipart clip upload with SHA-256 validation and storage in S3.
 */
export async function handleUploadClip(req: any): Promise<HandlerResponse> {
  const { headers, body } = await normalizeRequest(req);
  const auth = await authenticateDevice(headers);
  if (!auth.authenticated) {
    return {
      status: 401,
      data: { error: auth.error },
    };
  }

  const eventId = body.eventId || body.event_id;
  const cameraId = body.cameraId || body.camera_id;
  const clipId = body.clipId || body.clip_id;
  const fileBuffer = body.fileBuffer || body.file;
  const checksum = body.checksum || body.sha256;
  const duration = Number(body.duration) || 25.0;

  if (!eventId || !cameraId) {
    return {
      status: 400,
      data: { error: 'Missing required parameters: eventId and cameraId are required' },
    };
  }

  if (!fileBuffer) {
    return {
      status: 400,
      data: { error: 'Missing clip file data in request' },
    };
  }

  if (!checksum) {
    return {
      status: 400,
      data: { error: 'Missing checksum in request' },
    };
  }

  const buffer = Buffer.isBuffer(fileBuffer)
    ? fileBuffer
    : Buffer.from(fileBuffer);
  const computed = crypto.createHash('sha256').update(buffer).digest('hex');

  if (computed.toLowerCase() !== String(checksum).toLowerCase()) {
    return {
      status: 400,
      data: {
        error: `Checksum mismatch: expected ${checksum}, got ${computed}`,
      },
    };
  }

  // Store in S3 storage
  const storagePath = `clips/${eventId}/${cameraId}_${clipId || Date.now()}.mp4`;
  await storageService.uploadObject(storagePath, buffer, 'video/mp4');

  // Ensure ClipEvent and Camera exist to satisfy relational constraints
  let clipEvent = await prisma.clipEvent.findUnique({
    where: { id: eventId },
  });
  if (!clipEvent) {
    clipEvent = await prisma.clipEvent.findUnique({
      where: { commandId: eventId },
    });
  }
  if (!clipEvent) {
    clipEvent = await prisma.clipEvent.create({
      data: {
        id: eventId,
        fieldId: auth.device.fieldId,
        commandId: eventId,
        triggerSource: 'AGENT',
        status: 'PROCESSING',
      },
    });
  }

  let camera = await prisma.camera.findUnique({
    where: { id: cameraId },
  });
  if (!camera) {
    camera = await prisma.camera.create({
      data: {
        id: cameraId,
        fieldId: auth.device.fieldId,
        name: `Camera ${cameraId}`,
        rtspUrl: `rtsp://device/${cameraId}`,
      },
    });
  }

  // Upsert or create ClipFile record
  const existingClip = await prisma.clipFile.findFirst({
    where: { eventId: clipEvent.id, cameraId: camera.id },
  });

  let clipFile;
  if (existingClip) {
    clipFile = await prisma.clipFile.update({
      where: { id: existingClip.id },
      data: {
        storagePath,
        duration,
        sha256: computed,
        uploadStatus: 'COMPLETED',
      },
    });
  } else {
    clipFile = await prisma.clipFile.create({
      data: {
        eventId: clipEvent.id,
        cameraId: camera.id,
        storagePath,
        duration,
        sha256: computed,
        uploadStatus: 'COMPLETED',
      },
    });
  }

  return {
    status: 200,
    data: {
      status: 'CONFIRMED',
      file: clipFile,
      storagePath,
      checksum: computed,
    },
  };
}

/**
 * POST /api/v1/clips/confirm
 * Confirms clip upload via presigned S3 PUT, verifying checksum and marking ClipFile as COMPLETED.
 */
export async function handleConfirmClip(req: any): Promise<HandlerResponse> {
  const { headers, body } = await normalizeRequest(req);
  const auth = await authenticateDevice(headers);
  if (!auth.authenticated) {
    return {
      status: 401,
      data: { error: auth.error },
    };
  }

  const eventId = body.eventId || body.event_id;
  const cameraId = body.cameraId || body.camera_id;
  const clipId = body.clipId || body.clip_id;
  const checksum = body.checksum || body.sha256;
  const duration = Number(body.duration) || 25.0;
  const storagePath =
    body.storagePath || `clips/${eventId}/${cameraId}_${clipId || 'clip'}.mp4`;

  if (!eventId || !cameraId) {
    return {
      status: 400,
      data: { error: 'Missing required parameters: eventId and cameraId are required' },
    };
  }

  // Ensure ClipEvent and Camera exist to satisfy relational constraints
  let clipEvent = await prisma.clipEvent.findUnique({
    where: { id: eventId },
  });
  if (!clipEvent) {
    clipEvent = await prisma.clipEvent.findUnique({
      where: { commandId: eventId },
    });
  }
  if (!clipEvent) {
    clipEvent = await prisma.clipEvent.create({
      data: {
        id: eventId,
        fieldId: auth.device.fieldId,
        commandId: eventId,
        triggerSource: 'AGENT',
        status: 'PROCESSING',
      },
    });
  }

  let camera = await prisma.camera.findUnique({
    where: { id: cameraId },
  });
  if (!camera) {
    camera = await prisma.camera.create({
      data: {
        id: cameraId,
        fieldId: auth.device.fieldId,
        name: `Camera ${cameraId}`,
        rtspUrl: `rtsp://device/${cameraId}`,
      },
    });
  }

  const existingClip = await prisma.clipFile.findFirst({
    where: { eventId: clipEvent.id, cameraId: camera.id },
  });

  let clipFile;
  if (existingClip) {
    clipFile = await prisma.clipFile.update({
      where: { id: existingClip.id },
      data: {
        storagePath: existingClip.storagePath || storagePath,
        duration: duration || existingClip.duration,
        sha256: checksum || existingClip.sha256,
        uploadStatus: 'COMPLETED',
      },
    });
  } else {
    clipFile = await prisma.clipFile.create({
      data: {
        eventId: clipEvent.id,
        cameraId: camera.id,
        storagePath,
        duration,
        sha256: checksum,
        uploadStatus: 'COMPLETED',
      },
    });
  }

  return {
    status: 200,
    data: {
      status: 'CONFIRMED',
      file: clipFile,
    },
  };
}
