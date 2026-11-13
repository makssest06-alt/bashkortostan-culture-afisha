import {
  categoryName,
  categoryNameOne,
  cityName,
  datePresetLabel,
  isDatePreset,
  isIsoDate,
  todayIsoDate,
  type CategoryId,
  type CityId,
  type DatePreset,
  type SearchDate,
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  return date.year === Number(todayIsoDate(now).slice(0, 4)) ? '' : ` ${date.year}`;
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

const MONTHS_SHORT = [
  'янв',
  'фев',
  'мар',
  'апр',
  'мая',
  'июн',
  'июл',
  'авг',
  'сен',
  'окт',
  'ноя',
  'дек',
] as const;

/** Короткая подпись для кнопок выбора даты: «14 ноя, сб». */
export function formatDateShort(value: string, now: Date = new Date()): string {
  const date = parseDateParts(value);
  if (!date) return value;
  const suffix = date.year === Number(todayIsoDate(now).slice(0, 4)) ? '' : ` ${date.year}`;
  return `${date.day} ${MONTHS_SHORT[date.month - 1] ?? ''}${suffix}, ${weekday(date)}`;
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

/** Подпись для фильтра: пресет, конкретная дата или «Любая дата». */
export function searchDateLabel(value: SearchDate | null | undefined, now: Date = new Date()): string {
  if (!value) return 'Любая дата';
  if (isDatePreset(value)) return datePresetLabel(value) ?? value;
  if (isIsoDate(value)) return formatDateWithWeekday(value, now);
  return value;
}

export function formatFreshness(value: string | null | undefined, now: Date = new Date()): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 0) return formatDate(value, now);

  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'только что';
  if (minutes < 60) return `${minutes} мин назад`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;

  const days = Math.floor(hours / 24);
  if (days < 14) return `${days} дн. назад`;
  return formatDate(value, now);
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

const HTML_ESCAPE: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};

