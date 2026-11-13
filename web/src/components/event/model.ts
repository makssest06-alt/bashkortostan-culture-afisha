/**
 * Логика страницы события как чистые функции: группы сеансов, состояние кнопки покупки,
 * ссылки на карты, подписи тарифов, текст для метаданных. Без React и без сети.
 */

import { getCategory } from '@/data/dictionaries';
import { formatDay, formatOccurrence, formatTimeValue } from '@/lib/api/format';
import { eventsHref, parseEventsQuery } from '@/lib/api/params';
import { localNow, valueDate, valueTime } from '@/lib/api/time';
import type { AfishaEvent, EventListItem, Occurrence, Offer, PriceSummary, Venue } from '@/lib/api/types';
import type { Lang } from '@/lib/i18n/lang';
import { pick } from '@/lib/i18n/lang';

/** Сколько ближайших сеансов видно сразу: остальные открывает кнопка «Все сеансы». */
export const VISIBLE_SESSIONS = 3;

/** Название длиннее этого набирается кеглем поменьше: иначе заголовок занимает пол-экрана. */
export const LONG_TITLE = 40;

/** Описание длиннее этого сворачивается. */
export const LONG_DESCRIPTION = 360;

/**
 * Яркость фонового свечения на странице события. Ниже, чем у каталога: здесь много мелкого текста
 * (подписи, сноски, даты медным цветом), и при ярком свечении у левого края ему не хватает контраста 4.5:1.
 */
export const EVENT_GLOW = 0.2;

const CATALOG_PATH = '/events';

// ---------------------------------------------------------------------------
// Название и описание
// ---------------------------------------------------------------------------

export function eventTitle(event: Pick<AfishaEvent, 'title' | 'title_ba'>, lang: Lang): string {
  return lang === 'ba' && event.title_ba ? event.title_ba : event.title;
}

