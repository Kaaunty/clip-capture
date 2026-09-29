import { NextResponse } from 'next/server';
import { handleContingencyTrigger } from './handlers';

export async function POST(req: Request) {
  const expectedToken = process.env.ADMIN_API_KEY || 'admin-secret-dev';
  const authHeader = req.headers.get('authorization');
  const apiKeyHeader = req.headers.get('admin_api_key');

  const isAuthorized = 
    authHeader === `Bearer ${expectedToken}` || 
    apiKeyHeader === expectedToken;

  if (!isAuthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await handleContingencyTrigger(req);
  return NextResponse.json(result.data, { status: result.status });
}
