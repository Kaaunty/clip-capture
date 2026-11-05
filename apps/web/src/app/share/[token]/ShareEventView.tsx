'use client';

import React from 'react';
import styles from './ShareEventView.module.css';

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
      <div className={styles.container}>
        <div className={styles.card}>
          <div className={styles.errorIcon}>⚠️</div>
          <h1 className={styles.errorTitle}>{error}</h1>
          <p className={styles.errorText}>
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
    <main className={styles.container}>
      <header className={styles.header}>
        <div className={styles.badgeRow}>
          <span className={styles.pillBadge}>Clip Capture</span>
          {fieldName && <span className={styles.fieldBadge}>{fieldName}</span>}
        </div>
        <h1 className={styles.title}>{eventName || 'Lance Gravado'}</h1>
        {date && <p className={styles.date}>{date}</p>}

        <div className={styles.actionRow}>
          <a
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.whatsappButton}
          >
            <span className={styles.whatsappIcon}>💬</span>
            Compartilhar no WhatsApp
          </a>
        </div>
      </header>

      <section className={styles.anglesGrid}>
        {angles.map((angle) => {
          const isUnavailable = angle.status === 'CAMERA_UNAVAILABLE';
          const isReady = angle.status === 'READY' && !!angle.videoUrl;

          return (
            <article key={angle.id} className={styles.angleCard}>
              <div className={styles.angleHeader}>
                <h2 className={styles.cameraName}>{angle.cameraName}</h2>
                {isUnavailable ? (
                  <span className={styles.unavailableBadge}>Câmera Indisponível</span>
                ) : isReady ? (
                  <span className={styles.readyBadge}>Pronto</span>
                ) : (
                  <span className={styles.pendingBadge}>Processando</span>
                )}
              </div>

              {isUnavailable ? (
                <div className={styles.unavailableBox}>
                  <p className={styles.unavailableText}>
                    Esta câmera estava temporariamente indisponível no momento do lance.
                  </p>
                </div>
              ) : isReady ? (
                <div className={styles.videoWrapper}>
                  <video
                    controls
                    preload="metadata"
                    playsInline
                    src={angle.videoUrl!}
                    className={styles.videoPlayer}
                  >
                    Seu navegador não suporta a reprodução de vídeo.
                  </video>
                  <div className={styles.downloadRow}>
                    <a
                      href={angle.downloadUrl || angle.videoUrl!}
                      download={`${eventName || 'lance'}-${angle.cameraName}.mp4`}
                      className={styles.downloadButton}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      ⬇️ Baixar Vídeo ({angle.cameraName})
                    </a>
                  </div>
                </div>
              ) : (
                <div className={styles.pendingBox}>
                  <p className={styles.pendingText}>O vídeo deste ângulo está sendo processado.</p>
                </div>
              )}
            </article>
          );
        })}
      </section>
    </main>
  );
}
