'use client';

import React, { useState } from 'react';

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
        style={{
          padding: '6px 12px',
          fontSize: '12px',
          fontWeight: '600',
          borderRadius: '6px',
          border: '1px solid #cbd5e1',
          backgroundColor: '#ffffff',
          color: '#334155',
          cursor: retrying ? 'not-allowed' : 'pointer',
        }}
      >
        {retrying ? 'Retentando...' : retried ? '✓ Retentativa Agendada' : '🔄 Retentar Upload'}
      </button>
      {error && (
        <span style={{ color: '#dc2626', fontSize: '11px', display: 'block', marginTop: '2px' }}>
          {error}
        </span>
      )}
    </div>
  );
}
