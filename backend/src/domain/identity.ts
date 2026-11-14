import { createHash } from 'node:crypto';

export const DEMO_NAMESPACE = '6f1c2a3e-4b5d-4e8f-9a0b-1c2d3e4f5a6b';
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function uuidBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ''), 'hex');
}

function formatUuid(bytes: Buffer): string {
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** UUID v5 (SHA-1) — совпадает с web/src/lib/api/identity.ts для стабильных ссылок. */
export function uuidFromCode(code: string, namespace: string = DEMO_NAMESPACE): string {
  const hash = createHash('sha1').update(uuidBytes(namespace)).update(code, 'utf8').digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return formatUuid(bytes);
}

export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»"„“”]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Название для дедупликации и поиска: нижний регистр, ё→е, без кавычек и знаков препинания. */
export function normalizeTitle(title: string): string {
  return normalizeText(title)
    .replace(/['`’]/g, '')
    .replace(/[.,:;!?()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Ключ дедупликации: normalized_title|YYYY-MM-DD|venue_id. */
export function dedupKey(normalizedTitle: string, localDate: string | null, venueId: string): string {
  return `${normalizedTitle}|${localDate ?? 'без даты'}|${venueId}`;
}

/** Приводит legacy venue ID с подчёркиваниями (ven_ufa_opera) к контрактному slug (ven-ufa-opera). */
export function toVenueSlug(id: string): string {
  return id.toLowerCase().replace(/_/g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'venue-unknown';
}
