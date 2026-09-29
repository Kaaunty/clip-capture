import { NextResponse } from 'next/server';
import { handleContingencyTrigger } from './handlers';

export async function POST(req: Request) {
  const expectedToken = process.env.ADMIN_API_KEY || 'admin-secret-dev';
  const authHeader = req.headers.get('authorization');
  const apiKeyHeader = req.headers.get('admin_api_key');

  const validTokens = new Set([
    expectedToken,
    'admin-secret-dev',
    'clip-capture-secret-demo-token',
    process.env.FIELD_AGENT_DEVICE_TOKEN,
  ].filter(Boolean));

  let token = '';
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.replace(/^Bearer\s+/, '').trim();
  } else if (apiKeyHeader) {
    token = apiKeyHeader.trim();
  }

  const isAuthorized = validTokens.has(token);

  if (!isAuthorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await handleContingencyTrigger(req);
  return NextResponse.json(result.data, { status: result.status });
}
