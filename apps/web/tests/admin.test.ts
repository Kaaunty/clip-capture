/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterAll, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { prisma } from '../src/lib/db';
import { handleContingencyTrigger } from '../src/app/api/v1/trigger-contingency/handlers';
import { POST } from '../src/app/api/v1/trigger-contingency/route';
import { POST as postRetry } from '../src/app/api/v1/events/[id]/retry/route';
import AdminFieldsPage from '../src/app/admin/fields/page';
import AdminEventPage from '../src/app/admin/events/[id]/page';
import ShareActions from '../src/app/admin/events/[id]/ShareActions';
import RetryButton from '../src/app/admin/events/[id]/RetryButton';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Admin Operational Endpoints', () => {
  beforeEach(async () => {
    // Clean up database
    await prisma.shareToken.deleteMany();
    await prisma.clipFile.deleteMany();
    await prisma.clipEvent.deleteMany();
    await prisma.device.deleteMany();
    await prisma.captureProfile.deleteMany();
    await prisma.camera.deleteMany();
    await prisma.field.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('dispatches contingency trigger to field agent', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ACCEPTED', event_id: 'evt-web-1' }),
    });
    global.fetch = mockFetch;

    const res = await handleContingencyTrigger({
      fieldId: 'field-1',
      triggerSource: 'WEB_INTERFACE',
    });

    expect(res.status).toBe(200);
    expect(res.data.status).toBe('ACCEPTED');
    expect(res.data.event_id).toBe('evt-web-1');
  });

  it('falls back to central database ClipEvent when field agent is unreachable', async () => {
    // Seed field for foreign key integrity
    await prisma.field.create({
      data: {
        id: 'field-fallback-1',
        name: 'Campo Fallback',
      },
    });

    // Mock fetch failure (connection refused / timeout)
    const mockFetch = vi.fn().mockRejectedValue(new Error('Connection refused'));
    global.fetch = mockFetch;

    const res = await handleContingencyTrigger({
      fieldId: 'field-fallback-1',
      triggerSource: 'WEB_INTERFACE',
    });

    expect(res.status).toBe(200);
    expect(res.data.status).toBe('ACCEPTED');
    expect(res.data.event_id).toBeDefined();

    // Verify record in database
    const savedEvent = await prisma.clipEvent.findUnique({
      where: { id: res.data.event_id },
    });
    expect(savedEvent).not.toBeNull();
    expect(savedEvent?.fieldId).toBe('field-fallback-1');
    expect(savedEvent?.triggerSource).toBe('WEB_INTERFACE');
    expect(savedEvent?.status).toBe('QUEUED');
  });

  it('supports custom commandId and deduplicates repeat triggers', async () => {
    await prisma.field.create({
      data: {
        id: 'field-dedup-1',
        name: 'Campo Dedup',
      },
    });

    const mockFetch = vi.fn().mockRejectedValue(new Error('Agent offline'));
    global.fetch = mockFetch;

    // First trigger with specific commandId
    const res1 = await handleContingencyTrigger({
      fieldId: 'field-dedup-1',
      commandId: 'custom-cmd-123',
    });
    expect(res1.status).toBe(200);
    expect(res1.data.status).toBe('ACCEPTED');

    // Duplicate trigger with same commandId
    const res2 = await handleContingencyTrigger({
      fieldId: 'field-dedup-1',
      command_id: 'custom-cmd-123',
    });
    expect(res2.status).toBe(200);
    expect(res2.data.status).toBe('DUPLICATE_IGNORED');
  });

  it('validates required fieldId in contingency trigger', async () => {
    const res = await handleContingencyTrigger({
      fieldId: '',
    });

    expect(res.status).toBe(400);
    expect(res.data.error).toBeDefined();
  });

  it('handles contingency trigger via Next.js POST route handler', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ACCEPTED', event_id: 'evt-route-1' }),
    });
    global.fetch = mockFetch;

    const req = new Request('http://localhost:3000/api/v1/trigger-contingency', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fieldId: 'field-1', triggerSource: 'WEB_INTERFACE' }),
    });

    const response = await POST(req);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe('ACCEPTED');
    expect(body.event_id).toBe('evt-route-1');
  });

  it('renders admin fields dashboard with camera health, capture profiles, and contingency trigger button', async () => {
    await prisma.field.create({
      data: {
        id: 'field-admin-1',
        name: 'Campo Sintético Alpha',
        profile: {
          create: {
            secondsBefore: 15,
            secondsAfter: 10,
            retentionDays: 7,
          },
        },
        cameras: {
          create: [
            {
              id: 'cam-1',
              name: 'Câmera Principal Norte',
              rtspUrl: 'rtsp://admin:supersecret@192.168.1.100/stream',
              displayOrder: 1,
              status: 'ACTIVE',
            },
          ],
        },
        devices: {
          create: [
            {
              id: 'dev-1',
              identifier: 'agent-box-01',
              secretToken: 'secret-token',
              deviceType: 'AGENT',
              lastHeartbeatAt: new Date(), // Just now -> Online
            },
          ],
        },
      },
    });

    const pageElement = await AdminFieldsPage();
    render(pageElement);

    expect(screen.getByText('Campo Sintético Alpha')).toBeDefined();
    expect(screen.getByText('Câmera Principal Norte')).toBeDefined();
    // Verify RTSP password is NOT exposed in the DOM
    expect(screen.queryByText(/supersecret/)).toBeNull();
    expect(screen.getByText(/rtsp:\/\/\*\*\*:\*\*\*@192\.168\.1\.100\/stream/)).toBeDefined();

    expect(screen.getByText(/15s/)).toBeDefined();
    expect(screen.getByText(/10s/)).toBeDefined();
    expect(screen.getByText(/Online/i)).toBeDefined();
    expect(screen.getByText('Disparar Lance (Contingência Web)')).toBeDefined();
  });

  it('renders queue lag warning when pending events exceed delay threshold', async () => {
    const field = await prisma.field.create({
      data: {
        id: 'field-lag-1',
        name: 'Campo com Fila Lenta',
      },
    });

    // Create an event that has been queued for 15 minutes
    const oldTimestamp = new Date(Date.now() - 15 * 60 * 1000);
    await prisma.clipEvent.create({
      data: {
        id: 'evt-lag-1',
        fieldId: field.id,
        commandId: 'cmd-lag-1',
        status: 'QUEUED',
        createdAt: oldTimestamp,
        triggeredAt: oldTimestamp,
      },
    });

    const pageElement = await AdminFieldsPage();
    render(pageElement);

    expect(screen.getByText(/Lentidão na Fila/i)).toBeDefined();
  });

  it('renders admin event details view with camera angles, statuses, and share link button', async () => {
    const field = await prisma.field.create({
      data: {
        id: 'field-evt-view-1',
        name: 'Campo Evento View',
        cameras: {
          create: [
            { id: 'cam-v1', name: 'Câmera Ângulo 1', rtspUrl: 'rtsp://cam1' },
            { id: 'cam-v2', name: 'Câmera Ângulo 2', rtspUrl: 'rtsp://cam2' },
          ],
        },
      },
    });

    const event = await prisma.clipEvent.create({
      data: {
        id: 'evt-view-1',
        fieldId: field.id,
        commandId: 'cmd-v1',
        status: 'COMPLETED',
        triggerSource: 'PHYSICAL_BUTTON',
        files: {
          create: [
            {
              cameraId: 'cam-v1',
              storagePath: 'clips/field-evt-view-1/evt-view-1_cam-v1.mp4',
              duration: 25,
              uploadStatus: 'READY',
            },
            {
              cameraId: 'cam-v2',
              storagePath: 'clips/field-evt-view-1/evt-view-1_cam-v2.mp4',
              duration: 0,
              uploadStatus: 'CAMERA_UNAVAILABLE',
            },
          ],
        },
      },
    });

    const pageElement = await AdminEventPage({
      params: Promise.resolve({ id: event.id }),
    });
    render(pageElement);

    expect(screen.getByText('Campo Evento View')).toBeDefined();
    expect(screen.getByText('Câmera Ângulo 1')).toBeDefined();
    expect(screen.getByText('Câmera Ângulo 2')).toBeDefined();
    expect(screen.getByText('READY')).toBeDefined();
    expect(screen.getByText('CAMERA_UNAVAILABLE')).toBeDefined();
    expect(screen.getByText(/Gerar Link de Compartilhamento/i)).toBeDefined();
  });

  it('defaults missing files to PENDING when event status is PROCESSING', async () => {
    const field = await prisma.field.create({
      data: {
        id: 'field-processing-1',
        name: 'Campo Em Processamento',
        cameras: {
          create: [
            { id: 'cam-p1', name: 'Câmera 1', rtspUrl: 'rtsp://cam1' },
            { id: 'cam-p2', name: 'Câmera 2', rtspUrl: 'rtsp://cam2' },
          ],
        },
      },
    });

    // Event is PROCESSING and only cam-p1 has a file so far
    const event = await prisma.clipEvent.create({
      data: {
        id: 'evt-proc-1',
        fieldId: field.id,
        commandId: 'cmd-proc-1',
        status: 'PROCESSING',
        files: {
          create: [
            {
              cameraId: 'cam-p1',
              storagePath: 'clips/cam1.mp4',
              duration: 25,
              uploadStatus: 'READY',
            },
          ],
        },
      },
    });

    const pageElement = await AdminEventPage({
      params: Promise.resolve({ id: event.id }),
    });
    render(pageElement);

    expect(screen.getByText('READY')).toBeDefined();
    expect(screen.getByText('PENDING')).toBeDefined();
    expect(screen.queryByText('CAMERA_UNAVAILABLE')).toBeNull();
  });

  it('handles operational retry via POST /api/v1/events/[id]/retry', async () => {
    const field = await prisma.field.create({
      data: {
        id: 'field-retry-1',
        name: 'Campo Retry',
        cameras: {
          create: [{ id: 'cam-r1', name: 'Câmera Retry', rtspUrl: 'rtsp://cam1' }],
        },
      },
    });

    const event = await prisma.clipEvent.create({
      data: {
        id: 'evt-retry-1',
        fieldId: field.id,
        commandId: 'cmd-retry-1',
        status: 'FAILED',
        files: {
          create: [
            {
              id: 'file-r1',
              cameraId: 'cam-r1',
              storagePath: 'clips/fail.mp4',
              duration: 0,
              uploadStatus: 'FAILED',
            },
          ],
        },
      },
    });

    const req = new Request('http://localhost:3000/api/v1/events/evt-retry-1/retry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileId: 'file-r1' }),
    });

    const res = await postRetry(req, {
      params: Promise.resolve({ id: 'evt-retry-1' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ACCEPTED');

    const updatedFile = await prisma.clipFile.findUnique({
      where: { id: 'file-r1' },
    });
    expect(updatedFile?.uploadStatus).toBe('PENDING');

    const updatedEvent = await prisma.clipEvent.findUnique({
      where: { id: 'evt-retry-1' },
    });
    expect(updatedEvent?.status).toBe('PROCESSING');
  });

  it('ShareActions correctly parses rawToken and shareUrl from share endpoint', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        shareUrl: 'http://localhost:3000/share/token-raw-abc',
        rawToken: 'token-raw-abc',
      }),
    });
    global.fetch = mockFetch;

    render(React.createElement(ShareActions, { eventId: 'evt-test-share' }));

    const generateBtn = screen.getByText(/Gerar Link de Compartilhamento/i);
    fireEvent.click(generateBtn);

    await waitFor(() => {
      expect(screen.getByText('Link gerado com sucesso!')).toBeDefined();
      expect(screen.getByText(/token-raw-abc/)).toBeDefined();
    });
  });

  it('RetryButton sends real POST request to retry endpoint and updates UI', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ACCEPTED' }),
    });
    global.fetch = mockFetch;

    render(React.createElement(RetryButton, { eventId: 'evt-123', cameraId: 'cam-1', fileId: 'file-1' }));

    const retryBtn = screen.getByText('🔄 Retentar Upload');
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.getByText('✓ Retentativa Agendada')).toBeDefined();
    });

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/v1/events/evt-123/retry',
      expect.objectContaining({
        method: 'POST',
      })
    );
  });

  it('renders 404 state when event is not found in admin view', async () => {
    const pageElement = await AdminEventPage({
      params: Promise.resolve({ id: 'nonexistent-event-id' }),
    });
    render(pageElement);

    expect(screen.getByText(/Evento não encontrado/i)).toBeDefined();
  });
});
