'use client';

import React from 'react';

export interface AngleViewItem {
  id: string;
  cameraName: string;
  status: string;
  videoUrl?: string | null;
  downloadUrl?: string | null;
  duration?: number;
}

export interface ShareEventViewProps {
  eventName: string;
  date?: string;
  fieldName?: string;
  shareUrl?: string;
  angles: AngleViewItem[];
  error?: string;
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: '960px',
    margin: '0 auto',
    padding: '24px 16px',
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    color: '#1a1a1a',
    backgroundColor: '#f8fafc',
    minHeight: '100vh',
    boxSizing: 'border-box',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: '12px',
    padding: '32px 24px',
    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)',
    textAlign: 'center' as const,
    maxWidth: '480px',
    margin: '80px auto',
  },
  errorIcon: {
    fontSize: '48px',
    marginBottom: '16px',
  },
  errorTitle: {
    fontSize: '22px',
    fontWeight: '700',
    color: '#b91c1c',
    margin: '0 0 12px 0',
  },
  errorText: {
    fontSize: '15px',
    color: '#64748b',
    lineHeight: '1.5',
    margin: 0,
  },
  header: {
    backgroundColor: '#ffffff',
    borderRadius: '16px',
    padding: '24px',
    marginBottom: '24px',
    boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.05)',
  },
  badgeRow: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    marginBottom: '12px',
    flexWrap: 'wrap' as const,
  },
  pillBadge: {
    backgroundColor: '#e0f2fe',
    color: '#0369a1',
    fontSize: '12px',
    fontWeight: '600',
    padding: '4px 10px',
    borderRadius: '9999px',
    letterSpacing: '0.025em',
  },
  fieldBadge: {
    backgroundColor: '#f1f5f9',
    color: '#475569',
    fontSize: '12px',
    fontWeight: '500',
    padding: '4px 10px',
    borderRadius: '9999px',
  },
  title: {
    fontSize: '24px',
    fontWeight: '800',
    color: '#0f172a',
    margin: '0 0 8px 0',
    lineHeight: '1.25',
  },
  date: {
    fontSize: '14px',
    color: '#64748b',
    margin: '0 0 16px 0',
  },
  actionRow: {
    marginTop: '16px',
  },
  whatsappButton: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#25D366',
    color: '#ffffff',
    fontWeight: '600',
    fontSize: '15px',
    padding: '12px 20px',
    borderRadius: '10px',
    textDecoration: 'none',
    boxShadow: '0 2px 4px rgba(37, 211, 102, 0.3)',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
  },
  anglesGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))',
    gap: '20px',
  },
  angleCard: {
    backgroundColor: '#ffffff',
    borderRadius: '14px',
    overflow: 'hidden',
    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.06)',
    display: 'flex',
    flexDirection: 'column' as const,
  },
  angleHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 20px',
    borderBottom: '1px solid #f1f5f9',
  },
  cameraName: {
    fontSize: '17px',
    fontWeight: '700',
    color: '#1e293b',
    margin: 0,
  },
  readyBadge: {
    backgroundColor: '#dcfce7',
    color: '#15803d',
    fontSize: '12px',
    fontWeight: '600',
    padding: '4px 10px',
    borderRadius: '9999px',
  },
  unavailableBadge: {
    backgroundColor: '#fee2e2',
    color: '#b91c1c',
    fontSize: '12px',
    fontWeight: '600',
    padding: '4px 10px',
    borderRadius: '9999px',
  },
  pendingBadge: {
    backgroundColor: '#fef3c7',
    color: '#b45309',
    fontSize: '12px',
    fontWeight: '600',
    padding: '4px 10px',
    borderRadius: '9999px',
  },
  videoWrapper: {
    display: 'flex',
    flexDirection: 'column' as const,
    backgroundColor: '#000000',
  },
  videoPlayer: {
    width: '100%',
    aspectRatio: '16 / 9',
    backgroundColor: '#000000',
    display: 'block',
  },
  downloadRow: {
    padding: '14px 16px',
    backgroundColor: '#ffffff',
    borderTop: '1px solid #f1f5f9',
  },
  downloadButton: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    boxSizing: 'border-box' as const,
    backgroundColor: '#0f172a',
    color: '#ffffff',
    fontSize: '14px',
    fontWeight: '600',
    padding: '10px 16px',
    borderRadius: '8px',
    textDecoration: 'none',
    textAlign: 'center' as const,
  },
  unavailableBox: {
    padding: '48px 24px',
    textAlign: 'center' as const,
    backgroundColor: '#fafafa',
  },
  unavailableText: {
    fontSize: '14px',
    color: '#64748b',
    margin: 0,
    lineHeight: '1.5',
  },
  pendingBox: {
    padding: '48px 24px',
    textAlign: 'center' as const,
    backgroundColor: '#fafafa',
  },
  pendingText: {
    fontSize: '14px',
    color: '#64748b',
    margin: 0,
    lineHeight: '1.5',
  },
};

