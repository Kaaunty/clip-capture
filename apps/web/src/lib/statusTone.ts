export type StatusTone = 'success' | 'danger' | 'warning' | 'info' | 'neutral';

/**
 * Mapeamento unificado status -> tom. O padrao ('event') reproduz
 * admin/events/[id] getStatusBadgeStyle:
 *   READY, COMPLETED -> success; FAILED, CAMERA_UNAVAILABLE -> danger;
 *   PROCESSING, UPLOADING -> info; demais -> warning.
 *
 * Divergencias historicas entre as 3 telas (preservadas via `context`):
 * - 'fieldList' (admin/fields/page.tsx): so READY/COMPLETED=success e
 *   FAILED=danger; CAMERA_UNAVAILABLE, PROCESSING e UPLOADING caem em warning.
 * - 'angle' (ShareEventView): CAMERA_UNAVAILABLE=danger, READY=success,
 *   o resto (incl. FAILED, PROCESSING) = warning. Obs.: la "READY" so e
 *   success se houver videoUrl; o chamador deve passar status 'PENDING'
 *   (ou similar) quando !videoUrl. COMPLETED/FAILED nao existem por angulo.
 */
export function statusTone(
  status: string,
  context: 'event' | 'fieldList' | 'angle' = 'event',
): StatusTone {
  if (context === 'angle') {
    if (status === 'CAMERA_UNAVAILABLE') return 'danger';
    if (status === 'READY') return 'success';
    return 'warning';
  }
  if (status === 'READY' || status === 'COMPLETED') return 'success';
  if (status === 'FAILED') return 'danger';
  if (context === 'fieldList') return 'warning';
  if (status === 'CAMERA_UNAVAILABLE') return 'danger';
  if (status === 'PROCESSING' || status === 'UPLOADING') return 'info';
  return 'warning';
}
