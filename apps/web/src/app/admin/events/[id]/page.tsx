import React from 'react';
import Link from 'next/link';
import { prisma } from '../../../../lib/db';
import ShareActions from './ShareActions';
import RetryButton from './RetryButton';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: '1100px',
    margin: '0 auto',
    padding: '32px 20px',
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    color: '#0f172a',
    backgroundColor: '#f8fafc',
    minHeight: '100vh',
    boxSizing: 'border-box',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: '16px',
    padding: '32px',
    boxShadow: '0 1px 4px rgba(0, 0, 0, 0.06)',
    border: '1px solid #e2e8f0',
    marginBottom: '24px',
  },
  notFoundCard: {
    backgroundColor: '#ffffff',
    borderRadius: '16px',
    padding: '48px 32px',
    textAlign: 'center',
    boxShadow: '0 1px 4px rgba(0, 0, 0, 0.06)',
    border: '1px solid #e2e8f0',
    maxWidth: '500px',
    margin: '60px auto',
  },
  backLink: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    color: '#0284c7',
    textDecoration: 'none',
    fontWeight: '600',
    fontSize: '14px',
    marginBottom: '20px',
  },
  headerRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    flexWrap: 'wrap',
    gap: '16px',
    borderBottom: '1px solid #f1f5f9',
    paddingBottom: '20px',
    marginBottom: '20px',
  },
  title: {
    fontSize: '24px',
    fontWeight: '800',
    color: '#0f172a',
    margin: '0 0 6px 0',
  },
  fieldName: {
    fontSize: '15px',
    color: '#64748b',
    margin: 0,
  },
  metaGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '16px',
    backgroundColor: '#f8fafc',
    padding: '16px',
    borderRadius: '10px',
    marginBottom: '24px',
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
    marginBottom: '16px',
  },
  th: {
    backgroundColor: '#f1f5f9',
    padding: '12px 14px',
    fontWeight: '600',
    color: '#475569',
    borderBottom: '1px solid #e2e8f0',
  },
  td: {
    padding: '14px',
    borderBottom: '1px solid #f1f5f9',
    color: '#334155',
    verticalAlign: 'middle',
  },
};

function getStatusBadgeStyle(status: string): React.CSSProperties {
  let bg = '#fef3c7';
  let color = '#b45309';

  if (status === 'READY' || status === 'COMPLETED') {
    bg = '#dcfce7';
    color = '#15803d';
  } else if (status === 'FAILED' || status === 'CAMERA_UNAVAILABLE') {
    bg = '#fee2e2';
    color = '#b91c1c';
  } else if (status === 'PROCESSING' || status === 'UPLOADING') {
    bg = '#e0f2fe';
    color = '#0369a1';
  }

  return {
    display: 'inline-block',
    padding: '4px 10px',
    borderRadius: '9999px',
    fontSize: '12px',
    fontWeight: '700',
    backgroundColor: bg,
    color: color,
  };
}

