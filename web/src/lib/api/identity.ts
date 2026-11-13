/**
 * Поля идентичности события по п. 8.1 ТЗ: UUID, нормализованное название,
 * ключ дедупликации и хеш исходной записи. Только для сервера: нужен node:crypto.
 */

import { createHash } from 'node:crypto';

import { normalizeText } from './text';
import type { AgeLimit, AgeRating, TimeValue } from './types';

/** Пространство имён для UUID демо-событий (UUID v5 от кода записи). */
const DEMO_NAMESPACE = '6f1c2a3e-4b5d-4e8f-9a0b-1c2d3e4f5a6b';

function uuidBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ''), 'hex');
}

function formatUuid(bytes: Buffer): string {
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** UUID v5: один и тот же код всегда даёт один и тот же UUID, поэтому ссылки на события стабильны. */
export function uuidFromCode(code: string, namespace: string = DEMO_NAMESPACE): string {
  const hash = createHash('sha1').update(uuidBytes(namespace)).update(code, 'utf8').digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return formatUuid(bytes);
}

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** Название для дедупликации и поиска: нижний регистр, ё→е, без кавычек и лишних пробелов и знаков. */
export function normalizeTitle(title: string): string {
  return normalizeText(title)
    .replace(/['`’]/g, '')
    .replace(/[.,:;!?()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Ключ дедупликации п. 6.5: нормализованное название, местная дата начала и площадка. */
export function dedupKey(normalizedTitle: string, localDate: string | null, venueId: string): string {
  return `${normalizedTitle}|${localDate ?? 'без даты'}|${venueId}`;
}

/** Метку «6+» в число п. 8.1 и обратно. */
export function ageLimitOf(rating: AgeRating | null): AgeLimit | null {
  if (rating === null) return null;
  return Number.parseInt(rating, 10) as AgeLimit;
}

export function ageRatingOf(limit: AgeLimit | null): AgeRating | null {
  return limit === null ? null : (`${limit}+` as AgeRating);
}

/**
 * Начало или конец сеанса как date-time п. 8.1. Если известна только дата,
 * ставится местная полночь, а time_precision = date говорит, что время неизвестно.
 */
export function timestampOf(value: TimeValue): string {
  return value.precision === 'minute' ? value.local : `${value.local}T00:00:00+05:00`;
}
