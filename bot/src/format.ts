import type { CategoryId, CityId, DirectoryLookup } from './directory-service.js';
import {
  ageLabel,
  datePresetLabel,
  isDatePreset,
  isIsoDate,
  languageLabel,
  sortLabel,
  todayIsoDate,
  type DatePreset,
  type SearchDate,
} from './search-options.js';
import type {
  AssistantResponse,
  Event,
  EventListItem,
  Occurrence,
  Offer,
  Relaxation,
  Subscription,
  VenueSchedule,
} from './api/types.js';

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

/** UUID события: используется и для ссылок, и для deep link `/start event_<uuid>`. */
export function isEventUuid(value: string | null | undefined): boolean {
  return typeof value === 'string' && UUID_RE.test(value);
}

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

/** Выбранный сеанс или ближайший подходящий, если выбор не передан. */
export function pickOccurrence(
  event: Event | EventListItem,
  occurrenceId?: string | null,
): Occurrence | null {
  if (occurrenceId) {
    const selected = event.occurrences.find((occurrence) => occurrence.id === occurrenceId);
    if (selected) return selected;
  }
  return pickPrimaryOccurrence(event);
}

/** Все сеансы в хронологическом порядке; прошедшие остаются в конце. */
export function sortOccurrences(occurrences: readonly Occurrence[]): Occurrence[] {
  return [...occurrences].sort((a, b) => {
    if (a.is_past !== b.is_past) return a.is_past ? 1 : -1;
    return a.date_start.localeCompare(b.date_start);
  });
}

export function formatEventWhen(
  event: Event | EventListItem,
  now: Date = new Date(),
  occurrenceId?: string | null,
): string {
  const occurrence = pickOccurrence(event, occurrenceId);
  if (occurrence) return formatOccurrence(occurrence, now);
  if (event.date_start) {
    const range = formatDateRange(event.date_start, event.date_end, now);
    const time = event.time_precision === 'date' ? null : timePart(event.date_start);
    return time ? `${range}, ${time}` : range;
  }
  return 'дата уточняется';
}

export function occurrenceStatusLine(occurrence: Occurrence): string | null {
  if (occurrence.is_past) return 'сеанс уже прошёл';
  if (occurrence.status === 'cancelled') return 'отменён';
  if (occurrence.status === 'postponed') return 'перенесён, дата уточняется';
  if (occurrence.status === 'rescheduled') return 'перенесён на новую дату';
  if (occurrence.status === 'unknown') return 'статус не подтверждён';
  if (occurrence.availability === 'sold_out') return 'билеты проданы';
  if (occurrence.availability === 'available') return 'есть билеты';
  return null;
}

export function formatSessionsList(
  event: Event,
  now: Date = new Date(),
  directories?: DirectoryLookup,
): string {
  const lines = [`🎟 ${bold('Все сеансы')} · ${esc(truncate(event.title, 120))}`, ''];
  if (event.occurrences.length === 0) {
    lines.push('У события пока нет опубликованных сеансов.');
    return lines.join('\n');
  }

  sortOccurrences(event.occurrences).forEach((occurrence, index) => {
    const status = occurrenceStatusLine(occurrence);
    const place = directories ? (directories.cityName(event.city_id) ?? event.city) : event.city;
    lines.push(
      `${index + 1}. ${esc(formatOccurrence(occurrence, now))} · ${esc(truncate(event.venue, 60))}${
        place ? ` · ${esc(place)}` : ''
      }`,
    );
    if (status) lines.push(`   ${esc(status)}`);
  });
  lines.push('');
  lines.push('Выберите сеанс кнопкой ниже или откройте карточку события.');
  return lines.join('\n');
}

const AUDIENCE_LABELS: Record<Offer['audience'] & string, string> = {
  adult: 'взрослый',
  child: 'детский',
  reduced: 'льготный',
};

