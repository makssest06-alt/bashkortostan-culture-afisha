import {
  categoryName,
  categoryNameOne,
  cityName,
  datePresetLabel,
  type CategoryId,
  type CityId,
  type DatePreset,
} from './dictionaries.js';
import type { Event, EventListItem, Occurrence, Subscription } from './api/types.js';

const MONTHS_GENITIVE = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
] as const;

const WEEKDAYS_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'] as const;

export interface DateParts {
  year: number;
  month: number;
  day: number;
}

function parseDateParts(value: string | null | undefined): DateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? '');
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

function sameDate(a: DateParts, b: DateParts): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

function weekday(date: DateParts): string {
  const index = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
  return WEEKDAYS_SHORT[index] ?? '';
}

function yearSuffix(date: DateParts, now: Date): string {
  return date.year === now.getFullYear() ? '' : ` ${date.year}`;
}

export function formatDate(value: string | null | undefined, now: Date = new Date()): string {
  const date = parseDateParts(value);
  if (!date) return 'дата уточняется';
  return `${date.day} ${MONTHS_GENITIVE[date.month - 1] ?? ''}${yearSuffix(date, now)}`;
}

export function formatDateWithWeekday(value: string | null | undefined, now: Date = new Date()): string {
  const date = parseDateParts(value);
  if (!date) return 'дата уточняется';
  return `${formatDate(value, now)}, ${weekday(date)}`;
}

export function formatDateRange(
  startValue: string | null | undefined,
  endValue: string | null | undefined,
  now: Date = new Date(),
): string {
  const start = parseDateParts(startValue);
  const end = parseDateParts(endValue);
  if (!start) return 'дата уточняется';
  if (!end || sameDate(start, end)) return formatDateWithWeekday(startValue, now);

  if (start.year === end.year && start.month === end.month) {
    return `${start.day}–${end.day} ${MONTHS_GENITIVE[start.month - 1] ?? ''}${yearSuffix(start, now)}, ${weekday(start)}–${weekday(end)}`;
  }

  return `${formatDateWithWeekday(startValue, now)} – ${formatDateWithWeekday(endValue, now)}`;
}

function timePart(value: string | null | undefined): string | null {
  const match = /T(\d{2}):(\d{2})/.exec(value ?? '');
  if (!match) return null;
  return `${match[1]}:${match[2]}`;
}

export function formatOccurrence(occurrence: Occurrence, now: Date = new Date()): string {
  const date = formatDateRange(occurrence.date_start, occurrence.date_end, now);
  if (occurrence.time_precision === 'date') return `${date} · в течение дня`;
  const time = timePart(occurrence.date_start);
  return time ? `${date}, ${time}` : date;
}

export function pickPrimaryOccurrence(event: Event | EventListItem): Occurrence | null {
  if (event.occurrences.length === 0) return null;

  const primaryId =
    'primary_occurrence_id' in event && typeof event.primary_occurrence_id === 'string'
      ? event.primary_occurrence_id
      : null;
  if (primaryId) {
    const matched = event.occurrences.find((occurrence) => occurrence.id === primaryId);
    if (matched) return matched;
  }

  const future = event.occurrences
    .filter((occurrence) => !occurrence.is_past)
    .sort((a, b) => a.date_start.localeCompare(b.date_start));
  return future[0] ?? event.occurrences[0] ?? null;
}

export function formatEventWhen(event: Event | EventListItem, now: Date = new Date()): string {
  const occurrence = pickPrimaryOccurrence(event);
  if (occurrence) return formatOccurrence(occurrence, now);
  if (event.date_start) {
    const range = formatDateRange(event.date_start, event.date_end, now);
    const time = event.time_precision === 'date' ? null : timePart(event.date_start);
    return time ? `${range}, ${time}` : range;
  }
  return 'дата уточняется';
}

export function formatPrice(
  priceMin: number | null,
  priceMax: number | null,
  isFree: boolean,
): string {
  if (isFree) return 'Бесплатно';
  if (priceMin === null && priceMax === null) return 'Цена не указана';

  if (priceMin !== null && priceMax !== null) {
    if (priceMin === priceMax) return formatRubles(priceMin);
    return `${formatRubles(priceMin)}–${formatRubles(priceMax)}`;
  }
  if (priceMin !== null) return `от ${formatRubles(priceMin)}`;
  return `до ${formatRubles(priceMax as number)}`;
}

