import React from 'react';
import Link from 'next/link';
import { prisma } from '../../../lib/db';
import { statusTone } from '../../../lib/statusTone';
import {
  Alert,
  Badge,
  Card,
  MetaGrid,
  MetaItem,
  Table,
  Td,
  Th,
} from '../../../components/ui';
import ContingencyButton from './ContingencyButton';
import CreateFieldModal from './CreateFieldModal';
import AddCameraModal from './AddCameraModal';
import DeleteFieldButton from './DeleteFieldButton';
import { sanitizeRtspUrl } from './utils';
import s from './page.module.css';

export const dynamic = 'force-dynamic';

export default async function AdminFieldsPage() {
  const fields = await prisma.field.findMany({
    include: {
      cameras: {
        orderBy: { displayOrder: 'asc' },
      },
      profile: true,
      devices: true,
      events: {
        orderBy: { createdAt: 'desc' },
        take: 5,
      },
    },
    orderBy: { name: 'asc' },
  });

  const now = Date.now();
  const FIVE_MINUTES_MS = 5 * 60 * 1000;

  const agentUrl = process.env.FIELD_AGENT_URL || 'http://agent:8000';
  let agentReachable = false;
  try {
    const res = await fetch(`${agentUrl.replace(/\/$/, '')}/api/v1/health`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(1000),
    });
    agentReachable = res.ok;
  } catch {
    agentReachable = false;
  }

  return (
    <main className={s.container}>
      <div className={s.header}>
        <div>
          <h1 className={s.title}>Painel Operacional — Campos e Câmeras</h1>
          <p className={s.subtitle}>
            Monitoramento de conectividade, perfis de captura e acionamento de contingência.
          </p>
        </div>
        <CreateFieldModal />
      </div>

      {fields.length === 0 ? (
        <Card>
          <p className={`${s.emptyNotice} ${s.emptyNoticeSpaced}`}>
            Nenhum campo cadastrado no momento. Cadastre seu primeiro campo com as URLs RTSP reais para começar.
          </p>
          <CreateFieldModal />
        </Card>
      ) : (
        <div className={s.fieldGrid}>
          {fields.map((field) => {
            const agentDevice = field.devices.find((d) => d.deviceType === 'AGENT');
            const lastHeartbeat = agentDevice?.lastHeartbeatAt;
            const isOnline = agentReachable || (lastHeartbeat
              ? now - new Date(lastHeartbeat).getTime() < FIVE_MINUTES_MS
              : false);

            // Check queue lag: events in QUEUED or PROCESSING older than 5 minutes
            const hasQueueLag = field.events.some((evt) => {
              const isPending = evt.status === 'QUEUED' || evt.status === 'PROCESSING';
              const age = now - new Date(evt.createdAt).getTime();
              return isPending && age > FIVE_MINUTES_MS;
            });

            return (
              <Card as="section" key={field.id}>
                <div className={s.cardHeader}>
                  <div>
                    <h2 className={s.fieldName}>{field.name}</h2>
                    <span className={s.cardMeta}>
                      ID: {field.id} • Status: {field.status}
                    </span>
                  </div>

                  <div className={s.actions}>
                    <Badge tone={isOnline ? 'success' : 'danger'} className={s.agentBadge}>
                      <span>●</span>
                      <span>Agente {isOnline ? 'Online' : 'Offline'}</span>
                    </Badge>
                    <DeleteFieldButton fieldId={field.id} fieldName={field.name} />
                  </div>
                </div>

                {hasQueueLag && (
                  <Alert tone="warning" className={s.warning}>
                    <span>⚠️</span>
                    <span>
                      Aviso de Lentidão na Fila: existem eventos pendentes aguardando processamento há mais de 5 minutos.
                    </span>
                  </Alert>
                )}

                <MetaGrid className={s.metaGrid}>
                  <MetaItem label="Janela de Captura">
                    {field.profile?.secondsBefore ?? 15}s antes / {field.profile?.secondsAfter ?? 10}s depois
                  </MetaItem>

                  <MetaItem label="Retenção / Formato">
                    {field.profile?.retentionDays ?? 7} dias • {field.profile?.format ?? 'MP4'}
                  </MetaItem>

                  <MetaItem label="Último Batimento (Heartbeat)">
                    {lastHeartbeat
                      ? new Date(lastHeartbeat).toLocaleTimeString('pt-BR', {
                          timeZone: 'America/Sao_Paulo',
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })
                      : 'Nenhum registro'}
                  </MetaItem>

                  <MetaItem label="Dispositivo / Agente">
                    {agentDevice ? agentDevice.identifier : 'Não vinculado'}
                  </MetaItem>
                </MetaGrid>

                <div className={s.sectionHead}>
                  <h3 className={s.sectionHeadTitle}>Câmeras Vinculadas ({field.cameras.length})</h3>
                  <AddCameraModal fieldId={field.id} />
                </div>
                {field.cameras.length === 0 ? (
                  <p className={s.emptyNotice}>Nenhuma câmera cadastrada para este campo.</p>
                ) : (
                  <Table className={s.table}>
                    <thead>
                      <tr>
                        <Th>Ordem</Th>
                        <Th>Nome do Ângulo</Th>
                        <Th>Status</Th>
                        <Th>RTSP Stream</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {field.cameras.map((cam) => (
                        <tr key={cam.id}>
                          <Td>#{cam.displayOrder}</Td>
                          <Td>
                            <strong>{cam.name}</strong>
                          </Td>
                          <Td>
                            <Badge size="sm" tone={cam.status === 'ACTIVE' ? 'success' : 'danger'}>
                              {cam.status}
                            </Badge>
                          </Td>
                          <Td>
                            <code className={s.code}>
                              {sanitizeRtspUrl(cam.rtspUrl)}
                            </code>
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                )}

                <h3 className={s.sectionTitle}>Eventos Recentes ({field.events.length})</h3>
                {field.events.length === 0 ? (
                  <p className={s.emptyNotice}>Nenhum evento registrado ainda.</p>
                ) : (
                  <Table className={s.table}>
                    <thead>
                      <tr>
                        <Th>Data/Hora</Th>
                        <Th>ID Evento</Th>
                        <Th>Origem</Th>
                        <Th>Status</Th>
                        <Th>Ação</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {field.events.map((evt) => (
                        <tr key={evt.id}>
                          <Td>
                            {new Date(evt.triggeredAt || evt.createdAt).toLocaleTimeString('pt-BR', {
                              timeZone: 'America/Sao_Paulo',
                              hour: '2-digit',
                              minute: '2-digit',
                              second: '2-digit',
                            })}
                          </Td>
                          <Td>{evt.id}</Td>
                          <Td>{evt.triggerSource}</Td>
                          <Td>
                            <Badge size="sm" tone={statusTone(evt.status, 'fieldList')}>
                              {evt.status}
                            </Badge>
                          </Td>
                          <Td>
                            <Link href={`/admin/events/${evt.id}`} className={s.link}>
                              Ver Detalhes →
                            </Link>
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                )}

                <div className={s.contingency}>
                  <ContingencyButton fieldId={field.id} />
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </main>
  );
}
