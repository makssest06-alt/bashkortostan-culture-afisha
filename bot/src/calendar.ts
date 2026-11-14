/**
 * Сборка .ics для одного сеанса.
 *
 * Время в API приходит с местным смещением (`+05:00`). В календарь пишем UTC:
 * так Google Calendar и Apple Calendar одинаково понимают событие, а сервер
 * бота может работать в любой таймзоне.
 */

import type { Event, Occurrence } from './api/types.js';
import { AFISHA_TIME_ZONE } from './search-options.js';
import { telegramSafeHttpUrl, truncate } from './format.js';

const CRLF = '\r\n';
const MAX_LINE_OCTETS = 75;
const DEFAULT_DURATION_MS = 2 * 60 * 60 * 1000;

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;
const HAS_OFFSET_RE = /(Z|[+-]\d{2}:?\d{2})$/i;

function parseAfishaDate(value: string): Date | null {
  const normalized = HAS_OFFSET_RE.test(value) ? value : `${value}+05:00`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** `20261120T140000Z` */
export function toIcsUtc(value: Date): string {
  return (
    `${value.getUTCFullYear()}${pad(value.getUTCMonth() + 1)}${pad(value.getUTCDate())}` +
    `T${pad(value.getUTCHours())}${pad(value.getUTCMinutes())}${pad(value.getUTCSeconds())}Z`
  );
}

function addIsoDays(value: string, days: number): string {
  const match = ISO_DATE_RE.exec(value);
  if (!match) return value;
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days),
  );
  return date.toISOString().slice(0, 10);
}

function icsDate(value: string): string {
  return value.slice(0, 10).replace(/-/g, '');
}

/** Экранирование текстовых значений по RFC 5545. */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

/** Складывает строку по 75 октетов; продолжение начинается с пробела. */
export function foldIcsLine(line: string): string {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= MAX_LINE_OCTETS) return line;

  const parts: string[] = [];
  let start = 0;
  let limit = MAX_LINE_OCTETS;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Не разрываем многобайтовый символ.
    while (end > start && end < bytes.length && (bytes[end]! & 0xc0) === 0x80) {
      end -= 1;
    }
    const chunk = bytes.subarray(start, end).toString('utf8');
    parts.push(start === 0 ? chunk : ` ${chunk}`);
    start = end;
    limit = MAX_LINE_OCTETS - 1;
  }
  return parts.join(CRLF);
}

function calendarEnd(
  event: Event,
  occurrence: Occurrence,
  start: Date,
): Date {
  if (occurrence.date_end) {
    const parsed = parseAfishaDate(occurrence.date_end);
    if (parsed && parsed.getTime() > start.getTime()) return parsed;
  }
  const duration = (event.duration_min ?? 0) * 60_000;
  return new Date(start.getTime() + (duration > 0 ? duration : DEFAULT_DURATION_MS));
}

function calendarUrl(event: Event): string | null {
  if (event.synthetic) return null;
  return telegramSafeHttpUrl(event.source_url) ?? telegramSafeHttpUrl(event.org_link);
}

export interface CalendarOptions {
  now?: Date;
  /** Домен для UID. По умолчанию afisha-rb.ru. */
  uidDomain?: string;
}

/**
 * .ics одного сеанса. Если сеанс отменён, файл всё равно валиден, но
 * содержит STATUS:CANCELLED; бот решает, отправлять ли его пользователю.
 */
export function buildEventIcs(
  event: Event,
  occurrence: Occurrence,
  options: CalendarOptions = {},
): string {
  const now = options.now ?? new Date();
  const uidDomain = options.uidDomain ?? 'afisha-rb.ru';
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//Afisha Bashkortostan//Telegram bot//${AFISHA_TIME_ZONE}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${escapeIcsText(event.id)}-${escapeIcsText(occurrence.id)}@${uidDomain}`,
    `DTSTAMP:${toIcsUtc(now)}`,
  ];

  if (occurrence.time_precision === 'date') {
    const startDate = occurrence.date_start.slice(0, 10);
    const endDate = occurrence.date_end?.slice(0, 10) ?? startDate;
    lines.push(`DTSTART;VALUE=DATE:${icsDate(startDate)}`);
    lines.push(`DTEND;VALUE=DATE:${icsDate(addIsoDays(endDate, 1))}`);
  } else {
    const start = parseAfishaDate(occurrence.date_start);
    if (!start) throw new Error('Некорректная дата начала сеанса');
    const end = calendarEnd(event, occurrence, start);
    lines.push(`DTSTART:${toIcsUtc(start)}`);
    lines.push(`DTEND:${toIcsUtc(end)}`);
  }

  lines.push(`SUMMARY:${escapeIcsText(event.title)}`);

  const description: string[] = [];
  if (event.description.trim()) description.push(event.description.trim());
  if (event.organizer) description.push(`Организатор: ${event.organizer}`);
  if (event.age_limit !== null) description.push(`Возраст: ${event.age_limit}+`);
  if (event.price_min !== null || event.price_max !== null) {
    const price =
      event.price_min !== null && event.price_max !== null
        ? `${event.price_min}–${event.price_max} ₽`
        : event.price_min !== null
          ? `от ${event.price_min} ₽`
          : `до ${event.price_max} ₽`;
    description.push(`Цена: ${price}`);
  }
  if (description.length > 0) {
    lines.push(`DESCRIPTION:${escapeIcsText(description.join('\n\n'))}`);
  }

  const location = [event.venue, event.city, event.address].filter(Boolean).join(', ');
  if (location) lines.push(`LOCATION:${escapeIcsText(location)}`);

  const url = calendarUrl(event);
  if (url) lines.push(`URL:${url}`);
  if (occurrence.status === 'cancelled' || event.status === 'cancelled') {
    lines.push('STATUS:CANCELLED');
  } else {
    lines.push('STATUS:CONFIRMED');
  }
  lines.push('END:VEVENT', 'END:VCALENDAR');

  return lines.map(foldIcsLine).join(CRLF) + CRLF;
}

export function calendarFileName(event: Event): string {
  const safe = event.id.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 12) || 'event';
  return `afisha-${safe}.ics`;
}

export function calendarCaption(event: Event, occurrence: Occurrence): string {
  const status = occurrence.status === 'cancelled' || event.status === 'cancelled' ? ' (отменён)' : '';
  return `📅 ${truncate(event.title, 900)}${status}`;
}