export function formatRubles(value: number): string {
  const rounded = Math.round(value);
  const grouped = String(Math.abs(rounded)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0');
  const sign = rounded < 0 ? '−' : '';
  return `${sign}${grouped}\u00A0₽`;
}

export function formatAge(ageLimit: number | null | undefined): string {
  return ageLimit === null || ageLimit === undefined ? 'Возраст не указан' : `${ageLimit}+`;
}

export function formatDuration(minutes: number | null | undefined): string | null {
  if (minutes === null || minutes === undefined || minutes <= 0) return null;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} мин`;
  if (rest === 0) return `${hours} ч`;
  return `${hours} ч ${rest} мин`;
}

export function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, Math.max(0, max - 1));
  const lastSpace = cut.lastIndexOf(' ');
  const base = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${base.trimEnd()}…`;
}

export interface SearchFilterState {
  q: string | null;
  city: CityId | null;
  category: CategoryId | null;
  date: DatePreset | null;
}

export function formatFilterLine(filters: SearchFilterState): string {
  const parts: string[] = [];
  if (filters.city) parts.push(`Город: ${cityName(filters.city) ?? filters.city}`);
  if (filters.category) parts.push(`Категория: ${categoryName(filters.category) ?? filters.category}`);
  if (filters.date) parts.push(`Когда: ${datePresetLabel(filters.date) ?? filters.date}`);
  return parts.length > 0 ? parts.join(' · ') : 'Все города и категории';
}

function formatSummaryLines(event: EventListItem, index: number, now: Date): string {
  const city = cityName(event.city_id) ?? event.city;
  const price = formatPrice(event.price_min, event.price_max, event.is_free);
  return [
    `${index}. ${truncate(event.title, 110)}`,
    `   ${formatEventWhen(event, now)} · ${truncate(event.venue, 70)} · ${city}`,
    `   ${price} · ${formatAge(event.age_limit)}`,
  ].join('\n');
}

export function formatSearchResults(
  result: { items: EventListItem[]; total: number; page: number; page_size: number; total_pages: number },
  filters: SearchFilterState,
  options: { now?: Date; queryWasTruncated?: boolean } = {},
): string {
  const now = options.now ?? new Date();
  const lines: string[] = [];
  const query = filters.q ? `«${truncate(filters.q, 80)}»` : null;

  lines.push(`🔎 ${query ? `Поиск ${query}` : 'Афиша'} — найдено ${result.total}`);
  lines.push(formatFilterLine(filters));
  if (options.queryWasTruncated) {
    lines.push('Запрос сокращён до 200 знаков — так требует API.');
  }
  lines.push('');

  result.items.forEach((event, index) => {
    lines.push(
      formatSummaryLines(event, (result.page - 1) * Math.max(1, result.page_size) + index + 1, now),
    );
  });

  if (result.total_pages > 1) {
    lines.push('');
    lines.push(`Страница ${result.page} из ${result.total_pages}`);
  }

  return lines.join('\n');
}

export function formatNoResults(filters: SearchFilterState): string {
  const lines = ['😕 Ничего не нашлось'];
  if (filters.q) lines.push(`Запрос: «${truncate(filters.q, 80)}»`);
  lines.push(formatFilterLine(filters));
  lines.push('');
  lines.push('Попробуйте другой запрос, другой город или уберите фильтры.');
  return lines.join('\n');
}

export function formatEventCard(event: Event | EventListItem, now: Date = new Date()): string {
  const lines: string[] = [];
  const category = categoryNameOne(event.category) ?? 'Событие';

  lines.push(`🎭 ${category}`);
  lines.push(truncate(event.title, 200));
  lines.push('');

  if (event.status === 'cancelled') {
    lines.push('❌ Событие отменено');
  }

  const occurrence = pickPrimaryOccurrence(event);
  if (occurrence?.status === 'cancelled') {
    lines.push('❌ Этот сеанс отменён');
  } else if (occurrence?.status === 'postponed') {
    lines.push('⚠️ Сеанс перенесён, новая дата уточняется');
  } else if (occurrence?.status === 'rescheduled') {
    lines.push('⚠️ Сеанс перенесён на новую дату');
  } else if (occurrence?.status === 'unknown') {
    lines.push('ℹ️ Статус сеанса не подтверждён организатором');
  }

  lines.push(`📅 ${formatEventWhen(event, now)}`);

  const city = cityName(event.city_id) ?? event.city;
  lines.push(`📍 ${city} · ${truncate(event.venue, 120)}`);
  if (event.address) lines.push(`   ${truncate(event.address, 160)}`);

  lines.push(`💰 ${formatPrice(event.price_min, event.price_max, event.is_free)} · ${formatAge(event.age_limit)}`);

  const duration = formatDuration(event.duration_min);
  const extras: string[] = [];
  if (duration) extras.push(`⏱ ${duration}`);
  if (event.language) extras.push(`Язык: ${event.language}`);
  if (extras.length > 0) lines.push(extras.join(' · '));

  if (event.tags.length > 0) {
    lines.push(`🏷 ${event.tags.slice(0, 6).join(', ')}`);
  }
  if (event.organizer) {
    lines.push(`🏛 ${truncate(event.organizer, 120)}`);
  }
  if (event.synthetic) {
    lines.push('🧪 Демонстрационное событие (synthetic)');
  }

  if (event.description.trim()) {
    lines.push('');
    lines.push(truncate(event.description, 700));
  }

  if (event.review?.disputed) {
    lines.push('');
    lines.push('⚠️ Данные события требуют проверки.');
  }

  return lines.join('\n');
}