export default function ShareEventView({
  eventName,
  date,
  fieldName,
  shareUrl,
  angles = [],
  error,
}: ShareEventViewProps) {
  if (error) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <div style={styles.errorIcon}>⚠️</div>
          <h1 style={styles.errorTitle}>{error}</h1>
          <p style={styles.errorText}>
            Este link de compartilhamento expirou ou não é válido. Entre em contato com o administrador do campo para gerar um novo link.
          </p>
        </div>
      </div>
    );
  }

  const currentUrl =
    typeof window !== 'undefined' && window.location.href
      ? window.location.href
      : shareUrl || '';
  const encodedShareText = encodeURIComponent(
    `Confira o lance ${eventName ? `"${eventName}"` : ''}${fieldName ? ` no ${fieldName}` : ''}: ${currentUrl}`,
  );
  const whatsappUrl = `https://api.whatsapp.com/send?text=${encodedShareText}`;

  return (
    <main style={styles.container}>
      <header style={styles.header}>
        <div style={styles.badgeRow}>
          <span style={styles.pillBadge}>Clip Capture</span>
          {fieldName && <span style={styles.fieldBadge}>{fieldName}</span>}
        </div>
        <h1 style={styles.title}>{eventName || 'Lance Gravado'}</h1>
        {date && <p style={styles.date}>{date}</p>}

        <div style={styles.actionRow}>
          <a
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={styles.whatsappButton}
          >
            <span style={{ marginRight: '8px' }}>💬</span>
            Compartilhar no WhatsApp
          </a>
        </div>
      </header>

      <section style={styles.anglesGrid}>
        {angles.map((angle) => {
          const isUnavailable = angle.status === 'CAMERA_UNAVAILABLE';
          const isReady = angle.status === 'READY' && !!angle.videoUrl;

          return (
            <article key={angle.id} style={styles.angleCard}>
              <div style={styles.angleHeader}>
                <h2 style={styles.cameraName}>{angle.cameraName}</h2>
                {isUnavailable ? (
                  <span style={styles.unavailableBadge}>Câmera Indisponível</span>
                ) : isReady ? (
                  <span style={styles.readyBadge}>Pronto</span>
                ) : (
                  <span style={styles.pendingBadge}>Processando</span>
                )}
              </div>

              {isUnavailable ? (
                <div style={styles.unavailableBox}>
                  <p style={styles.unavailableText}>
                    Esta câmera estava temporariamente indisponível no momento do lance.
                  </p>
                </div>
              ) : isReady ? (
                <div style={styles.videoWrapper}>
                  <video
                    controls
                    preload="metadata"
                    playsInline
                    src={angle.videoUrl!}
                    style={styles.videoPlayer}
                  >
                    Seu navegador não suporta a reprodução de vídeo.
                  </video>
                  <div style={styles.downloadRow}>
                    <a
                      href={angle.downloadUrl || angle.videoUrl!}
                      download={`${eventName || 'lance'}-${angle.cameraName}.mp4`}
                      style={styles.downloadButton}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      ⬇️ Baixar Vídeo ({angle.cameraName})
                    </a>
                  </div>
                </div>
              ) : (
                <div style={styles.pendingBox}>
                  <p style={styles.pendingText}>O vídeo deste ângulo está sendo processado.</p>
                </div>
              )}
            </article>
          );
        })}
      </section>
    </main>
  );
}
