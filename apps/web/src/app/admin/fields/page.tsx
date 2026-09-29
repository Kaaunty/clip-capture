import React from 'react';
import Link from 'next/link';
import { prisma } from '../../../lib/db';
import ContingencyButton from './ContingencyButton';
import CreateFieldModal from './CreateFieldModal';
import { sanitizeRtspUrl } from './utils';

export const dynamic = 'force-dynamic';

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: '1200px',
    margin: '0 auto',
    padding: '32px 20px',
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    color: '#0f172a',
    backgroundColor: '#f8fafc',
    minHeight: '100vh',
    boxSizing: 'border-box',
  },
  header: {
    backgroundColor: '#ffffff',
    borderRadius: '16px',
    padding: '24px 32px',
    marginBottom: '28px',
    boxShadow: '0 1px 3px rgba(0, 0, 0, 0.06)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '16px',
  },
  title: {
    fontSize: '26px',
    fontWeight: '800',
    color: '#0f172a',
    margin: '0 0 6px 0',
  },
  subtitle: {
    fontSize: '14px',
    color: '#64748b',
    margin: 0,
  },
  fieldGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: '28px',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: '16px',
    padding: '28px',
    boxShadow: '0 1px 4px rgba(0, 0, 0, 0.06)',
    border: '1px solid #e2e8f0',
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    borderBottom: '1px solid #f1f5f9',
    paddingBottom: '20px',
    marginBottom: '20px',
    flexWrap: 'wrap',
    gap: '16px',
  },
  fieldName: {
    fontSize: '22px',
    fontWeight: '700',
    color: '#1e293b',
    margin: '0 0 8px 0',
  },
  badgeOnline: {
    backgroundColor: '#dcfce7',
    color: '#15803d',
    padding: '4px 10px',
    borderRadius: '9999px',
    fontSize: '12px',
    fontWeight: '700',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
  },
  badgeOffline: {
    backgroundColor: '#fee2e2',
    color: '#b91c1c',
    padding: '4px 10px',
    borderRadius: '9999px',
    fontSize: '12px',
    fontWeight: '700',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
  },
  warningBanner: {
    backgroundColor: '#fffbeb',
    border: '1px solid #fef3c7',
    borderRadius: '10px',
    padding: '14px 18px',
    marginBottom: '20px',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    color: '#b45309',
    fontSize: '14px',
    fontWeight: '600',
  },
  sectionTitle: {
    fontSize: '16px',
    fontWeight: '700',
    color: '#334155',
    margin: '18px 0 10px 0',
  },
  metaGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: '16px',
    backgroundColor: '#f8fafc',
    padding: '16px',
    borderRadius: '10px',
    marginBottom: '20px',
  },
  metaItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  metaLabel: {
    fontSize: '12px',
    textTransform: 'uppercase',
    color: '#64748b',
    fontWeight: '600',
  },
  metaValue: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#1e293b',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    textAlign: 'left',
    fontSize: '14px',
    marginBottom: '20px',
  },
  th: {
    backgroundColor: '#f1f5f9',
    padding: '10px 14px',
    fontWeight: '600',
    color: '#475569',
    borderBottom: '1px solid #e2e8f0',
  },
  td: {
    padding: '12px 14px',
    borderBottom: '1px solid #f1f5f9',
    color: '#334155',
  },
  link: {
    color: '#0284c7',
    textDecoration: 'none',
    fontWeight: '600',
  },
  emptyNotice: {
    color: '#94a3b8',
    fontStyle: 'italic',
    fontSize: '13px',
  },
};

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

  return (
    <main style={styles.container}>
      <header style={styles.header}>
        <div>
          <h1 style={styles.title}>Painel Operacional — Campos e Câmeras</h1>
          <p style={styles.subtitle}>
            Monitoramento de conectividade, perfis de captura e acionamento de contingência.
          </p>
        </div>
        <CreateFieldModal />
      </header>

      {fields.length === 0 ? (
        <div style={styles.card}>
          <p style={{ ...styles.emptyNotice, marginBottom: '16px' }}>
            Nenhum campo cadastrado no momento. Cadastre seu primeiro campo com as URLs RTSP reais para começar.
          </p>
          <CreateFieldModal />
        </div>
      ) : (
        <div style={styles.fieldGrid}>
          {fields.map((field) => {
            const agentDevice = field.devices.find((d) => d.deviceType === 'AGENT');
            const lastHeartbeat = agentDevice?.lastHeartbeatAt;
            const isOnline = lastHeartbeat
              ? now - new Date(lastHeartbeat).getTime() < FIVE_MINUTES_MS
              : false;

            // Check queue lag: events in QUEUED or PROCESSING older than 5 minutes
            const hasQueueLag = field.events.some((evt) => {
              const isPending = evt.status === 'QUEUED' || evt.status === 'PROCESSING';
              const age = now - new Date(evt.createdAt).getTime();
              return isPending && age > FIVE_MINUTES_MS;
            });

            return (
              <section key={field.id} style={styles.card}>
                <div style={styles.cardHeader}>
                  <div>
                    <h2 style={styles.fieldName}>{field.name}</h2>
                    <span style={{ fontSize: '12px', color: '#64748b' }}>
                      ID: {field.id} • Status: {field.status}
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                    <div style={isOnline ? styles.badgeOnline : styles.badgeOffline}>
                      <span>●</span>
                      <span>Agente {isOnline ? 'Online' : 'Offline'}</span>
                    </div>
                  </div>
                </div>

                {hasQueueLag && (
                  <div style={styles.warningBanner}>
                    <span>⚠️</span>
                    <span>
                      Aviso de Lentidão na Fila: existem eventos pendentes aguardando processamento há mais de 5 minutos.
                    </span>
                  </div>
                )}

                <div style={styles.metaGrid}>
                  <div style={styles.metaItem}>
                    <span style={styles.metaLabel}>Janela de Captura</span>
                    <span style={styles.metaValue}>
                      {field.profile?.secondsBefore ?? 15}s antes / {field.profile?.secondsAfter ?? 10}s depois
                    </span>
                  </div>

                  <div style={styles.metaItem}>
                    <span style={styles.metaLabel}>Retenção / Formato</span>
                    <span style={styles.metaValue}>
                      {field.profile?.retentionDays ?? 7} dias • {field.profile?.format ?? 'MP4'}
                    </span>
                  </div>

                  <div style={styles.metaItem}>
                    <span style={styles.metaLabel}>Último Batimento (Heartbeat)</span>
                    <span style={styles.metaValue}>
                      {lastHeartbeat
                        ? new Date(lastHeartbeat).toLocaleTimeString('pt-BR', {
                            timeZone: 'America/Sao_Paulo',
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                          })
                        : 'Nenhum registro'}
                    </span>
                  </div>

                  <div style={styles.metaItem}>
                    <span style={styles.metaLabel}>Dispositivo / Agente</span>
                    <span style={styles.metaValue}>
                      {agentDevice ? agentDevice.identifier : 'Não vinculado'}
                    </span>
                  </div>
                </div>

                <h3 style={styles.sectionTitle}>Câmeras Vinculadas ({field.cameras.length})</h3>
                {field.cameras.length === 0 ? (
                  <p style={styles.emptyNotice}>Nenhuma câmera cadastrada para este campo.</p>
                ) : (
                  <table style={styles.table}>
                    <thead>
                      <tr>
                        <th style={styles.th}>Ordem</th>
                        <th style={styles.th}>Nome do Ângulo</th>
                        <th style={styles.th}>Status</th>
                        <th style={styles.th}>RTSP Stream</th>
                      </tr>
                    </thead>
                    <tbody>
                      {field.cameras.map((cam) => (
                        <tr key={cam.id}>
                          <td style={styles.td}>#{cam.displayOrder}</td>
                          <td style={styles.td}>
                            <strong>{cam.name}</strong>
                          </td>
                          <td style={styles.td}>
                            <span
                              style={{
                                display: 'inline-block',
                                padding: '2px 8px',
                                borderRadius: '4px',
                                fontSize: '11px',
                                fontWeight: '700',
                                backgroundColor: cam.status === 'ACTIVE' ? '#dcfce7' : '#fee2e2',
                                color: cam.status === 'ACTIVE' ? '#15803d' : '#b91c1c',
                              }}
                            >
                              {cam.status}
                            </span>
                          </td>
                          <td style={styles.td}>
                            <code style={{ fontSize: '12px', color: '#64748b' }}>
                              {sanitizeRtspUrl(cam.rtspUrl)}
                            </code>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                <h3 style={styles.sectionTitle}>Eventos Recentes ({field.events.length})</h3>
                {field.events.length === 0 ? (
                  <p style={styles.emptyNotice}>Nenhum evento registrado ainda.</p>
                ) : (
                  <table style={styles.table}>
                    <thead>
                      <tr>
                        <th style={styles.th}>Data/Hora</th>
                        <th style={styles.th}>ID Evento</th>
                        <th style={styles.th}>Origem</th>
                        <th style={styles.th}>Status</th>
                        <th style={styles.th}>Ação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {field.events.map((evt) => (
                        <tr key={evt.id}>
                          <td style={styles.td}>
                            {new Date(evt.triggeredAt || evt.createdAt).toLocaleTimeString('pt-BR', {
                              timeZone: 'America/Sao_Paulo',
                              hour: '2-digit',
                              minute: '2-digit',
                              second: '2-digit',
                            })}
                          </td>
                          <td style={styles.td}>{evt.id}</td>
                          <td style={styles.td}>{evt.triggerSource}</td>
                          <td style={styles.td}>
                            <span
                              style={{
                                display: 'inline-block',
                                padding: '2px 8px',
                                borderRadius: '4px',
                                fontSize: '11px',
                                fontWeight: '700',
                                backgroundColor:
                                  evt.status === 'READY' || evt.status === 'COMPLETED'
                                    ? '#dcfce7'
                                    : evt.status === 'FAILED'
                                    ? '#fee2e2'
                                    : '#fef3c7',
                                color:
                                  evt.status === 'READY' || evt.status === 'COMPLETED'
                                    ? '#15803d'
                                    : evt.status === 'FAILED'
                                    ? '#b91c1c'
                                    : '#b45309',
                              }}
                            >
                              {evt.status}
                            </span>
                          </td>
                          <td style={styles.td}>
                            <Link href={`/admin/events/${evt.id}`} style={styles.link}>
                              Ver Detalhes →
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                <div style={{ marginTop: '20px', borderTop: '1px solid #f1f5f9', paddingTop: '16px' }}>
                  <ContingencyButton fieldId={field.id} />
                </div>
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}
