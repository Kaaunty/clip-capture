import { NextResponse } from 'next/server';
import { prisma } from '../../../../../../lib/db';

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: fieldId } = await context.params;
    const body = await req.json();
    const { name, rtspUrl, order } = body;

    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'Camera name is required' }, { status: 400 });
    }

    const field = await prisma.field.findUnique({
      where: { id: fieldId },
      include: { cameras: true },
    });

    if (!field) {
      return NextResponse.json({ error: 'Field not found' }, { status: 404 });
    }

    const nextOrder = order !== undefined ? Number(order) : field.cameras.length + 1;

    const camera = await prisma.camera.create({
      data: {
        fieldId,
        name: name.trim(),
        rtspUrl: (rtspUrl || '').trim(),
        displayOrder: nextOrder,
        status: rtspUrl && rtspUrl.trim() ? 'ACTIVE' : 'INACTIVE',
      },
    });

    return NextResponse.json({ camera }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
