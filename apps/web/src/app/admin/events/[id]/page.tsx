import React from 'react';
import Link from 'next/link';
import { prisma } from '../../../../lib/db';
import { statusTone } from '../../../../lib/statusTone';
import { Badge, Card, MetaGrid, MetaItem, Table, Td, Th } from '../../../../components/ui';
import ShareActions from './ShareActions';
import RetryButton from './RetryButton';
import s from './page.module.css';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function AdminEventPage({ params }: PageProps) {
  const resolvedParams = await params;
  const id = resolvedParams.id;

  const event = await prisma.clipEvent.findUnique({
    where: { id },
    include: {
      field: {
        include: {
          cameras: { orderBy: { displayOrder: 'asc' } },
        },
      },
      files: {
        include: {
          camera: true,
        },
      },
      tokens: {
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (!event) {
    return (
      <main className={s.page}>
        <div className={s.notFound}>
          <div className={s.notFoundIcon}>🔍</div>
          <h1 className={s.notFoundTitle}>
            Evento não encontrado
          </h1>
          <p className={s.notFoundText}>
            O identificador de evento fornecido não corresponde a nenhum registro operacional.
          </p>
          <Link href="/admin/fields" className={s.backLink}>
            ← Voltar para Painel de Campos
          </Link>
        </div>
      </main>
    );
  }

  // Build camera angles
  const fieldCameras = event.field?.cameras || [];
  const isProcessing = event.status === 'PROCESSING' || event.status === 'QUEUED';
  const defaultMissingStatus = isProcessing ? 'PENDING' : 'CAMERA_UNAVAILABLE';

  const angles: Array<{
    id: string;
    cameraName: string;
    fileId?: string;
    uploadStatus: string;
    duration?: number;
    storagePath?: string;
    sha256?: string | null;
  }> = [];

  if (fieldCameras.length > 0) {
    for (const cam of fieldCameras) {
      const file = event.files.find((f) => f.cameraId === cam.id);
      angles.push({
        id: cam.id,
        cameraName: cam.name,
        fileId: file?.id,
        uploadStatus: file?.uploadStatus || defaultMissingStatus,
        duration: file?.duration,
        storagePath: file?.storagePath,
        sha256: file?.sha256,
      });
    }
  } else {
    for (const file of event.files) {
      angles.push({
        id: file.cameraId,
        cameraName: file.camera?.name || `Câmera ${file.cameraId}`,
        fileId: file.id,
        uploadStatus: file.uploadStatus,
        duration: file.duration,
        storagePath: file.storagePath,
        sha256: file.sha256,
      });
    }
  }

  return (
    <main className={s.page}>
      <Link href="/admin/fields" className={s.backLink}>
        ← Voltar para Painel de Campos
      </Link>

      <Card as="section" padding={32} className={s.card}>
        <div className={s.headerRow}>
          <div>
            <h1 className={s.title}>Detalhes do Evento: {event.id}</h1>
            <p className={s.fieldName}>
              Campo: <strong>{event.field?.name || event.fieldId}</strong>
            </p>
          </div>
          <div>
            <Badge tone={statusTone(event.status)}>{event.status}</Badge>
          </div>
        </div>

        <MetaGrid minColumn={200} className={s.metaGrid}>
          <MetaItem label="Origem do Disparo">{event.triggerSource}</MetaItem>
          <MetaItem label="Command ID">{event.commandId}</MetaItem>
          <MetaItem label="Data/Hora do Acionamento">
            {new Date(event.triggeredAt || event.createdAt).toLocaleString('pt-BR', {
              timeZone: 'America/Sao_Paulo',
            })}
          </MetaItem>
          <MetaItem label="Ângulos Gravados">{angles.length}</MetaItem>
        </MetaGrid>

        <h2 className={s.sectionTitle}>
          Status dos Ângulos de Câmera
        </h2>

        <Table className={s.table}>
          <thead>
            <tr>
              <Th py={12}>Câmera</Th>
              <Th py={12}>Status de Processamento / Upload</Th>
              <Th py={12}>Duração</Th>
              <Th py={12}>Caminho Storage / Hash</Th>
              <Th py={12}>Ação</Th>
            </tr>
          </thead>
          <tbody>
            {angles.map((angle) => {
              const needsRetry =
                angle.uploadStatus === 'FAILED' ||
                angle.uploadStatus === 'PENDING' ||
                angle.uploadStatus === 'CAMERA_UNAVAILABLE';

              return (
                <tr key={angle.id}>
                  <Td py={14} className={s.tdMiddle}>
                    <strong>{angle.cameraName}</strong>
                  </Td>
                  <Td py={14} className={s.tdMiddle}>
                    <Badge tone={statusTone(angle.uploadStatus)}>
                      {angle.uploadStatus}
                    </Badge>
                  </Td>
                  <Td py={14} className={s.tdMiddle}>
                    {angle.duration ? `${angle.duration.toFixed(1)}s` : '-'}
                  </Td>
                  <Td py={14} className={s.tdMiddle}>
                    {angle.storagePath ? (
                      <code className={s.code}>
                        {angle.storagePath}
                      </code>
                    ) : (
                      <span className={s.notSent}>Não enviado</span>
                    )}
                  </Td>
                  <Td py={14} className={s.tdMiddle}>
                    {needsRetry ? (
                      <RetryButton
                        fileId={angle.fileId}
                        cameraId={angle.id}
                        eventId={event.id}
                      />
                    ) : (
                      <span className={s.done}>
                        ✓ Concluído
                      </span>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>

        <div className={s.shareSection}>
          <h2 className={s.shareTitle}>
            Compartilhamento Público
          </h2>
          <p className={s.shareText}>
            Gere um link temporário com token seguro para visualização externa dos vídeos prontos.
          </p>
          <ShareActions eventId={event.id} initialShareUrl={undefined} />
        </div>
      </Card>
    </main>
  );
}
