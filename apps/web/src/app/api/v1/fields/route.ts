import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { prisma } from '../../../../lib/db';

export async function GET() {
  try {
    const fields = await prisma.field.findMany({
      include: {
        cameras: true,
        profile: true,
        devices: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json({ fields });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { name, secondsBefore = 15, secondsAfter = 10, cameras = [], deviceToken } = body;

    if (!name || typeof name !== 'string' || name.trim() === '') {
      return NextResponse.json({ error: 'Field name is required' }, { status: 400 });
    }

    const token = deviceToken || `tok_${crypto.randomBytes(16).toString('hex')}`;

    const field = await prisma.field.create({
      data: {
        name: name.trim(),
        status: 'ACTIVE',
        profile: {
          create: {
            secondsBefore: Number(secondsBefore) || 15,
            secondsAfter: Number(secondsAfter) || 10,
            retentionDays: 7,
            format: 'MP4',
          },
        },
        devices: {
          create: [
            {
              deviceType: 'AGENT',
              identifier: `agent-${Date.now()}`,
              secretToken: token,
            },
          ],
        },
        cameras: {
          create: cameras.map((cam: any, index: number) => ({
            name: cam.name || `Câmera ${index + 1}`,
            rtspUrl: cam.rtspUrl || '',
            displayOrder: cam.order !== undefined ? Number(cam.order) : index + 1,
            status: cam.rtspUrl ? 'ACTIVE' : 'INACTIVE',
          })),
        },
      },
      include: {
        cameras: true,
        profile: true,
        devices: true,
      },
    });

    return NextResponse.json({ field, deviceToken: token }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
