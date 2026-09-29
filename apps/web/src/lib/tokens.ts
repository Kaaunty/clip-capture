import crypto from 'crypto';
import { prisma } from './db';

export interface GenerateShareTokenResult {
  rawToken: string;
  tokenRecord: any;
  shareUrl: string;
}

/**
 * Generates a secure random share token, stores its SHA-256 hash in the database,
 * and returns the raw unhashed token along with the share URL.
 */
export async function generateShareToken(
  eventId: string,
  hoursValid: number = 24,
): Promise<GenerateShareTokenResult> {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + hoursValid * 3600 * 1000);

  const tokenRecord = await prisma.shareToken.create({
    data: {
      eventId,
      tokenHash,
      expiresAt,
      scope: 'PUBLIC',
    },
  });

  const baseUrl =
    process.env.APP_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    'http://localhost:3000';
  const shareUrl = `${baseUrl.replace(/\/$/, '')}/share/${rawToken}`;

  return {
    rawToken,
    tokenRecord,
    shareUrl,
  };
}

/**
 * Resolves a raw share token by SHA-256 hash lookup, enforcing expiration,
 * incrementing access count, and returning the associated event, field, cameras, and files.
 * Returns null if the token is invalid or expired.
 */
export async function resolveShareToken(rawToken: string): Promise<any | null> {
  if (!rawToken || typeof rawToken !== 'string') {
    return null;
  }

  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  const tokenRecord = await prisma.shareToken.findUnique({
    where: { tokenHash },
    include: {
      event: {
        include: {
          field: {
            include: {
              cameras: {
                orderBy: { displayOrder: 'asc' },
              },
            },
          },
          files: {
            include: {
              camera: true,
            },
          },
        },
      },
    },
  });

  if (!tokenRecord) {
    return null;
  }

  if (new Date() > tokenRecord.expiresAt) {
    return null;
  }

  // Increment access count
  try {
    await prisma.shareToken.update({
      where: { id: tokenRecord.id },
      data: { accessCount: { increment: 1 } },
    });
  } catch {
    // Non-fatal if accessCount increment fails
  }

  const event = tokenRecord.event;
  return {
    id: event ? event.id : tokenRecord.id,
    eventId: tokenRecord.eventId,
    tokenRecord,
    event: event ?? null,
    files: event?.files ?? [],
    field: event?.field ?? null,
    ...(event ?? {}),
  };
}