export function formatOffers(event: Event): string {
  const lines = [`🎟 ${bold('Тарифы')} · ${esc(truncate(event.title, 120))}`, ''];
  if (event.offers.length === 0) {
    lines.push('Тарифы не указаны. Уточняйте стоимость у организатора.');
    return lines.join('\n');
  }
  event.offers.forEach((offer) => {
    const name = offer.name?.trim() || 'Билет';
    const audience = offer.audience ? AUDIENCE_LABELS[offer.audience] : null;
    const price = offer.is_free
      ? 'бесплатно'
      : offer.price === null
        ? 'цена не указана'
        : formatRubles(offer.price);
    lines.push(`• ${esc(name)} — ${esc(price)}${audience ? ` · ${esc(audience)}` : ''}`);
  });
  lines.push('');
  lines.push('Стоимость и наличие мест уточняйте у организатора.');
  return lines.join('\n');
}

export function formatRelaxationLabel(relaxation: Relaxation): string {
  const label = relaxation.label;
  return typeof label === 'string' ? label : label.ru;
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
  dateFrom?: string | null;
  dateTo?: string | null;
  priceMax?: number | null;
  freeOnly?: boolean;
  age?: number | null;
  language?: string | null;
  sort?: string | null;
}

export function formatFilterLine(
  filters: SearchFilterState,
  directories: DirectoryLookup,
  now: Date = new Date(),
): string {
  const parts: string[] = [];
  if (filters.city) {
    parts.push(`📍 Город: ${esc(directories.cityName(filters.city) ?? filters.city)}`);
  }
  if (filters.category) {
    parts.push(
      `🎭 Категория: ${esc(directories.categoryName(filters.category) ?? filters.category)}`,
    );
  }
  if (filters.dateFrom && filters.dateTo) {
    parts.push(`📅 Период: ${esc(formatDateRange(filters.dateFrom, filters.dateTo, now))}`);
  } else if (filters.date) {
    parts.push(`📅 Когда: ${esc(searchDateLabel(filters.date, now))}`);
  }
  if (filters.freeOnly) {
    parts.push('💰 Цена: Бесплатно');
  } else if (filters.priceMax !== null && filters.priceMax !== undefined) {
    parts.push(`💰 Цена: до ${formatRubles(filters.priceMax)}`);
  }
  if (filters.age !== null && filters.age !== undefined) {
    parts.push(`👶 Возраст: ${esc(ageLabel(filters.age))}`);
  }
  if (filters.language) {
    parts.push(`🌐 Язык: ${esc(languageLabel(filters.language))}`);
  }
  if (filters.sort && filters.sort !== 'date') {
    parts.push(`🔀 Сортировка: ${esc(sortLabel(filters.sort))}`);
  }
  return parts.length > 0 ? parts.join(' · ') : 'Все города и категории';
}

