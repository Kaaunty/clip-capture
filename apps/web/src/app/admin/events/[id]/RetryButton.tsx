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

  const handleRetry = async () => {
    setRetrying(true);
    // Simulate / notify retry trigger
    await new Promise((resolve) => setTimeout(resolve, 600));
    setRetrying(false);
    setRetried(true);
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
        {retrying ? 'Retentando...' : retried ? '✓ Solicitação Enviada' : '🔄 Retentar Upload'}
      </button>
    </div>
  );
}
