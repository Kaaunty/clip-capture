'use client';

import React, { useState } from 'react';
import { Alert, Field, Input, Modal } from '../../../components/ui';
import s from './AddCameraModal.module.css';

export default function AddCameraModal({ fieldId }: { fieldId: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState('');
  const [rtspUrl, setRtspUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Informe o nome da câmera.');
      return;
    }
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/v1/fields/${fieldId}/cameras`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), rtspUrl: rtspUrl.trim() }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Erro ao adicionar câmera');
      }

      setIsOpen(false);
      window.location.reload();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button onClick={() => setIsOpen(true)} className={s.trigger}>
        <span>📷</span> + Adicionar Câmera
      </button>

      <Modal
        open={isOpen}
        onClose={() => setIsOpen(false)}
        title="Vincular Câmera RTSP"
        size="sm"
        maxWidth={460}
        scroll={false}
      >
        {error && <Alert className={s.errBox}>{error}</Alert>}

        <form onSubmit={handleSubmit}>
          <Field label="Nome do Ângulo *" spacing="sm">
            <Input
              size="sm"
              type="text"
              placeholder="ex: Câmera Lateral ou Gol Norte"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </Field>

          <Field
            label="URL do Stream RTSP"
            hint="As credenciais serão mascaradas no painel para sua segurança."
            className={s.lastField}
          >
            <Input
              size="sm"
              type="text"
              placeholder="rtsp://admin:senha@192.168.1.100:554/stream1"
              value={rtspUrl}
              onChange={(e) => setRtspUrl(e.target.value)}
            />
          </Field>

          <div className={s.footer}>
            <button type="button" onClick={() => setIsOpen(false)} className={s.cancelBtn}>
              Cancelar
            </button>
            <button type="submit" disabled={loading} className={s.submitBtn}>
              {loading ? 'Adicionando...' : 'Adicionar Câmera'}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
