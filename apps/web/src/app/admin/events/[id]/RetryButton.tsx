'use client';

import React, { useState } from 'react';
import { cx } from '../../../../components/ui';
import s from './RetryButton.module.css';

export default function RetryButton({
  fileId,
  cameraId,
  eventId,
}: {
  fileId?: string;
  cameraId: string;
  eventId: string;
}) {
  const [retrying, setRetrying] = useState(false);
  const [retried, setRetried] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRetry = async () => {
    setRetrying(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/events/${eventId}/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId, cameraId }),
      });
      if (res.ok) {
        setRetried(true);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Falha ao retentar');
      }
    } catch (err: any) {
      setError(err.message || 'Erro de rede');
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div>
      <button
        onClick={handleRetry}
        disabled={retrying}
        className={cx(s.retry, retrying && s.retryBusy)}
      >
        {retrying ? 'Retentando...' : retried ? '✓ Retentativa Agendada' : '🔄 Retentar Upload'}
      </button>
      {error && (
        <span className={s.error}>
          {error}
        </span>
      )}
    </div>
  );
}
