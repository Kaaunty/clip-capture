import { NextResponse } from 'next/server';
import { handleCreateEvent } from './handlers';

export async function POST(req: Request) {
  const result = await handleCreateEvent(req);
  return NextResponse.json(result.data, { status: result.status });
}