export default async function AdminEventPage({ params }: PageProps) {
  const resolvedParams = await params;
  const id = resolvedParams.id;

  const event = await prisma.clipEvent.findUnique({
    where: { id },
    include: {
      field: {
        include: {
          cameras: { orderBy: { displayOrder: 'asc' } },
        },
      },
      files: {
        include: {
          camera: true,
        },
      },
      tokens: {
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (!event) {
    return (
      <main style={styles.container}>
        <div style={styles.notFoundCard}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>🔍</div>
          <h1 style={{ fontSize: '20px', fontWeight: '700', color: '#b91c1c', margin: '0 0 12px 0' }}>
            Evento não encontrado
          </h1>
          <p style={{ fontSize: '14px', color: '#64748b', marginBottom: '24px' }}>
            O identificador de evento fornecido não corresponde a nenhum registro operacional.
          </p>
          <Link href="/admin/fields" style={styles.backLink}>
            ← Voltar para Painel de Campos
          </Link>
        </div>
      </main>
    );
  }

  // Build camera angles
  const fieldCameras = event.field?.cameras || [];
  const isProcessing = event.status === 'PROCESSING' || event.status === 'QUEUED';
  const defaultMissingStatus = isProcessing ? 'PENDING' : 'CAMERA_UNAVAILABLE';

  const angles: Array<{
    id: string;
    cameraName: string;
    fileId?: string;
    uploadStatus: string;
    duration?: number;
    storagePath?: string;
    sha256?: string | null;
  }> = [];

  if (fieldCameras.length > 0) {
    for (const cam of fieldCameras) {
      const file = event.files.find((f) => f.cameraId === cam.id);
      angles.push({
        id: cam.id,
        cameraName: cam.name,
        fileId: file?.id,
        uploadStatus: file?.uploadStatus || defaultMissingStatus,
        duration: file?.duration,
        storagePath: file?.storagePath,
        sha256: file?.sha256,
      });
    }
  } else {
    for (const file of event.files) {
      angles.push({
        id: file.cameraId,
        cameraName: file.camera?.name || `Câmera ${file.cameraId}`,
        fileId: file.id,
        uploadStatus: file.uploadStatus,
        duration: file.duration,
        storagePath: file.storagePath,
        sha256: file.sha256,
      });
    }
  }

  return (
    <main style={styles.container}>
      <Link href="/admin/fields" style={styles.backLink}>
        ← Voltar para Painel de Campos
      </Link>

      <section style={styles.card}>
        <div style={styles.headerRow}>
          <div>
            <h1 style={styles.title}>Detalhes do Evento: {event.id}</h1>
            <p style={styles.fieldName}>
              Campo: <strong>{event.field?.name || event.fieldId}</strong>
            </p>
          </div>
          <div>
            <span style={getStatusBadgeStyle(event.status)}>{event.status}</span>
          </div>
        </div>

        <div style={styles.metaGrid}>
          <div style={styles.metaItem}>
            <span style={styles.metaLabel}>Origem do Disparo</span>
            <span style={styles.metaValue}>{event.triggerSource}</span>
          </div>
          <div style={styles.metaItem}>
            <span style={styles.metaLabel}>Command ID</span>
            <span style={styles.metaValue}>{event.commandId}</span>
          </div>
          <div style={styles.metaItem}>
            <span style={styles.metaLabel}>Data/Hora do Acionamento</span>
            <span style={styles.metaValue}>
              {new Date(event.triggeredAt || event.createdAt).toLocaleString('pt-BR', {
                timeZone: 'America/Sao_Paulo',
              })}
            </span>
          </div>
          <div style={styles.metaItem}>
            <span style={styles.metaLabel}>Ângulos Gravados</span>
            <span style={styles.metaValue}>{angles.length}</span>
          </div>
        </div>

        <h2 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '16px' }}>
          Status dos Ângulos de Câmera
        </h2>

        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Câmera</th>
              <th style={styles.th}>Status de Processamento / Upload</th>
              <th style={styles.th}>Duração</th>
              <th style={styles.th}>Caminho Storage / Hash</th>
              <th style={styles.th}>Ação</th>
            </tr>
          </thead>
          <tbody>
            {angles.map((angle) => {
              const needsRetry =
                angle.uploadStatus === 'FAILED' ||
                angle.uploadStatus === 'PENDING' ||
                angle.uploadStatus === 'CAMERA_UNAVAILABLE';

              return (
                <tr key={angle.id}>
                  <td style={styles.td}>
                    <strong>{angle.cameraName}</strong>
                  </td>
                  <td style={styles.td}>
                    <span style={getStatusBadgeStyle(angle.uploadStatus)}>
                      {angle.uploadStatus}
                    </span>
                  </td>
                  <td style={styles.td}>
                    {angle.duration ? `${angle.duration.toFixed(1)}s` : '-'}
                  </td>
                  <td style={styles.td}>
                    {angle.storagePath ? (
                      <code style={{ fontSize: '11px', color: '#64748b' }}>
                        {angle.storagePath}
                      </code>
                    ) : (
                      <span style={{ color: '#94a3b8', fontSize: '12px' }}>Não enviado</span>
                    )}
                  </td>
                  <td style={styles.td}>
                    {needsRetry ? (
                      <RetryButton
                        fileId={angle.fileId}
                        cameraId={angle.id}
                        eventId={event.id}
                      />
                    ) : (
                      <span style={{ color: '#15803d', fontSize: '13px', fontWeight: '600' }}>
                        ✓ Concluído
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div style={{ marginTop: '24px', borderTop: '1px solid #f1f5f9', paddingTop: '20px' }}>
          <h2 style={{ fontSize: '18px', fontWeight: '700', marginBottom: '8px' }}>
            Compartilhamento Público
          </h2>
          <p style={{ fontSize: '14px', color: '#64748b', margin: '0 0 12px 0' }}>
            Gere um link temporário com token seguro para visualização externa dos vídeos prontos.
          </p>
          <ShareActions eventId={event.id} initialShareUrl={undefined} />
        </div>
      </section>
    </main>
  );
}
