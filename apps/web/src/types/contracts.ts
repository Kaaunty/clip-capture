/**
 * Clip Capture MVP — Shared Data Contracts & Schemas
 */

export type TriggerSource = 'PHYSICAL_BUTTON' | 'WEB_INTERFACE' | 'API';

export type EventStatus = 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export type UploadStatus =
  | 'PENDING'
  | 'UPLOADING'
  | 'COMPLETED'
  | 'READY'
  | 'FAILED'
  | 'CAMERA_UNAVAILABLE';

export interface CameraContract {
  id: string;
  fieldId?: string;
  name: string;
  rtspUrl: string;
  displayOrder: number;
  isActive?: boolean;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

export interface CaptureProfileContract {
  id?: string;
  fieldId?: string;
  secondsBefore: number;
  secondsAfter: number;
  retentionDays: number;
  format?: string;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

export interface FieldContract {
  id: string;
  name: string;
  createdAt?: string | Date;
  updatedAt?: string | Date;
  cameras?: CameraContract[];
  profile?: CaptureProfileContract;
}

export interface ClipFileContract {
  id?: string;
  eventId: string;
  cameraId: string;
  storagePath: string;
  duration: number;
  sha256?: string;
  uploadStatus: UploadStatus;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

export interface ShareTokenContract {
  id?: string;
  eventId: string;
  tokenHash: string;
  expiresAt: string | Date;
  createdAt?: string | Date;
  scope?: string;
  accessCount?: number;
}

export interface DeviceContract {
  id: string;
  fieldId: string;
  deviceType: 'BUTTON' | 'AGENT' | 'OTHER';
  identifier: string;
  secretToken?: string;
  credentialHash?: string;
  lastSeenAt?: string | Date;
  lastHeartbeatAt?: string | Date;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

export interface ClipEventContract {
  id?: string;
  fieldId: string;
  commandId: string;
  triggerSource: TriggerSource;
  triggeredAt: string | Date;
  status?: EventStatus;
  createdAt?: string | Date;
  updatedAt?: string | Date;
  files?: ClipFileContract[];
}

export interface ClipEventPayload {
  fieldId: string;
  triggeredAt: string | Date;
  commandId: string;
  triggerSource: TriggerSource;
}

/**
 * Validates whether an unknown input conforms to ClipEventPayload.
 */
export function validateClipEventPayload(payload: unknown): payload is ClipEventPayload {
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  const p = payload as Record<string, unknown>;

  if (typeof p.fieldId !== 'string' || p.fieldId.trim() === '') {
    return false;
  }

  if (typeof p.commandId !== 'string' || p.commandId.trim() === '') {
    return false;
  }

  const validSources: string[] = ['PHYSICAL_BUTTON', 'WEB_INTERFACE', 'API'];
  if (typeof p.triggerSource !== 'string' || !validSources.includes(p.triggerSource)) {
    return false;
  }

  if (typeof p.triggeredAt !== 'string' && !(p.triggeredAt instanceof Date)) {
    return false;
  }

  if (typeof p.triggeredAt === 'string') {
    const d = new Date(p.triggeredAt);
    if (isNaN(d.getTime())) {
      return false;
    }
  }

  if (p.triggeredAt instanceof Date && isNaN(p.triggeredAt.getTime())) {
    return false;
  }

  return true;
}
