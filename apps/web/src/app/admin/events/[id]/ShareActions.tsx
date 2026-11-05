'use client';

import React, { useState } from 'react';
import { cx } from '../../../../components/ui';
import s from './ShareActions.module.css';

interface ShareActionsProps {
  eventId: string;
  initialShareUrl?: string | null;
}

export default function ShareActions({ eventId, initialShareUrl }: ShareActionsProps) {
  const [shareUrl, setShareUrl] = useState<string | null>(initialShareUrl || null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleGenerateShareToken = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/v1/events/${eventId}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (res.ok && (data.shareUrl || data.rawToken)) {
        const url =
          data.shareUrl ||
          `${typeof window !== 'undefined' ? window.location.origin : ''}/share/${data.rawToken}`;
        setShareUrl(url);
        setMessage('Link gerado com sucesso!');
      } else {
        setMessage(data.error || 'Falha ao gerar link de compartilhamento.');
      }
    } catch (err: any) {
      setMessage(err.message || 'Erro de conexão.');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyLink = () => {
    if (shareUrl) {
      navigator.clipboard?.writeText(shareUrl);
      setMessage('Link copiado para a área de transferência!');
    }
  };

  return (
    <div className={s.wrapper}>
      <div className={s.actions}>
        <button
          onClick={handleGenerateShareToken}
          disabled={loading}
          className={cx(s.generate, loading && s.generateBusy)}
        >
          {loading ? 'Gerando...' : '🔗 Gerar Link de Compartilhamento'}
        </button>

        {shareUrl && (
          <button onClick={handleCopyLink} className={s.copy}>
            📋 Copiar Link Público
          </button>
        )}
      </div>

      {shareUrl && (
        <div className={s.urlRow}>
          <span className={s.urlLabel}>Link de visualização pública: </span>
          <a
            href={shareUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={s.url}
          >
            {shareUrl}
          </a>
        </div>
      )}

      {message && (
        <div className={s.message}>
          {message}
        </div>
      )}
    </div>
  );
}
