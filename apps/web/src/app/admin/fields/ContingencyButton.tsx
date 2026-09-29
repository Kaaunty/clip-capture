'use client';

import React, { useState } from 'react';

export default function ContingencyButton({ fieldId }: { fieldId: string }) {
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const handleTrigger = async () => {
    setLoading(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/v1/trigger-contingency', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fieldId, triggerSource: 'WEB_INTERFACE' }),
      });
      const data = await res.json();
      if (res.ok && data.status === 'ACCEPTED') {
        setFeedback({
          type: 'success',
          message: `Disparo aceito com sucesso! ID do evento: ${data.event_id}`,
        });
      } else {
        setFeedback({
          type: 'error',
          message: data.error || 'Falha ao acionar contingência.',
        });
      }
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err.message || 'Erro de rede ao conectar com a API.',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ marginTop: '12px' }}>
      <button
        onClick={handleTrigger}
        disabled={loading}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          backgroundColor: '#dc2626',
          color: '#ffffff',
          fontWeight: '600',
          fontSize: '14px',
          padding: '10px 18px',
          borderRadius: '8px',
          border: 'none',
          cursor: loading ? 'not-allowed' : 'pointer',
          opacity: loading ? 0.7 : 1,
          boxShadow: '0 2px 4px rgba(220, 38, 38, 0.25)',
          transition: 'all 0.2s',
        }}
      >
        <span style={{ marginRight: '6px' }}>🚨</span>
        {loading ? 'Disparando...' : 'Disparar Lance (Contingência Web)'}
      </button>

      {feedback && (
        <div
          style={{
            marginTop: '8px',
            fontSize: '13px',
            fontWeight: '500',
            color: feedback.type === 'success' ? '#15803d' : '#b91c1c',
          }}
        >
          {feedback.message}
        </div>
      )}
    </div>
  );
}
