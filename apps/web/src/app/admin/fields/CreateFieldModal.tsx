'use client';

import React, { useState } from 'react';

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
      <button
        onClick={() => setIsOpen(true)}
        style={{
          backgroundColor: '#0284c7',
          color: '#ffffff',
          border: 'none',
          padding: '10px 18px',
          borderRadius: '8px',
          fontWeight: '600',
          fontSize: '14px',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
        }}
      >
        <span>➕</span> Cadastrar Novo Campo
      </button>

      {isOpen && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '20px',
          }}
        >
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '16px',
              padding: '28px',
              maxWidth: '560px',
              width: '100%',
              maxHeight: '90vh',
              overflowY: 'auto',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '20px',
              }}
            >
              <h2 style={{ fontSize: '20px', fontWeight: '700', margin: 0, color: '#0f172a' }}>
                Cadastrar Campo & Câmeras RTSP
              </h2>
              <button
                onClick={() => setIsOpen(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '20px',
                  cursor: 'pointer',
                  color: '#64748b',
                }}
              >
                ✕
              </button>
            </div>

            {error && (
              <div
                style={{
                  backgroundColor: '#fee2e2',
                  color: '#b91c1c',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  marginBottom: '16px',
                }}
              >
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit}>
              <div style={{ marginBottom: '16px' }}>
                <label
                  style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '6px', color: '#334155' }}
                >
                  Nome do Campo *
                </label>
                <input
                  type="text"
                  placeholder="ex: Campo Principal (Society)"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '14px',
                    boxSizing: 'border-box',
                  }}
                  required
                />
              </div>

              <div style={{ display: 'flex', gap: '16px', marginBottom: '20px' }}>
                <div style={{ flex: 1 }}>
                  <label
                    style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '6px', color: '#334155' }}
                  >
                    Segundos Antes
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="60"
                    value={secondsBefore}
                    onChange={(e) => setSecondsBefore(Number(e.target.value))}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      borderRadius: '8px',
                      border: '1px solid #cbd5e1',
                      fontSize: '14px',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label
                    style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '6px', color: '#334155' }}
                  >
                    Segundos Depois
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="60"
                    value={secondsAfter}
                    onChange={(e) => setSecondsAfter(Number(e.target.value))}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      borderRadius: '8px',
                      border: '1px solid #cbd5e1',
                      fontSize: '14px',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              </div>

              <div style={{ marginBottom: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <label style={{ fontSize: '13px', fontWeight: '600', color: '#334155' }}>
                    Câmeras RTSP Reais
                  </label>
                  <button
                    type="button"
                    onClick={addCamera}
                    style={{
                      backgroundColor: '#f1f5f9',
                      border: '1px solid #cbd5e1',
                      borderRadius: '6px',
                      padding: '4px 10px',
                      fontSize: '12px',
                      fontWeight: '600',
                      cursor: 'pointer',
                      color: '#475569',
                    }}
                  >
                    + Adicionar Ângulo
                  </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {cameras.map((cam, idx) => (
                    <div
                      key={idx}
                      style={{
                        display: 'flex',
                        gap: '8px',
                        alignItems: 'center',
                        backgroundColor: '#f8fafc',
                        padding: '10px',
                        borderRadius: '8px',
                        border: '1px solid #e2e8f0',
                      }}
                    >
                      <input
                        type="text"
                        placeholder="Nome (ex: Lateral)"
                        value={cam.name}
                        onChange={(e) => updateCamera(idx, 'name', e.target.value)}
                        style={{
                          width: '140px',
                          padding: '8px',
                          borderRadius: '6px',
                          border: '1px solid #cbd5e1',
                          fontSize: '13px',
                        }}
                      />
                      <input
                        type="text"
                        placeholder="URL RTSP (ex: rtsp://admin:senha@192.168.1.101:554/stream1)"
                        value={cam.rtspUrl}
                        onChange={(e) => updateCamera(idx, 'rtspUrl', e.target.value)}
                        style={{
                          flex: 1,
                          padding: '8px',
                          borderRadius: '6px',
                          border: '1px solid #cbd5e1',
                          fontSize: '13px',
                        }}
                      />
                      {cameras.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeCamera(idx)}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#ef4444',
                            cursor: 'pointer',
                            padding: '4px 8px',
                            fontSize: '14px',
                          }}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  style={{
                    backgroundColor: '#ffffff',
                    border: '1px solid #cbd5e1',
                    padding: '10px 16px',
                    borderRadius: '8px',
                    fontSize: '14px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    color: '#475569',
                  }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  style={{
                    backgroundColor: '#0284c7',
                    color: '#ffffff',
                    border: 'none',
                    padding: '10px 18px',
                    borderRadius: '8px',
                    fontSize: '14px',
                    fontWeight: '600',
                    cursor: loading ? 'not-allowed' : 'pointer',
                    opacity: loading ? 0.7 : 1,
                  }}
                >
                  {loading ? 'Salvando...' : 'Salvar e Cadastrar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
