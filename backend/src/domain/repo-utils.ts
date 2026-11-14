import { createHash } from 'node:crypto';

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function computeEtagFallback(payload: unknown): string {
  return `W/"${createHash('sha1').update(JSON.stringify(payload)).digest('base64url').slice(0, 27)}"`;
}
