import { NextResponse } from 'next/server';
import { prisma } from '../../../../../../lib/db';
import { generateShareToken } from '../../../../../../lib/tokens';

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const params = await context.params;
    const eventId = params.id;

    if (!eventId) {
      return NextResponse.json({ error: 'Missing event ID' }, { status: 400 });
    }

    const event = await prisma.clipEvent.findUnique({
      where: { id: eventId },
    });

    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    let hoursValid = 24;
    try {
      const body = await req.json();
      if (body && typeof body.hoursValid === 'number' && body.hoursValid > 0) {
        hoursValid = body.hoursValid;
      }
    } catch {
      // Body is optional or empty
    }

    const result = await generateShareToken(eventId, hoursValid);

    return NextResponse.json(
      {
        shareUrl: result.shareUrl,
        rawToken: result.rawToken,
        tokenRecord: result.tokenRecord,
        expiresAt: result.tokenRecord.expiresAt.toISOString(),
      },
      { status: 201 },
    );
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Internal server error' },
      { status: 500 },
    );
  }
}
