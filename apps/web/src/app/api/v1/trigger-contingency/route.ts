import { NextResponse } from 'next/server';
import { handleContingencyTrigger } from './handlers';

export async function POST(req: Request) {
  const result = await handleContingencyTrigger(req);
  return NextResponse.json(result.data, { status: result.status });
}
