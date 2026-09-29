import { NextResponse } from 'next/server';
import { prisma } from '../../../../../../lib/db';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(req: Request, { params }: RouteParams) {
  const { id: eventId } = await params;

  const event = await prisma.clipEvent.findUnique({
    where: { id: eventId },
    include: {
      files: true,
      field: {
        include: { cameras: true },
      },
    },
  });

  if (!event) {
    return NextResponse.json({ error: 'Event not found' }, { status: 404 });
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    // Body is optional
  }

  const { cameraId, fileId } = body;

  if (fileId) {
    await prisma.clipFile.update({
      where: { id: fileId },
      data: { uploadStatus: 'PENDING' },
    });
  } else if (cameraId) {
    const existingFile = event.files.find((f) => f.cameraId === cameraId);
    if (existingFile) {
      await prisma.clipFile.update({
        where: { id: existingFile.id },
        data: { uploadStatus: 'PENDING' },
      });
    } else {
      await prisma.clipFile.create({
        data: {
          eventId,
          cameraId,
          storagePath: `clips/${event.fieldId}/${eventId}_${cameraId}.mp4`,
          duration: 0,
          uploadStatus: 'PENDING',
        },
      });
    }
  } else {
    // Retry all failed/unavailable files
    await prisma.clipFile.updateMany({
      where: {
        eventId,
        uploadStatus: { in: ['FAILED', 'CAMERA_UNAVAILABLE'] },
      },
      data: { uploadStatus: 'PENDING' },
    });
  }

  // Set event status to PROCESSING
  await prisma.clipEvent.update({
    where: { id: eventId },
    data: { status: 'PROCESSING' },
  });

  return NextResponse.json(
    {
      status: 'ACCEPTED',
      event_id: eventId,
      message: 'Retry initiated successfully',
    },
    { status: 200 }
  );
}
