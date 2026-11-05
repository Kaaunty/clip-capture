'use client';

import React, { useState } from 'react';
import { Button, cx } from '../../../components/ui';
import s from './ContingencyButton.module.css';

export default function ContingencyButton({ fieldId }: { fieldId: string }) {
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const handleTrigger = async () => {
    setLoading(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/v1/trigger-contingency', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer admin-secret-dev',
        },
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
    <div className={s.wrap}>
      <Button
        variant="danger"
        elevated
        onClick={handleTrigger}
        disabled={loading}
        className={s.trigger}
      >
        <span>🚨</span>
        {loading ? 'Disparando...' : 'Disparar Lance (Contingência Web)'}
      </Button>

      {feedback && (
        <div className={cx(s.feedback, feedback.type === 'success' ? s.success : s.error)}>
          {feedback.message}
        </div>
      )}
    </div>
  );
}