function subscriptionParts(subscription: Subscription): { city: string; category: string; period: string } {
  return {
    city: subscription.city ? (cityName(subscription.city) ?? subscription.city) : 'Любой город',
    category: subscription.category
      ? (categoryName(subscription.category) ?? subscription.category)
      : 'Все категории',
    period: subscription.period
      ? (datePresetLabel(subscription.period) ?? subscription.period)
      : 'Любой период',
  };
}

export function formatSubscription(subscription: Subscription): string {
  const parts = subscriptionParts(subscription);
  return `${parts.category} · ${parts.city} · ${parts.period}`;
}

export function formatSubscriptionsList(subscriptions: Subscription[]): string {
  if (subscriptions.length === 0) {
    return [
      '🔔 Подписок пока нет.',
      '',
      'Оформите подписку на город, категорию или период — она сохранится в сервисе.',
    ].join('\n');
  }

  const lines = [`🔔 Ваши подписки (${subscriptions.length})`, ''];
  subscriptions.slice(0, 20).forEach((subscription, index) => {
    lines.push(`${index + 1}. ${formatSubscription(subscription)}`);
  });
  if (subscriptions.length > 20) {
    lines.push('');
    lines.push(`Показаны первые 20 из ${subscriptions.length}.`);
  }
  lines.push('');
  lines.push('Нажмите ❌ рядом с подпиской, чтобы удалить её.');
  return lines.join('\n');
}

export function formatSubscriptionCreated(subscription: Subscription): string {
  return [
    '✅ Подписка сохранена',
    '',
    formatSubscription(subscription),
    '',
    'Она появилась в разделе «Мои подписки». Отписаться можно там же.',
  ].join('\n');
}

export interface SubscriptionDraftView {
  city: CityId | null;
  category: CategoryId | null;
  period: DatePreset | null;
}

export function formatSubscriptionDraft(draft: SubscriptionDraftView): string {
  return [
    '🔔 Новая подписка',
    '',
    `📍 Город: ${draft.city ? (cityName(draft.city) ?? draft.city) : 'Любой'}`,
    `🎭 Категория: ${draft.category ? (categoryName(draft.category) ?? draft.category) : 'Любая'}`,
    `🗓 Период: ${draft.period ? (datePresetLabel(draft.period) ?? draft.period) : 'Любой'}`,
    '',
    'Выберите, что изменить, или сохраните подписку.',
  ].join('\n');
}

export function eventSourceUrl(event: Event): string | null {
  const candidates = [event.org_link, event.source_url];
  for (const candidate of candidates) {
    const url = telegramSafeHttpUrl(candidate);
    if (url) return url;
  }
  return null;
}

const PRIVATE_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);

function isPrivateIpv4(host: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return false;
  const [a = 0, b = 0, c = 0] = match.slice(1).map(Number);
  const octets = match.slice(1).map(Number);
  if (octets.some((octet) => octet < 0 || octet > 255)) return false;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateIpv6(host: string): boolean {
  if (!host.startsWith('[') || !host.endsWith(']')) return false;
  const address = host.slice(1, -1).toLowerCase();
  // Публичный global unicast — только 2000::/3; остальное (ULA, link-local,
  // multicast, IPv4-mapped) в кнопки не пускаем.
  return !/^[23]/.test(address);
}

/**
 * Telegram отклоняет inline-кнопки с localhost и приватными адресами.
 * Возвращает нормализованный URL или null, чтобы такая кнопка не попала в клавиатуру.
 */
export function telegramSafeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const host = url.hostname.toLowerCase();
    if (PRIVATE_HOSTS.has(host) || host.endsWith('.localhost') || host.endsWith('.local')) return null;
    if (isPrivateIpv4(host) || isPrivateIpv6(host)) return null;
    const normalized = url.toString();
    return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
  } catch {
    return null;
  }
}
