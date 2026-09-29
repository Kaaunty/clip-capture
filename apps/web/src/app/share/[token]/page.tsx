import React from 'react';
import { resolveShareToken } from '../../../lib/tokens';
import { storageService } from '../../../lib/storage';
import ShareEventView, { AngleViewItem } from './ShareEventView';

interface PageProps {
  params: Promise<{ token: string }> | { token: string };
}

export default async function SharePage({ params }: PageProps) {
  const resolvedParams = await params;
  const token = resolvedParams.token;

  const resolved = await resolveShareToken(token);

  if (!resolved || !resolved.event) {
    return (
      <ShareEventView
        error="Link expirado ou inválido"
        eventName=""
        angles={[]}
      />
    );
  }

  const event = resolved.event;
  const field = resolved.field || event.field;
  const files: any[] = resolved.files || event.files || [];

  const eventDate = new Date(event.triggeredAt || event.createdAt);
  const formattedDate = !isNaN(eventDate.getTime())
    ? eventDate.toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

  const fieldName = field?.name || 'Campo';
  const eventName = `Lance ${formattedDate} - ${fieldName}`;

  const baseUrl =
    process.env.APP_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    'http://localhost:3000';
  const shareUrl = `${baseUrl.replace(/\/$/, '')}/share/${token}`;

  // Build angles list
  const angles: AngleViewItem[] = [];
  const fieldCameras = field?.cameras || [];

  if (fieldCameras.length > 0) {
    for (const camera of fieldCameras) {
      const file = files.find((f: any) => f.cameraId === camera.id);
      let status = file?.uploadStatus || 'CAMERA_UNAVAILABLE';
      let videoUrl: string | null = null;

      if (status === 'READY' && file?.storagePath) {
        try {
          videoUrl = await storageService.getPresignedGetUrl(file.storagePath, 86400);
        } catch {
          videoUrl = null;
        }
      }

      angles.push({
        id: camera.id,
        cameraName: camera.name,
        status,
        videoUrl,
        downloadUrl: videoUrl,
        duration: file?.duration,
      });
    }
  } else {
    for (const file of files) {
      const cameraName = file.camera?.name || `Câmera ${file.cameraId}`;
      const status = file.uploadStatus || 'READY';
      let videoUrl: string | null = null;

      if (status === 'READY' && file.storagePath) {
        try {
          videoUrl = await storageService.getPresignedGetUrl(file.storagePath, 86400);
        } catch {
          videoUrl = null;
        }
      }

      angles.push({
        id: file.id || file.cameraId,
        cameraName,
        status,
        videoUrl,
        downloadUrl: videoUrl,
        duration: file.duration,
      });
    }
  }

  return (
    <ShareEventView
      eventName={eventName}
      date={formattedDate}
      fieldName={fieldName}
      shareUrl={shareUrl}
      angles={angles}
    />
  );
}
