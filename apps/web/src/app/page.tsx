import React from 'react';
import Link from 'next/link';
import { prisma } from '../lib/db';
import styles from './page.module.css';

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
    <main className={styles.main}>
      <header className={styles.header}>
        <div className={styles.headerTop}>
          <span className={styles.logo}>⚽</span>
          <h1 className={styles.title}>Clip Capture</h1>
          <span className={styles.statusBadge}>● Sistema Operacional</span>
        </div>
        <p className={styles.subtitle}>
          Gravação contínua em buffer local de alta performance, acionamento por botão físico e replay multi-ângulo instantâneo.
        </p>
      </header>

      <div className={styles.grid}>
        <div className={styles.card}>
          <div className={styles.cardIcon}>🏟️</div>
          <h2 className={styles.cardTitle}>Painel do Operador</h2>
          <p className={styles.cardText}>
            Monitore o status das câmeras, acione o botão de contingência e visualize os eventos capturados por campo.
          </p>
          <Link href="/admin/fields" className={styles.primaryLink}>
            Abrir Painel de Campos →
          </Link>
        </div>

        <div className={styles.card}>
          <div className={styles.cardIcon}>⚡</div>
          <h2 className={styles.cardTitle}>Campos Cadastrados ({fields.length})</h2>
          <p className={styles.cardText}>
            {fields.length > 0
              ? fields.map((f) => f.name).join(', ')
              : 'Nenhum campo cadastrado ainda.'}
          </p>
          <div className={styles.chipRow}>
            {fields.map((f) => (
              <Link key={f.id} href="/admin/fields" className={styles.chip}>
                {f.name} ({f.cameras.length} câmeras)
              </Link>
            ))}
          </div>
        </div>
      </div>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Últimos Lances & Links de Compartilhamento</h2>

        {recentEvents.length === 0 ? (
          <div className={styles.emptyState}>
            <p className={styles.emptyText}>Nenhum lance gravado ainda.</p>
            <p className={styles.emptyHint}>
              Vá ao{' '}
              <Link href="/admin/fields" className={styles.emptyLink}>
                Painel de Campos
              </Link>{' '}
              e clique em <strong>"Disparar Contingência"</strong> para gravar o primeiro lance!
            </p>
          </div>
        ) : (
          <div className={styles.eventList}>
            {recentEvents.map((evt) => {
              const token = evt.tokens?.[0]?.tokenHash;
              return (
                <div key={evt.id} className={styles.eventRow}>
                  <div>
                    <div className={styles.eventTitle}>
                      {evt.field?.name || 'Campo'} - {new Date(evt.triggeredAt).toLocaleString('pt-BR')}
                    </div>
                    <div className={styles.eventMeta}>
                      Fonte: {evt.triggerSource} | Arquivos: {evt.files?.length || 0} ângulo(s) | Status: {evt.status}
                    </div>
                  </div>
                  <div className={styles.eventActions}>
                    <Link href={`/admin/events/${evt.id}`} className={styles.detailsLink}>
                      Detalhes
                    </Link>
                    {evt.tokens?.[0] && (
                      <Link href={`/share/${evt.tokens[0].tokenHash}`} className={styles.replayLink}>
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
