import { NextResponse } from 'next/server';
import { handleUploadClip } from '../../events/handlers';

export async function POST(req: Request) {
  const result = await handleUploadClip(req);
  return NextResponse.json(result.data, { status: result.status });
}
