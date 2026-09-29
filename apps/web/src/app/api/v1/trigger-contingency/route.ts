import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { prisma } from '../../../../lib/db';

export interface ContingencyTriggerPayload {
  fieldId: string;
  triggerSource?: string;
  agentUrl?: string;
}

export interface HandlerResponse<T = any> {
  status: number;
  data: T;
}

export async function handleContingencyTrigger(
  reqOrBody: Request | ContingencyTriggerPayload
): Promise<HandlerResponse> {
  let body: any = reqOrBody;

  if (reqOrBody && typeof (reqOrBody as any).json === 'function') {
    try {
      body = await (reqOrBody as Request).json();
    } catch {
      return { status: 400, data: { error: 'Invalid JSON request body' } };
    }
  }

  if (!body || typeof body.fieldId !== 'string' || body.fieldId.trim() === '') {
    return { status: 400, data: { error: 'fieldId is required' } };
  }

  const fieldId = body.fieldId.trim();
  const triggerSource = body.triggerSource || 'WEB_INTERFACE';
  const commandId = `web-${crypto.randomUUID()}`;
  const agentUrl = body.agentUrl || process.env.FIELD_AGENT_URL || 'http://127.0.0.1:8000';

  // 1. Look up device authentication token for field agent if registered
  let deviceToken: string | undefined = process.env.FIELD_AGENT_DEVICE_TOKEN;
  try {
    const device = await prisma.device.findFirst({
      where: { fieldId, deviceType: 'AGENT' },
    });
    if (device?.secretToken) {
      deviceToken = device.secretToken;
    }
  } catch {
    // Ignore db query failure in isolated unit test scenarios
  }

  // 2. Attempt to dispatch trigger directly to local field agent
  const targetEndpoint = `${agentUrl.replace(/\/$/, '')}/api/v1/trigger`;
  try {
    const fetchResponse = await fetch(targetEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(deviceToken ? { Authorization: `Bearer ${deviceToken}` } : {}),
      },
      body: JSON.stringify({
        command_id: commandId,
        trigger_source: triggerSource,
        field_id: fieldId,
        timestamp: Date.now() / 1000,
      }),
    });

    if (fetchResponse.ok) {
      const data = await fetchResponse.json();
      return {
        status: 200,
        data: {
          status: data.status || 'ACCEPTED',
          event_id: data.event_id || data.eventId || commandId,
          command_id: data.command_id || commandId,
          source: 'FIELD_AGENT',
        },
      };
    }
  } catch {
    // Field agent is unreachable or offline; proceed to central DB fallback
  }

  // 3. Fallback: create contingency ClipEvent directly in central database
  try {
    const fallbackEvent = await prisma.clipEvent.create({
      data: {
        fieldId,
        commandId,
        triggerSource,
        status: 'QUEUED',
      },
    });

    return {
      status: 200,
      data: {
        status: 'ACCEPTED',
        event_id: fallbackEvent.id,
        command_id: commandId,
        source: 'CONTINGENCY_DATABASE',
        contingency_fallback: true,
      },
    };
  } catch (err: any) {
    return {
      status: 500,
      data: {
        error: 'Failed to record contingency trigger',
        details: err?.message || String(err),
      },
    };
  }
}

export async function POST(req: Request) {
  const result = await handleContingencyTrigger(req);
  return NextResponse.json(result.data, { status: result.status });
}