/**
 * Любые данные из API и пользовательский ввод попадают в HTML-сообщение только
 * через эту функцию. Иначе название события с `<` сломает разметку Telegram.
 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (char) => HTML_ESCAPE[char] ?? char);
}

function esc(value: string): string {
  return escapeHtml(value);
}

function bold(value: string): string {
  return `<b>${esc(value)}</b>`;
}

export interface SearchFilterState {
  q: string | null;
  city: CityId | null;
  category: CategoryId | null;
  date: SearchDate | null;
  priceMax?: number | null;
  freeOnly?: boolean;
}

export function formatFilterLine(filters: SearchFilterState, now: Date = new Date()): string {
  const parts: string[] = [];
  if (filters.city) parts.push(`📍 Город: ${esc(cityName(filters.city) ?? filters.city)}`);
  if (filters.category) {
    parts.push(`🎭 Категория: ${esc(categoryName(filters.category) ?? filters.category)}`);
  }
  if (filters.date) parts.push(`📅 Когда: ${esc(searchDateLabel(filters.date, now))}`);
  if (filters.freeOnly) {
    parts.push('💰 Цена: Бесплатно');
  } else if (filters.priceMax !== null && filters.priceMax !== undefined) {
    parts.push(`💰 Цена: до ${formatRubles(filters.priceMax)}`);
  }
  return parts.length > 0 ? parts.join(' · ') : 'Все города и категории';
}

function formatSummaryLines(event: EventListItem, index: number, now: Date): string {
  const city = cityName(event.city_id) ?? event.city;
  const price = formatPrice(event.price_min, event.price_max, event.is_free);
  const freshness = formatFreshness(event.verified_at ?? event.updated_at, now);
  const thirdLine = [`${city} · ${price}`, formatAge(event.age_limit)];
  if (freshness) thirdLine.push(`обновлено ${freshness}`);

  return [
    `${bold(`${index}. ${truncate(event.title, 110)}`)}`,
    `${esc(formatEventWhen(event, now))} · ${esc(truncate(event.venue, 70))}`,
    esc(thirdLine.join(' · ')),
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

  lines.push(
    `🔎 ${query ? `Поиск ${bold(query)}` : bold('Афиша')} · найдено ${result.total}`,
  );
  lines.push(formatFilterLine(filters, now));
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

export function formatNoResults(filters: SearchFilterState, now: Date = new Date()): string {
  const lines = [`😕 ${bold('Ничего не нашлось')}`];
  if (filters.q) lines.push(`Запрос: «${esc(truncate(filters.q, 80))}»`);
  lines.push(formatFilterLine(filters, now));
  lines.push('');
  lines.push('Попробуйте убрать один из фильтров кнопками ниже — поиск выполнится заново.');
  return lines.join('\n');
}

export function isSoldOut(event: Event | EventListItem): boolean {
  return pickPrimaryOccurrence(event)?.availability === 'sold_out';
}

export function formatAvailability(event: Event | EventListItem): string | null {
  const occurrence = pickPrimaryOccurrence(event);
  if (occurrence?.availability === 'sold_out') return 'Билеты на этот сеанс проданы';
  if (occurrence?.availability === 'available') return 'Билеты в продаже';
  return null;
}

export function formatEventCard(event: Event | EventListItem, now: Date = new Date()): string {
  const lines: string[] = [];
  const category = categoryNameOne(event.category) ?? 'Событие';
  const header: string[] = [`🎭 ${bold(category)}`];
  if (event.age_limit !== null) header.push(`${event.age_limit}+`);
  const duration = formatDuration(event.duration_min);
  if (duration) header.push(duration);
  lines.push(header.join(' · '));
  lines.push(bold(truncate(event.title, 200)));
  lines.push('');

  if (event.status === 'cancelled') {
    lines.push(`❌ ${bold('Событие отменено')}`);
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
  if (isSoldOut(event)) {
    lines.push('❌ Билеты на этот сеанс проданы');
  }

  lines.push(`📅 ${bold(formatEventWhen(event, now))}`);

  const city = cityName(event.city_id) ?? event.city;
  lines.push(`📍 ${bold(city)} · ${esc(truncate(event.venue, 120))}`);
  if (event.address) lines.push(esc(`   ${truncate(event.address, 160)}`));

  const ticketLine = [`💰 ${esc(formatPrice(event.price_min, event.price_max, event.is_free))}`];
  const availability = formatAvailability(event);
  if (availability && !isSoldOut(event)) ticketLine.push(`🎟 ${esc(availability)}`);
  lines.push(ticketLine.join(' · '));

  const extras: string[] = [];
  if (event.language) extras.push(`Язык: ${event.language}`);
  if (extras.length > 0) lines.push(esc(extras.join(' · ')));

  if (event.tags.length > 0) {
    lines.push(`🏷 ${esc(event.tags.slice(0, 6).join(', '))}`);
  }
  if (event.organizer) {
    lines.push(`🏛 ${esc(truncate(event.organizer, 120))}`);
  }

  if (event.description.trim()) {
    lines.push('');
    lines.push(esc(truncate(event.description, 700)));
  }

  const sourceUrl = eventSourcePageUrl(event);
  const sourceHost = urlHost(sourceUrl);
  const verified = formatFreshness(event.verified_at, now);
  const updated = verified ? null : formatFreshness(event.updated_at, now);
  const meta: string[] = [];
  if (sourceHost) meta.push(`источник: ${sourceHost}`);
  if (verified) meta.push(`проверено ${verified}`);
  else if (updated) meta.push(`обновлено ${updated}`);
  if (meta.length > 0) {
    lines.push('');
    lines.push(`🗓 ${esc(meta.join(' · '))}`);
  }

  if (event.review?.disputed) {
    lines.push('');
    lines.push('⚠️ Данные события требуют проверки.');
  }
  if (event.synthetic) {
    lines.push('🧪 Демонстрационное событие — не для планирования.');
  }

  return lines.join('\n');
}

function subscriptionParts(subscription: Subscription): {
  city: string;
  category: string;
  period: string;
} {
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
      `🔔 ${bold('Подписок пока нет')}`,
      '',
      'Оформите подписку на город, категорию или период — она сохранится в сервисе.',
    ].join('\n');
  }

  const lines = [`🔔 ${bold(`Ваши подписки (${subscriptions.length})`)}`, ''];
  subscriptions.slice(0, 20).forEach((subscription, index) => {
    lines.push(`${index + 1}. ${esc(formatSubscription(subscription))}`);
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
    `✅ ${bold('Подписка сохранена')}`,
    '',
    esc(formatSubscription(subscription)),
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
    `🔔 ${bold('Новая подписка')}`,
    '',
    `📍 Город: ${esc(draft.city ? (cityName(draft.city) ?? draft.city) : 'Любой')}`,
    `🎭 Категория: ${esc(draft.category ? (categoryName(draft.category) ?? draft.category) : 'Любая')}`,
    `🗓 Период: ${esc(draft.period ? (datePresetLabel(draft.period) ?? draft.period) : 'Любой')}`,
    '',
    'Выберите, что изменить, или сохраните подписку.',
  ].join('\n');
}

/** Ссылка на страницу события у первоисточника. */
export function eventSourcePageUrl(event: Event): string | null {
  if (event.synthetic) return null;
  return telegramSafeHttpUrl(event.source_url);
}

/** Ссылка организатора на покупку билетов. */
export function eventTicketsUrl(event: Event): string | null {
  if (event.synthetic) return null;
  return telegramSafeHttpUrl(event.org_link);
}

/** Ссылка на карточку события на нашем сайте; id обязан быть UUID. */
export function eventSiteUrl(publicWebUrl: string | null | undefined, id: string): string | null {
  if (!publicWebUrl || !UUID_RE.test(id)) return null;
  const base = telegramSafeHttpUrl(publicWebUrl);
  if (!base) return null;
  return telegramSafeHttpUrl(`${base}/events/${id}`);
}

export function urlHost(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

const PRIVATE_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);
const PLACEHOLDER_HOSTS = new Set([
  'example.com',
  'example.org',
  'example.net',
  'example.edu',
  'example.test',
  'test.invalid',
]);
const PLACEHOLDER_SUFFIXES = ['.example.com', '.example.org', '.example.net', '.example'];

function isPrivateIpv4(host: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return false;
  const octets = match.slice(1).map(Number);
  const [a = 0, b = 0, c = 0] = octets;
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
 * Дополнительно отсекаем placeholder-домены и URL с логином/паролем.
 * Возвращает нормализованный URL или null.
 */
export function telegramSafeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    const host = url.hostname.toLowerCase().replace(/\.+$/, '');
    if (!host) return null;
    if (PRIVATE_HOSTS.has(host) || host.endsWith('.localhost') || host.endsWith('.local')) {
      return null;
    }
    if (PLACEHOLDER_HOSTS.has(host) || PLACEHOLDER_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
      return null;
    }
    if (host.endsWith('.test') || host.endsWith('.invalid')) return null;
    if (isPrivateIpv4(host) || isPrivateIpv6(host)) return null;
    const normalized = url.toString();
    return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
  } catch {
    return null;
  }
}
