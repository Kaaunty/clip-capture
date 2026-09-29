import { NextResponse } from 'next/server';
import { handleConfirmClip } from '../../events/handlers';

export async function POST(req: Request) {
  const result = await handleConfirmClip(req);
  return NextResponse.json(result.data, { status: result.status });
}
