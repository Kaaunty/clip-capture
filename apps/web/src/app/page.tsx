import React from 'react';
import Link from 'next/link';
import { prisma } from '../lib/db';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  let fields: any[] = [];
  let recentEvents: any[] = [];
  try {
    fields = await prisma.field.findMany({
      include: {
        cameras: true,
        devices: true,
      },
    });
    recentEvents = await prisma.clipEvent.findMany({
      include: {
        field: true,
        files: true,
        tokens: true,
      },
      orderBy: { triggeredAt: 'desc' },
      take: 5,
    });
  } catch {
    fields = [];
    recentEvents = [];
  }

  return (
    <main
      style={{
        maxWidth: '1100px',
        margin: '0 auto',
        padding: '40px 20px',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        color: '#0f172a',
      }}
    >
      <header
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '16px',
          padding: '32px',
          marginBottom: '32px',
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05)',
          border: '1px solid #e2e8f0',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
          <span style={{ fontSize: '32px' }}>⚽</span>
          <h1 style={{ fontSize: '28px', fontWeight: '800', margin: 0, color: '#0f172a' }}>
            Clip Capture
          </h1>
          <span
            style={{
              backgroundColor: '#dcfce7',
              color: '#15803d',
              padding: '4px 12px',
              borderRadius: '9999px',
              fontSize: '12px',
              fontWeight: '700',
              marginLeft: 'auto',
            }}
          >
            ● Sistema Operacional
          </span>
        </div>
        <p style={{ fontSize: '16px', color: '#64748b', margin: 0, lineHeight: 1.5 }}>
          Gravação contínua em buffer local de alta performance, acionamento por botão físico e replay multi-ângulo instantâneo.
        </p>
      </header>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: '24px',
          marginBottom: '36px',
        }}
      >
        <div
          style={{
            backgroundColor: '#ffffff',
            borderRadius: '14px',
            padding: '24px',
            border: '1px solid #e2e8f0',
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
          }}
        >
          <div style={{ fontSize: '24px', marginBottom: '8px' }}>🏟️</div>
          <h2 style={{ fontSize: '18px', fontWeight: '700', margin: '0 0 8px 0' }}>
            Painel do Operador
          </h2>
          <p style={{ fontSize: '14px', color: '#64748b', margin: '0 0 16px 0', lineHeight: 1.4 }}>
            Monitore o status das câmeras, acione o botão de contingência e visualize os eventos capturados por campo.
          </p>
          <Link
            href="/admin/fields"
            style={{
              display: 'inline-block',
              backgroundColor: '#0284c7',
              color: '#ffffff',
              padding: '10px 18px',
              borderRadius: '8px',
              textDecoration: 'none',
              fontWeight: '600',
              fontSize: '14px',
            }}
          >
            Abrir Painel de Campos →
          </Link>
        </div>

        <div
          style={{
            backgroundColor: '#ffffff',
            borderRadius: '14px',
            padding: '24px',
            border: '1px solid #e2e8f0',
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
          }}
        >
          <div style={{ fontSize: '24px', marginBottom: '8px' }}>⚡</div>
          <h2 style={{ fontSize: '18px', fontWeight: '700', margin: '0 0 8px 0' }}>
            Campos Cadastrados ({fields.length})
          </h2>
          <p style={{ fontSize: '14px', color: '#64748b', margin: '0 0 16px 0', lineHeight: 1.4 }}>
            {fields.length > 0
              ? fields.map((f) => f.name).join(', ')
              : 'Nenhum campo cadastrado ainda.'}
          </p>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {fields.map((f) => (
              <Link
                key={f.id}
                href="/admin/fields"
                style={{
                  fontSize: '13px',
                  color: '#0369a1',
                  backgroundColor: '#f0f9ff',
                  padding: '6px 12px',
                  borderRadius: '6px',
                  textDecoration: 'none',
                  fontWeight: '600',
                  border: '1px solid #bae6fd',
                }}
              >
                {f.name} ({f.cameras.length} câmeras)
              </Link>
            ))}
          </div>
        </div>
      </div>

      <section
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '16px',
          padding: '28px',
          border: '1px solid #e2e8f0',
          boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
        }}
      >
        <h2 style={{ fontSize: '20px', fontWeight: '700', margin: '0 0 16px 0' }}>
          Últimos Lances & Links de Compartilhamento
        </h2>

        {recentEvents.length === 0 ? (
          <div
            style={{
              padding: '32px',
              textAlign: 'center',
              backgroundColor: '#f8fafc',
              borderRadius: '12px',
              color: '#64748b',
            }}
          >
            <p style={{ margin: 0 }}>Nenhum lance gravado ainda.</p>
            <p style={{ margin: '8px 0 0 0', fontSize: '13px' }}>
              Vá ao{' '}
              <Link href="/admin/fields" style={{ color: '#0284c7', fontWeight: '600' }}>
                Painel de Campos
              </Link>{' '}
              e clique em <strong>"Disparar Contingência"</strong> para gravar o primeiro lance!
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {recentEvents.map((evt) => {
              const token = evt.tokens?.[0]?.tokenHash;
              return (
                <div
                  key={evt.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '16px 20px',
                    borderRadius: '10px',
                    backgroundColor: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    flexWrap: 'wrap',
                    gap: '12px',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: '700', fontSize: '15px' }}>
                      {evt.field?.name || 'Campo'} - {new Date(evt.triggeredAt).toLocaleString('pt-BR')}
                    </div>
                    <div style={{ fontSize: '13px', color: '#64748b', marginTop: '4px' }}>
                      Fonte: {evt.triggerSource} | Arquivos: {evt.files?.length || 0} ângulo(s) | Status: {evt.status}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <Link
                      href={`/admin/events/${evt.id}`}
                      style={{
                        fontSize: '13px',
                        padding: '6px 12px',
                        borderRadius: '6px',
                        backgroundColor: '#ffffff',
                        border: '1px solid #cbd5e1',
                        color: '#334155',
                        textDecoration: 'none',
                        fontWeight: '600',
                      }}
                    >
                      Detalhes
                    </Link>
                    {evt.tokens?.[0] && (
                      <Link
                        href={`/share/${evt.tokens[0].tokenHash}`}
                        style={{
                          fontSize: '13px',
                          padding: '6px 12px',
                          borderRadius: '6px',
                          backgroundColor: '#16a34a',
                          color: '#ffffff',
                          textDecoration: 'none',
                          fontWeight: '600',
                        }}
                      >
                        Assistir Replay 🎬
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
