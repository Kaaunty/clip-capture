'use client';

import React, { useState } from 'react';

interface ShareActionsProps {
  eventId: string;
  initialToken?: string | null;
}

export default function ShareActions({ eventId, initialToken }: ShareActionsProps) {
  const [token, setToken] = useState<string | null>(initialToken || null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const baseUrl =
    typeof window !== 'undefined'
      ? window.location.origin
      : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

  const shareUrl = token ? `${baseUrl}/share/${token}` : null;

  const handleGenerateShareToken = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/v1/events/${eventId}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (res.ok && data.token) {
        setToken(data.token);
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
    <div style={{ marginTop: '16px' }}>
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          onClick={handleGenerateShareToken}
          disabled={loading}
          style={{
            backgroundColor: '#0284c7',
            color: '#ffffff',
            padding: '10px 18px',
            borderRadius: '8px',
            border: 'none',
            fontSize: '14px',
            fontWeight: '600',
            cursor: loading ? 'not-allowed' : 'pointer',
            boxShadow: '0 2px 4px rgba(2, 132, 199, 0.25)',
          }}
        >
          {loading ? 'Gerando...' : '🔗 Gerar Link de Compartilhamento'}
        </button>

        {shareUrl && (
          <button
            onClick={handleCopyLink}
            style={{
              backgroundColor: '#f1f5f9',
              color: '#334155',
              padding: '10px 18px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              fontSize: '14px',
              fontWeight: '600',
              cursor: 'pointer',
            }}
          >
            📋 Copiar Link Público
          </button>
        )}
      </div>

      {shareUrl && (
        <div style={{ marginTop: '12px' }}>
          <span style={{ fontSize: '13px', color: '#64748b' }}>Link de visualização pública: </span>
          <a
            href={shareUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: '14px', color: '#0284c7', fontWeight: '600', wordBreak: 'break-all' }}
          >
            {shareUrl}
          </a>
        </div>
      )}

      {message && (
        <div style={{ marginTop: '8px', fontSize: '13px', color: '#15803d', fontWeight: '500' }}>
          {message}
        </div>
      )}
    </div>
  );
}
