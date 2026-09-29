/**
 * Utility functions for Admin Fields dashboard
 */

export function sanitizeRtspUrl(url: string): string {
  if (!url) return '';
  if (/rtsp:\/\/[^:@]+:[^@]+@/i.test(url)) {
    return url.replace(/rtsp:\/\/[^:@]+:[^@]+@/i, 'rtsp://***:***@');
  }
  if (/rtsp:\/\/[^@]+@/i.test(url)) {
    return url.replace(/rtsp:\/\/[^@]+@/i, 'rtsp://***@');
  }
  return url;
}