/** Абзацы описания: пустая строка делит текст, одиночный перенос остаётся внутри абзаца. */
export function descriptionParagraphs(description: string): string[] {
  return description
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

export function isLongDescription(description: string): boolean {
  return description.length > LONG_DESCRIPTION;
}

// ---------------------------------------------------------------------------
// Сеансы
// ---------------------------------------------------------------------------

export interface SessionGroups {
  /** Сеансы, на которые ещё можно попасть, включая отменённые и перенесённые: их нельзя прятать. */
  upcoming: Occurrence[];
  past: Occurrence[];
}

export function splitSessions(occurrences: readonly Occurrence[]): SessionGroups {
  return {
    upcoming: occurrences.filter((occurrence) => !occurrence.is_past),
    past: occurrences.filter((occurrence) => occurrence.is_past),
  };
}

/** Сеанс не отменён и дата у него известна. */
function isLive(occurrence: Occurrence): boolean {
  return occurrence.status !== 'cancelled' && occurrence.status !== 'postponed';
}

/** Ближайший сеанс, на который можно идти. Если таких нет, ближайший из оставшихся. */
export function nearestSession(occurrences: readonly Occurrence[]): Occurrence | null {
  const { upcoming } = splitSessions(occurrences);
  return upcoming.find(isLive) ?? upcoming[0] ?? null;
}

export interface SessionTime {
  /** Строка даты: «сб, 14 ноября». Для выставки с периодом пусто. */
  day: string | null;
  /** Крупная строка: «19:00», «12:00-20:00» или «до 2 декабря». */
  main: string;
}

/** Как показать время сеанса в списке. */
export function sessionTime(occurrence: Occurrence, lang: Lang, today: string): SessionTime {
  const start = valueTime(occurrence.start);
  if (!start) return { day: null, main: formatOccurrence(occurrence, lang, today) };

  const date = valueDate(occurrence.start);
  const end = occurrence.end && valueDate(occurrence.end) === date ? valueTime(occurrence.end) : null;
  return {
    day: formatDay(date, lang, { weekday: 'short' }),
    main: end ? `${start}-${end}` : start,
  };
}

// ---------------------------------------------------------------------------
// Покупка
// ---------------------------------------------------------------------------

export type BuyState =
  /** Есть ссылка и есть сеанс, на который можно идти. */
  | { kind: 'buy'; url: string }
  | { kind: 'sold_out' }
  | { kind: 'cancelled' }
  | { kind: 'postponed' }
  /** Вход свободный, ссылка на билеты не нужна. */
  | { kind: 'free' }
  /** Ссылки на билеты нет: честно говорим об этом и отправляем к источнику. */
  | { kind: 'no_link' }
  | { kind: 'no_sessions' };

/** Что показать на месте кнопки «Купить билет». Кнопка есть, только когда она честно ведёт к билетам. */
export function buyStateOf(event: Pick<AfishaEvent, 'occurrences' | 'ticket_url' | 'price_summary'>): BuyState {
  const { upcoming } = splitSessions(event.occurrences);
  if (upcoming.length === 0) return { kind: 'no_sessions' };

  const live = upcoming.filter(isLive);
  if (live.length === 0) {
    return upcoming.every((occurrence) => occurrence.status === 'cancelled')
      ? { kind: 'cancelled' }
      : { kind: 'postponed' };
  }
  if (live.every((occurrence) => occurrence.availability === 'sold_out')) return { kind: 'sold_out' };
  if (event.ticket_url) return { kind: 'buy', url: event.ticket_url };
  if (event.price_summary.kind === 'free') return { kind: 'free' };
  return { kind: 'no_link' };
}

/** Ссылка внутри сайта: открывается в той же вкладке. Всё остальное считается внешним адресом. */
export function isInternalHref(href: string): boolean {
  return href.startsWith('/') && !href.startsWith('//');
}

// ---------------------------------------------------------------------------
// Цены
// ---------------------------------------------------------------------------

export type OfferLabel = { name: string } | { key: 'price.adult' | 'price.child' | 'price.reduced' | 'price.general' };

/** Подпись тарифа: название из источника, иначе «Взрослый», «Детский», «Льготный» или просто «Билет». */
export function offerLabel(offer: Offer): OfferLabel {
  if (offer.name) return { name: offer.name };
  if (offer.audience === 'adult') return { key: 'price.adult' };
  if (offer.audience === 'child') return { key: 'price.child' };
  if (offer.audience === 'reduced') return { key: 'price.reduced' };
  return { key: 'price.general' };
}

/** Тарифы стоит показывать списком, когда их несколько или у единственного есть своё имя. */
export function hasOfferList(offers: readonly Offer[]): boolean {
  return offers.length > 1 || offers.some((offer) => Boolean(offer.name) || Boolean(offer.audience));
}

// ---------------------------------------------------------------------------
// Площадка и карты
// ---------------------------------------------------------------------------

export function hasCoordinates(venue: Venue): venue is Venue & { lat: number; lon: number } {
  return typeof venue.lat === 'number' && typeof venue.lon === 'number';
}

/** Встроенная карта OpenStreetMap с меткой: около 800 метров по ширине. */
export function osmEmbedUrl(lat: number, lon: number): string {
  const dLon = 0.006;
  const dLat = 0.003;
  const bbox = [lon - dLon, lat - dLat, lon + dLon, lat + dLat].map((value) => value.toFixed(5)).join(',');
  const params = new URLSearchParams({ bbox, layer: 'mapnik', marker: `${lat.toFixed(5)},${lon.toFixed(5)}` });
  return `https://www.openstreetmap.org/export/embed.html?${params.toString()}`;
}

/**
 * Ссылка в Яндекс Карты. С координатами: точка на карте. Без координат: поиск по адресу,
 * а если адреса нет, поиск по названию площадки и городу (готовая ссылка из API).
 */
export function yandexMapsUrl(venue: Venue): string {
  if (hasCoordinates(venue)) {
    const point = `${venue.lon.toFixed(5)},${venue.lat.toFixed(5)}`;
    const params = new URLSearchParams({ ll: point, pt: point, z: '16', l: 'map' });
    return `https://yandex.ru/maps/?${params.toString()}`;
  }
  if (venue.address) {
    return `https://yandex.ru/maps/?text=${encodeURIComponent(`${venue.city_name.ru}, ${venue.address}`)}`;
  }
  return venue.map_url;
}

// ---------------------------------------------------------------------------
// Доверие
// ---------------------------------------------------------------------------

/** Точное время проверки в поясе афиши: «12 ноября, 14:05». Одинаково на сервере и в браузере. */
export function checkedAtAbsolute(checkedAt: string, lang: Lang): string {
  const moment = new Date(checkedAt);
  if (Number.isNaN(moment.getTime())) return '';
  const local = localNow(moment);
  return `${formatDay(local.date, lang)}, ${local.time}`;
}

// ---------------------------------------------------------------------------
// Каталог
// ---------------------------------------------------------------------------

/**
 * Адрес каталога из параметра ?from=... (строка запроса каталога). Пропускает только известные
 * условия каталога: посторонний адрес в ссылку «назад» попасть не может.
 */
export function catalogHrefFromParam(from: string | undefined): string {
  if (!from) return CATALOG_PATH;
  const parsed = parseEventsQuery(new URLSearchParams(from.replace(/^\?/, '')));
  if (!parsed.ok) return CATALOG_PATH;
  const query = { ...parsed.value };
  delete query.page;
  delete query.page_size;
  return eventsHref(query);
}

/** Адрес каталога из адреса прошлой страницы, если это был каталог на этом же сайте. */
export function catalogHrefFromUrl(url: string, origin: string): string | null {
  try {
    const parsed = new URL(url, origin);
    if (parsed.origin !== origin || parsed.pathname.replace(/\/+$/, '') !== CATALOG_PATH) return null;
    return `${CATALOG_PATH}${parsed.search}`;
  } catch {
    return null;
  }
}

export function hasFilters(catalogHref: string): boolean {
  return catalogHref.includes('?');
}

// ---------------------------------------------------------------------------
// Ещё в этом городе
// ---------------------------------------------------------------------------

/** Сколько событий показывает блок «Ещё в этом городе». */
export const MORE_LIMIT = 4;

/** Строка блока «Ещё в этом городе»: только то, что нужно для ссылки на событие. */
export interface MoreItem {
  id: string;
  title: string;
  title_ba?: string;
  category: AfishaEvent['category'];
  image: string | null;
  venue_name: string;
  price_summary: PriceSummary;
  /** Ближайший подходящий сеанс: его дата и статус стоят в строке. */
  occurrence: Occurrence | null;
}

export function toMoreItem(item: EventListItem): MoreItem {
  return {
    id: item.id,
    title: item.title,
    ...(item.title_ba ? { title_ba: item.title_ba } : {}),
    category: item.category,
    image: item.image,
    venue_name: item.venue.name,
    price_summary: item.price_summary,
    occurrence:
      item.occurrences.find((occurrence) => occurrence.id === item.primary_occurrence_id) ??
      nearestSession(item.occurrences),
  };
}

/** Другие события того же города: без текущего, не больше MORE_LIMIT. */
export function pickMore(items: readonly EventListItem[], currentId: string): MoreItem[] {
  return items
    .filter((item) => item.id !== currentId)
    .slice(0, MORE_LIMIT)
    .map(toMoreItem);
}

export function eventPath(id: string): string {
  return `/events/${encodeURIComponent(id)}`;
}

// ---------------------------------------------------------------------------
// Картинка
// ---------------------------------------------------------------------------

/** Сведения о картинке из манифеста public/images: описание и автор снимка. */
export interface ImageMeta {
  alt: string;
  author: string | null;
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------
// Метаданные
// ---------------------------------------------------------------------------

function clip(text: string, limit: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= limit) return flat;
  const cut = flat.slice(0, limit - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,.;:]+$/, '')}…`;
}

/** Описание для поисковика и карточки ссылки: когда, где и первые слова описания. */
export function metaDescription(event: AfishaEvent, lang: Lang, today: string): string {
  const category = getCategory(event.category);
  const nearest = nearestSession(event.occurrences);
  const when = nearest
    ? nearest.start.precision === 'minute'
      ? formatTimeValue(nearest.start, lang)
      : formatOccurrence(nearest, lang, today)
    : null;
  const facts = [
    category ? pick(category.name_one, lang) : null,
    when,
    event.venue.name,
    pick(event.venue.city_name, lang),
  ].filter(Boolean);
  return clip(`${facts.join(', ')}. ${event.description}`, 180);
}