function formatSummaryLines(
  event: EventListItem,
  index: number,
  now: Date,
  directories: DirectoryLookup,
): string {
  const city = directories.cityName(event.city_id) ?? event.city;
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

interface ListResult {
  items: EventListItem[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  hidden_unknown_price?: number;
  hidden_unknown_age?: number;
}

/** Поясняет, почему часть событий не попала в фильтр по цене или возрасту. */
function hiddenUnknownLines(result: {
  hidden_unknown_price?: number;
  hidden_unknown_age?: number;
}): string[] {
  const lines: string[] = [];
  if ((result.hidden_unknown_price ?? 0) > 0) {
    lines.push(
      `Ещё ${result.hidden_unknown_price}: цена не указана — такие события не попали в фильтр.`,
    );
  }
  if ((result.hidden_unknown_age ?? 0) > 0) {
    lines.push(
      `Ещё ${result.hidden_unknown_age}: возраст не указан — такие события не попали в фильтр.`,
    );
  }
  return lines;
}

export function formatSearchResults(
  result: ListResult,
  filters: SearchFilterState,
  directories: DirectoryLookup,
  options: { now?: Date; queryWasTruncated?: boolean } = {},
): string {
  const now = options.now ?? new Date();
  const lines: string[] = [];
  const query = filters.q ? `«${truncate(filters.q, 80)}»` : null;

  lines.push(
    `🔎 ${query ? `Поиск ${bold(query)}` : bold('Афиша')} · найдено ${result.total}`,
  );
  lines.push(formatFilterLine(filters, directories, now));
  if (options.queryWasTruncated) {
    lines.push('Запрос сокращён до 100 знаков — так требует API.');
  }
  lines.push('');

  result.items.forEach((event, index) => {
    lines.push(
      formatSummaryLines(
        event,
        (result.page - 1) * Math.max(1, result.page_size) + index + 1,
        now,
        directories,
      ),
    );
  });

  const hidden = hiddenUnknownLines(result);
  if (hidden.length > 0) {
    lines.push('');
    lines.push(...hidden);
  }

  if (result.total_pages > 1) {
    lines.push('');
    lines.push(`Страница ${result.page} из ${result.total_pages}`);
  }

  return lines.join('\n');
}

/** Выдача похожих событий: без фильтров, но с тем же форматом карточек. */
export function formatSimilarResults(
  result: ListResult,
  directories: DirectoryLookup,
  now: Date = new Date(),
): string {
  const lines: string[] = [`🎯 ${bold('Похожие события')} · найдено ${result.total}`, ''];

  result.items.forEach((event, index) => {
    lines.push(
      formatSummaryLines(
        event,
        (result.page - 1) * Math.max(1, result.page_size) + index + 1,
        now,
        directories,
      ),
    );
  });

  const hidden = hiddenUnknownLines(result);
  if (hidden.length > 0) {
    lines.push('');
    lines.push(...hidden);
  }

  if (result.total_pages > 1) {
    lines.push('');
    lines.push(`Страница ${result.page} из ${result.total_pages}`);
  }

  return lines.join('\n');
}

/**
 * Ответ ассистента — обычный текст API. Экранируем его целиком и добавляем
 * только карточки, причины и счётчики, которые уже отформатированы нами.
 */
export function formatAssistantResponse(
  response: AssistantResponse,
  directories: DirectoryLookup,
  now: Date = new Date(),
): string {
  const lines: string[] = [esc(response.message.trim())];

  if (response.assumptions.length > 0) {
    lines.push('', `💡 ${bold('Что учёл')}`);
    for (const assumption of response.assumptions.slice(0, 6)) {
      const text = truncate(assumption.text, 140).trim();
      if (text) lines.push(`• ${esc(text)}`);
    }
  }

  if (response.action === 'search') {
    lines.push('');
    if (response.results.length === 0) {
      lines.push('Событий по этим условиям нет.');
    } else {
      response.results.forEach((item, index) => {
        lines.push(formatSummaryLines(item.event, index + 1, now, directories));
        const reasons = item.reasons
          .filter(Boolean)
          .slice(0, 2)
          .map((reason) => truncate(reason, 110));
        if (reasons.length > 0) lines.push(`↳ ${esc(reasons.join('; '))}`);
        const caveats = item.caveats
          .filter(Boolean)
          .slice(0, 1)
          .map((caveat) => truncate(caveat, 110));
        if (caveats.length > 0) lines.push(`⚠️ ${esc(caveats.join('; '))}`);
        lines.push('');
      });
      if (lines.at(-1) === '') lines.pop();
      if (response.total > response.results.length) {
        lines.push('', `Показано ${response.results.length} из ${response.total}.`);
      }
    }

    const hidden = hiddenUnknownLines(response);
    if (hidden.length > 0) {
      lines.push('');
      lines.push(...hidden);
    }
    if (response.relaxations.length > 0) {
      lines.push('', 'Можно ослабить условия — кнопки ниже.');
    }
  }

  if (response.unsupported_actions.length > 0) {
    lines.push('', 'Это действие бот не выполняет: он только показывает афишу.');
  }

  return lines.join('\n').trim();
}

export function formatNoResults(
  filters: SearchFilterState,
  directories: DirectoryLookup,
  now: Date = new Date(),
  relaxations: readonly Relaxation[] = [],
): string {
  const lines = [`😕 ${bold('Ничего не нашлось')}`];
  if (filters.q) lines.push(`Запрос: «${esc(truncate(filters.q, 80))}»`);
  lines.push(formatFilterLine(filters, directories, now));
  lines.push('');
  if (relaxations.length > 0) {
    lines.push('Можно ослабить одно условие — сервер уже посчитал, сколько событий найдётся:');
    relaxations.slice(0, 5).forEach((relaxation) => {
      lines.push(`• ${esc(formatRelaxationLabel(relaxation))} — ${relaxation.count}`);
    });
    lines.push('');
  }
  lines.push('Попробуйте убрать один из фильтров кнопками ниже — поиск выполнится заново.');
  return lines.join('\n');
}

export function isSoldOut(event: Event | EventListItem, occurrenceId?: string | null): boolean {
  return pickOccurrence(event, occurrenceId)?.availability === 'sold_out';
}

export function formatAvailability(
  event: Event | EventListItem,
  occurrenceId?: string | null,
): string | null {
  const occurrence = pickOccurrence(event, occurrenceId);
  if (occurrence?.availability === 'sold_out') return 'Билеты на этот сеанс проданы';
  if (occurrence?.availability === 'available') return 'Билеты в продаже';
  return null;
}

export function formatEventCard(
  event: Event | EventListItem,
  directories: DirectoryLookup,
  now: Date = new Date(),
  options: { occurrenceId?: string | null } = {},
): string {
  const lines: string[] = [];
  const category = directories.categoryName(event.category) ?? 'Событие';
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

  const occurrence = pickOccurrence(event, options.occurrenceId);
  if (occurrence?.status === 'cancelled') {
    lines.push('❌ Этот сеанс отменён');
  } else if (occurrence?.status === 'postponed') {
    lines.push('⚠️ Сеанс перенесён, новая дата уточняется');
  } else if (occurrence?.status === 'rescheduled') {
    lines.push('⚠️ Сеанс перенесён на новую дату');
  } else if (occurrence?.status === 'unknown') {
    lines.push('ℹ️ Статус сеанса не подтверждён организатором');
  }
  if (isSoldOut(event, options.occurrenceId)) {
    lines.push('❌ Билеты на этот сеанс проданы');
  }

  const sessionSuffix = (() => {
    if (event.occurrences.length <= 1 || !occurrence) return '';
    const ordered = sortOccurrences(event.occurrences);
    const index = ordered.findIndex((item) => item.id === occurrence.id);
    return index >= 0 ? ` · сеанс ${index + 1} из ${ordered.length}` : '';
  })();
  lines.push(`📅 ${bold(formatEventWhen(event, now, options.occurrenceId))}${esc(sessionSuffix)}`);

  const city = directories.cityName(event.city_id) ?? event.city;
  lines.push(`📍 ${bold(city)} · ${esc(truncate(event.venue, 120))}`);
  if (event.address) lines.push(esc(`   ${truncate(event.address, 160)}`));

  const ticketLine = [`💰 ${esc(formatPrice(event.price_min, event.price_max, event.is_free))}`];
  const availability = formatAvailability(event, options.occurrenceId);
  if (availability && !isSoldOut(event, options.occurrenceId)) {
    ticketLine.push(`🎟 ${esc(availability)}`);
  }
  lines.push(ticketLine.join(' · '));

  const extras: string[] = [];
  if (event.language) extras.push(`Язык: ${languageLabel(event.language)}`);
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

function subscriptionParts(
  subscription: Subscription,
  directories: DirectoryLookup,
): {
  city: string;
  category: string;
  period: string;
} {
  return {
    city: subscription.city
      ? (directories.cityName(subscription.city) ?? subscription.city)
      : 'Любой город',
    category: subscription.category
      ? (directories.categoryName(subscription.category) ?? subscription.category)
      : 'Все категории',
    period: subscription.period
      ? (datePresetLabel(subscription.period) ?? subscription.period)
      : 'Любой период',
  };
}

export function formatSubscription(
  subscription: Subscription,
  directories: DirectoryLookup,
): string {
  const parts = subscriptionParts(subscription, directories);
  return `${parts.category} · ${parts.city} · ${parts.period}`;
}

export function formatSubscriptionsList(
  subscriptions: Subscription[],
  directories: DirectoryLookup,
): string {
  if (subscriptions.length === 0) {
    return [
      `🔔 ${bold('Подписок пока нет')}`,
      '',
      'Оформите подписку на город, категорию или период — она сохранится в сервисе.',
    ].join('\n');
  }

  const lines = [`🔔 ${bold(`Ваши подписки (${subscriptions.length})`)}`, ''];
  subscriptions.slice(0, 20).forEach((subscription, index) => {
    lines.push(`${index + 1}. ${esc(formatSubscription(subscription, directories))}`);
  });
  if (subscriptions.length > 20) {
    lines.push('');
    lines.push(`Показаны первые 20 из ${subscriptions.length}.`);
  }
  lines.push('');
  lines.push('Нажмите ▶️ рядом с подпиской, чтобы открыть её события, или ❌, чтобы удалить.');
  return lines.join('\n');
}

export function formatSubscriptionCreated(
  subscription: Subscription,
  directories: DirectoryLookup,
): string {
  return [
    `✅ ${bold('Подписка сохранена')}`,
    '',
    esc(formatSubscription(subscription, directories)),
    '',
    'Она появилась в разделе «Мои подписки». Отписаться можно там же.',
  ].join('\n');
}

export interface SubscriptionDraftView {
  city: CityId | null;
  category: CategoryId | null;
  period: DatePreset | null;
}

export function formatSubscriptionDraft(
  draft: SubscriptionDraftView,
  directories: DirectoryLookup,
): string {
  return [
    `🔔 ${bold('Новая подписка')}`,
    '',
    `📍 Город: ${esc(draft.city ? (directories.cityName(draft.city) ?? draft.city) : 'Любой')}`,
    `🎭 Категория: ${esc(draft.category ? (directories.categoryName(draft.category) ?? draft.category) : 'Любая')}`,
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

/** Ссылка на Яндекс.Карты по координатам площадки. */
export function eventMapUrl(event: Event): string | null {
  const lat = event.lat;
  const lon = event.lon;
  if (lat === null || lat === undefined || lon === null || lon === undefined) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return telegramSafeHttpUrl(`https://yandex.ru/maps/?pt=${lon},${lat}&z=17&l=map`);
}

/** Deep link «сайт → бот»: открывает карточку события по /start event_<uuid>. */
export function eventDeepLink(
  botUsername: string | null | undefined,
  eventId: string,
): string | null {
  if (!botUsername || !/^[A-Za-z0-9_]{3,64}$/.test(botUsername)) return null;
  if (!UUID_RE.test(eventId)) return null;
  return telegramSafeHttpUrl(`https://t.me/${botUsername}?start=event_${eventId}`);
}

/** Системный диалог «Поделиться» Telegram. */
export function eventShareUrl(url: string | null | undefined, title: string): string | null {
  const safeUrl = telegramSafeHttpUrl(url);
  if (!safeUrl) return null;
  const query = new URLSearchParams({
    url: safeUrl,
    text: truncate(title, 180),
  });
  return telegramSafeHttpUrl(`https://t.me/share/url?${query.toString()}`);
}

export function formatVenueSchedule(
  schedule: VenueSchedule,
  directories: DirectoryLookup,
  now: Date = new Date(),
): string {
  const venue = schedule.venue;
  const city = directories.cityName(venue.city_id) ?? venue.city;
  const lines = [
    `🏛 ${bold(truncate(venue.name, 160))}`,
    `📍 ${esc(city)}${venue.address ? ` · ${esc(truncate(venue.address, 160))}` : ''}`,
    `📅 ${esc(formatDateRange(schedule.date_from, schedule.date_to, now))}`,
    '',
  ];

  if (schedule.items.length === 0) {
    lines.push('На этот период событий площадки нет.');
    return lines.join('\n');
  }

  schedule.items.slice(0, 20).forEach((event, index) => {
    const price = formatPrice(event.price_min, event.price_max, event.is_free);
    lines.push(
      `${index + 1}. ${bold(truncate(event.title, 100))}`,
      `${esc(formatEventWhen(event, now))} · ${esc(price)}`,
    );
  });
  if (schedule.items.length > 20) {
    lines.push('', `Показаны первые 20 из ${schedule.items.length}.`);
  }
  return lines.join('\n');
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
