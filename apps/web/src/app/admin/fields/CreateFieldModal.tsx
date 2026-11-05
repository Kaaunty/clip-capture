'use client';

import React, { useState } from 'react';
import { Alert, Button, Field, Input, Modal } from '../../../components/ui';
import s from './CreateFieldModal.module.css';

export default function CreateFieldModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState('');
  const [secondsBefore, setSecondsBefore] = useState(15);
  const [secondsAfter, setSecondsAfter] = useState(10);
  const [cameras, setCameras] = useState([
    { name: 'Câmera Lateral', rtspUrl: '' },
    { name: 'Câmera Gol Norte', rtspUrl: '' },
  ]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addCamera = () => {
    setCameras([...cameras, { name: `Câmera ${cameras.length + 1}`, rtspUrl: '' }]);
  };

  const updateCamera = (index: number, field: string, value: string) => {
    const updated = [...cameras];
    updated[index] = { ...updated[index], [field]: value };
    setCameras(updated);
  };

  const removeCamera = (index: number) => {
    setCameras(cameras.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Por favor, informe o nome do campo.');
      return;
    }
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/v1/fields', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          secondsBefore: Number(secondsBefore),
          secondsAfter: Number(secondsAfter),
          cameras: cameras.filter((c) => c.rtspUrl.trim() !== ''),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Erro ao cadastrar campo');
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
      <Button onClick={() => setIsOpen(true)} className={s.flush}>
        <span>➕</span> Cadastrar Novo Campo
      </Button>

      <Modal
        open={isOpen}
        onClose={() => setIsOpen(false)}
        title="Cadastrar Campo & Câmeras RTSP"
        maxWidth={560}
      >
        {error && <Alert className={s.errBox}>{error}</Alert>}

        <form onSubmit={handleSubmit}>
          <Field label="Nome do Campo *">
            <Input
              type="text"
              placeholder="ex: Campo Principal (Society)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </Field>

          <div className={s.row}>
            <Field label="Segundos Antes" className={s.half}>
              <Input
                type="number"
                min="1"
                max="60"
                value={secondsBefore}
                onChange={(e) => setSecondsBefore(Number(e.target.value))}
              />
            </Field>
            <Field label="Segundos Depois" className={s.half}>
              <Input
                type="number"
                min="1"
                max="60"
                value={secondsAfter}
                onChange={(e) => setSecondsAfter(Number(e.target.value))}
              />
            </Field>
          </div>

          <div className={s.camSection}>
            <div className={s.camHead}>
              <label className={s.camLabel}>Câmeras RTSP Reais</label>
              <button type="button" onClick={addCamera} className={s.addAngle}>
                + Adicionar Ângulo
              </button>
            </div>

            <div className={s.camList}>
              {cameras.map((cam, idx) => (
                <div key={idx} className={s.camRow}>
                  <input
                    type="text"
                    placeholder="Nome (ex: Lateral)"
                    value={cam.name}
                    onChange={(e) => updateCamera(idx, 'name', e.target.value)}
                    className={s.camNameInput}
                  />
                  <input
                    type="text"
                    placeholder="URL RTSP (ex: rtsp://admin:senha@192.168.1.101:554/stream1)"
                    value={cam.rtspUrl}
                    onChange={(e) => updateCamera(idx, 'rtspUrl', e.target.value)}
                    className={s.camUrlInput}
                  />
                  {cameras.length > 1 && (
                    <button type="button" onClick={() => removeCamera(idx)} className={s.removeCam}>
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className={s.footer}>
            <button type="button" onClick={() => setIsOpen(false)} className={s.cancelBtn}>
              Cancelar
            </button>
            <Button type="submit" disabled={loading} className={s.flush}>
              {loading ? 'Salvando...' : 'Salvar e Cadastrar'}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
