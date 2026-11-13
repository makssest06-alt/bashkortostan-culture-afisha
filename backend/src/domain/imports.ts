import { randomUUID } from 'node:crypto';

import type { Database, QueryExecutor } from '../db/adapter.js';
import {
  CATEGORIES,
  CITIES,
  SEED_VENUES,
  findCity,
  parseCategoryAlias,
} from './dictionaries.js';
import {
  dedupKey,
  normalizeText,
  normalizeTitle,
  sha256,
  toVenueSlug,
  uuidFromCode,
} from './identity.js';
import { formatRfc3339Local, isValidHm, isValidYmd, TZ_OFFSET } from './time.js';
import type {
  AgeLimit,
  CategoryId,
  CityId,
  EventKind,
  EventStatus,
  ImportDisputed,
  ImportRejected,
  ImportReport,
  ImportRowResult,
  SourceType,
  TimePrecision,
} from './types.js';

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 5000;

export interface ImportOptions {
  format?: 'csv' | 'json';
  contentType?: string;
  bodyText: string;
  fileName?: string | null;
  actor?: string;
  now?: Date;
}

interface ParsedInputRow {
  rowNumber: number;
  raw: Record<string, unknown>;
}

const VALID_SOURCE_TYPES = new Set<SourceType>(['manual', 'import', 'rss', 'api', 'page']);
const VALID_KINDS = new Set<EventKind>(['standalone', 'performance_run', 'exhibition', 'festival']);
const VALID_AGES = new Set<number>([0, 6, 12, 16, 18]);

const COLUMN_ALIASES: Record<string, string> = {
  title: 'title',
  название: 'title',
  'название мероприятия': 'title',
  мероприятие: 'title',
  заголовок: 'title',

  title_ba: 'title_ba',

  category: 'category',
  категория: 'category',
  вид: 'category',

  city: 'city',
  city_id: 'city',
  город: 'city',
  'населенный пункт': 'city',
  'населённый пункт': 'city',

  venue: 'venue',
  площадка: 'venue',
  место: 'venue',
  'место проведения': 'venue',

  venue_id: 'venue_id',
  'код площадки': 'venue_id',

  address: 'address',
  адрес: 'address',

  lat: 'lat',
  lon: 'lon',

  date_start: 'date_start',
  date: 'date_start',
  дата: 'date_start',
  'дата начала': 'date_start',
  начало: 'date_start',

  date_end: 'date_end',
  'дата окончания': 'date_end',
  конец: 'date_end',

  time_start: 'time_start',
  time: 'time_start',
  время: 'time_start',
  'время начала': 'time_start',

  time_precision: 'time_precision',
  'точность времени': 'time_precision',

  duration_min: 'duration_min',
  длительность: 'duration_min',
  продолжительность: 'duration_min',

  price_min: 'price_min',
  price: 'price_min',
  цена: 'price_min',
  'цена от': 'price_min',
  стоимость: 'price_min',

  price_max: 'price_max',
  'цена до': 'price_max',

  is_free: 'is_free',
  free: 'is_free',
  бесплатно: 'is_free',

  age_limit: 'age_limit',
  age: 'age_limit',
  возраст: 'age_limit',
  'возрастное ограничение': 'age_limit',

  language: 'language',
  язык: 'language',

  kind: 'kind',
  формат: 'kind',

  description: 'description',
  описание: 'description',

  organizer: 'organizer',
  org_name: 'organizer',
  организатор: 'organizer',

  org_link: 'org_link',
  'ссылка организатора': 'org_link',
  билеты: 'org_link',
  'купить билет': 'org_link',

  source_url: 'source_url',
  url: 'source_url',
  источник: 'source_url',
  ссылка: 'source_url',
  'ссылка на источник': 'source_url',

  source_type: 'source_type',
  source_hash: 'source_hash',
  verified_at: 'verified_at',
  confidence: 'confidence',

  tags: 'tags',
  метки: 'tags',
  теги: 'tags',

  status: 'status',
  статус: 'status',

  synthetic: 'synthetic',
  демо: 'synthetic',

  image: 'image',
  image_url: 'image',
  обложка: 'image',
};

function detectDelimiter(headerLine: string): ',' | ';' {
  let commas = 0;
  let semis = 0;
  let inQuotes = false;
  for (let i = 0; i < headerLine.length; i += 1) {
    const ch = headerLine[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes) {
      if (ch === ',') commas += 1;
      else if (ch === ';') semis += 1;
    }
  }
  return semis > commas ? ';' : ',';
}

/** RFC 4180 CSV parser supporting `;` / `,`, quoted newlines and escaped `""`. */
export function parseCsvRecords(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, '');
  const firstBreak = text.search(/\r?\n/);
  const firstLine = firstBreak === -1 ? text : text.slice(0, firstBreak);
  const delimiter = detectDelimiter(firstLine);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\r') {
      if (text[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

function normalizeRawKeys(raw: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    const cleanKey = key.trim().toLowerCase().replace(/\s+/g, ' ');
    const mapped = COLUMN_ALIASES[cleanKey] ?? cleanKey;
    if (normalized[mapped] === undefined || normalized[mapped] === '') {
      normalized[mapped] = value;
    }
  }
  return normalized;
}

export function detectImportFormat(
  bodyText: string,
  fileName?: string | null,
  contentType = '',
): 'csv' | 'json' {
  const lowerCt = contentType.toLowerCase();
  const lowerName = (fileName ?? '').toLowerCase();
  if (lowerCt.includes('application/json') || lowerName.endsWith('.json')) return 'json';
  const trimmed = bodyText.replace(/^\uFEFF/, '').trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) return 'json';
  return 'csv';
}

export function parseImportPayload(
  bodyText: string,
  format: 'csv' | 'json',
): ParsedInputRow[] {
  const trimmed = bodyText.replace(/^\uFEFF/, '').trim();
  if (!trimmed) return [];

  if (format === 'json') {
    const parsed = JSON.parse(trimmed) as unknown;
    const list = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object'
        ? Array.isArray((parsed as { items?: unknown }).items)
          ? (parsed as { items: unknown[] }).items
          : Array.isArray((parsed as { events?: unknown }).events)
            ? (parsed as { events: unknown[] }).events
            : Array.isArray((parsed as { rows?: unknown }).rows)
              ? (parsed as { rows: unknown[] }).rows
              : null
        : null;
    if (!list) {
      throw new Error('JSON импорта должен быть массивом объектов или содержать поле items/events');
    }
    return list.map((item, idx) => ({
      rowNumber: idx + 1,
      raw:
        item && typeof item === 'object' && !Array.isArray(item)
          ? normalizeRawKeys(item as Record<string, unknown>)
          : {},
    }));
  }

  const matrix = parseCsvRecords(trimmed);
  if (matrix.length < 2) return [];
  const headers = matrix[0].map((h) => h.trim());
  const rows: ParsedInputRow[] = [];
  for (let i = 1; i < matrix.length; i += 1) {
    const cells = matrix[i];
    const obj: Record<string, unknown> = {};
    for (let c = 0; c < headers.length; c += 1) {
      if (!headers[c]) continue;
      obj[headers[c]] = (cells[c] ?? '').trim();
    }
    rows.push({
      rowNumber: i,
      raw: normalizeRawKeys(obj),
    });
  }
  return rows;
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function asNullableString(value: unknown): string | null {
  const s = asString(value);
  return s ? s : null;
}

function parseBool(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  const s = asString(value).toLowerCase();
  if (!s) return null;
  if (['true', '1', 'yes', 'да', 'бесплатно', 'free'].includes(s)) return true;
  if (['false', '0', 'no', 'нет', 'платно'].includes(s)) return false;
  return null;
}

function parseDateField(
  rawDate: string,
  rawTime: string,
): { ymd: string; hm: string | null; precision: TimePrecision } | null {
  if (!rawDate) return null;

  const isoMatch = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})?$/i.exec(rawDate);
  if (isoMatch) {
    const [, ymd, hm] = isoMatch;
    if (!isValidYmd(ymd) || !isValidHm(hm)) return null;
    if (rawTime && isValidHm(rawTime.slice(0, 5))) {
      return { ymd, hm: rawTime.slice(0, 5), precision: 'minute' };
    }
    const isMidnightWithoutTime = hm === '00:00' && !rawTime;
    return {
      ymd,
      hm: isMidnightWithoutTime ? null : hm,
      precision: isMidnightWithoutTime ? 'date' : 'minute',
    };
  }

  let ymd: string | null = null;
  if (isValidYmd(rawDate)) {
    ymd = rawDate;
  } else {
    const ruMatch = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(rawDate);
    if (ruMatch) {
      const candidate = `${ruMatch[3]}-${ruMatch[2]}-${ruMatch[1]}`;
      if (isValidYmd(candidate)) ymd = candidate;
    }
  }
  if (!ymd) return null;

  if (rawTime) {
    const cleanTime = rawTime.slice(0, 5);
    if (!isValidHm(cleanTime)) return null;
    return { ymd, hm: cleanTime, precision: 'minute' };
  }
  return { ymd, hm: null, precision: 'date' };
}

function parsePriceValue(value: unknown): { ok: true; value: number | null } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return { ok: false };
    return { ok: true, value: Math.round(value) };
  }
  const raw = asString(value).toLowerCase();
  if (!raw || raw === 'неизвестно' || raw === 'unknown' || raw === 'null' || raw === '-') {
    return { ok: true, value: null };
  }
  if (raw === 'бесплатно' || raw === 'free' || raw === 'вход свободный') {
    return { ok: true, value: 0 };
  }
  const cleaned = raw.replace(/\s+/g, '').replace(/(₽|руб\.?|р\.?)$/i, '');
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return { ok: false };
  const num = Number(cleaned);
  if (!Number.isFinite(num) || num < 0) return { ok: false };
  return { ok: true, value: Math.round(num) };
}

function parseAgeValue(value: unknown): { ok: true; value: AgeLimit | null } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || !VALID_AGES.has(value)) return { ok: false };
    return { ok: true, value: value as AgeLimit };
  }
  const raw = asString(value).toLowerCase().replace(/\+$/, '').trim();
  if (!raw || raw === 'неизвестно' || raw === 'unknown' || raw === 'null' || raw === '-') {
    return { ok: true, value: null };
  }
  if (!/^\d+$/.test(raw)) return { ok: false };
  const num = Number(raw);
  if (!VALID_AGES.has(num)) return { ok: false };
  return { ok: true, value: num as AgeLimit };
}

function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function parseCityInput(rawCity: string): { slug: CityId; name: string } | null {
  const norm = normalizeText(rawCity)
    .replace(/^(г\.|город|с\.|село)\s+/u, '')
    .trim();
  if (!norm) return null;
  const direct = findCity(norm);
  if (direct) return { slug: direct.slug, name: direct.name.ru };

  const stripped = norm.replace(/[еуаиы]$/u, '');
  for (const city of CITIES) {
    const ruNorm = normalizeText(city.name.ru);
    if (ruNorm === norm || (stripped.length >= 3 && ruNorm.startsWith(stripped))) {
      return { slug: city.slug, name: city.name.ru };
    }
  }
  return null;
}

function parseTags(rawTags: unknown): string[] {
  if (Array.isArray(rawTags)) {
    return rawTags.map((t) => String(t).trim()).filter(Boolean).slice(0, 12);
  }
  const str = asString(rawTags);
  if (!str) return [];
  return str
    .split(/[,;|]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 12);
}

interface NormalizedRow {
  rowNumber: number;
  eventId: string;
  occurrenceId: string;
  offerId: string;
  title: string;
  normalizedTitle: string;
  titleBa: string | null;
  description: string;
  category: CategoryId;
  tags: string[];
  ymdStart: string;
  dateStart: string;
  dateEnd: string | null;
  durationMin: number | null;
  timePrecision: TimePrecision;
  citySlug: CityId;
  cityName: string;
  venueId: string;
  venue: string;
  address: string | null;
  lat: number | null;
  lon: number | null;
  priceMin: number | null;
  priceMax: number | null;
  isFree: boolean;
  ageLimit: AgeLimit | null;
  language: string | null;
  orgLink: string | null;
  sourceUrl: string;
  sourceType: SourceType;
  sourceHash: string;
  verifiedAt: string | null;
  confidence: number;
  status: EventStatus;
  dedup: string;
  kind: EventKind;
  popularity: number;
  organizer: string | null;
  image: string | null;
  synthetic: boolean;
  disputed: boolean;
  reviewReasons: string[];
  rawPayload: Record<string, unknown>;
}

function validateAndNormalizeRow(
  row: ParsedInputRow,
): { ok: true; value: NormalizedRow } | { ok: false; rejected: ImportRejected } {
  const { raw, rowNumber } = row;
  const providedHash = asString(raw.source_hash).toLowerCase();
  const validProvidedHash = /^[a-f0-9]{64}$/.test(providedHash) ? providedHash : undefined;

  const title = asString(raw.title);
  if (!title) {
    return {
      ok: false,
      rejected: {
        row: rowNumber,
        ...(validProvidedHash ? { source_hash: validProvidedHash } : {}),
        reason_code: 'missing_field',
        reason: 'У события отсутствует обязательное поле «title» (название)',
      },
    };
  }

  const rawCity = asString(raw.city);
  const city = parseCityInput(rawCity);
  if (!city) {
    return {
      ok: false,
      rejected: {
        row: rowNumber,
        ...(validProvidedHash ? { source_hash: validProvidedHash } : {}),
        reason_code: rawCity ? 'unknown_city' : 'missing_field',
        reason: rawCity
          ? `Город «${rawCity}» не найден в справочнике Башкортостана`
          : 'Не указан обязательный город проведения',
      },
    };
  }

  const rawCat = asString(raw.category);
  const parsedCategory = rawCat ? parseCategoryAlias(rawCat) : null;
  if (!rawCat) {
    return {
      ok: false,
      rejected: {
        row: rowNumber,
        ...(validProvidedHash ? { source_hash: validProvidedHash } : {}),
        reason_code: 'missing_field',
        reason: 'Не указана категория события',
      },
    };
  }
  if (!parsedCategory) {
    return {
      ok: false,
      rejected: {
        row: rowNumber,
        ...(validProvidedHash ? { source_hash: validProvidedHash } : {}),
        reason_code: 'invalid_category',
        reason: `Неизвестная категория «${rawCat}» (допустимо: ${CATEGORIES.map((c) => c.id).join(', ')})`,
      },
    };
  }

  const rawDate = asString(raw.date_start);
  const rawTime = asString(raw.time_start);
  const dateParsed = parseDateField(rawDate, rawTime);
  if (!dateParsed) {
    return {
      ok: false,
      rejected: {
        row: rowNumber,
        ...(validProvidedHash ? { source_hash: validProvidedHash } : {}),
        reason_code: rawDate ? 'invalid_date' : 'missing_field',
        reason: rawDate
          ? `Не удалось распознать дату начала: «${rawDate}»`
          : 'Не указана дата начала события',
      },
    };
  }

  const explicitPrecision = asString(raw.time_precision);
  const timePrecision: TimePrecision =
    explicitPrecision === 'date' || explicitPrecision === 'minute'
      ? explicitPrecision
      : dateParsed.precision;
  const dateStart =
    timePrecision === 'date'
      ? `${dateParsed.ymd}T00:00:00${TZ_OFFSET}`
      : `${dateParsed.ymd}T${dateParsed.hm ?? '00:00'}:00${TZ_OFFSET}`;

  let dateEnd: string | null = null;
  const rawEnd = asString(raw.date_end);
  if (rawEnd) {
    const parsedEnd = parseDateField(rawEnd, '');
    if (!parsedEnd) {
      return {
        ok: false,
        rejected: {
          row: rowNumber,
          ...(validProvidedHash ? { source_hash: validProvidedHash } : {}),
          reason_code: 'invalid_date',
          reason: `Некорректная дата окончания: «${rawEnd}»`,
        },
      };
    }
    dateEnd =
      parsedEnd.precision === 'date'
        ? `${parsedEnd.ymd}T00:00:00${TZ_OFFSET}`
        : `${parsedEnd.ymd}T${parsedEnd.hm ?? '23:59'}:00${TZ_OFFSET}`;
  }

  const rawVenue = asNullableString(raw.venue);
  const rawVenueId = asNullableString(raw.venue_id);
  if (!rawVenue && !rawVenueId) {
    return {
      ok: false,
      rejected: {
        row: rowNumber,
        ...(validProvidedHash ? { source_hash: validProvidedHash } : {}),
        reason_code: 'missing_field',
        reason: 'Не указана площадка проведения (venue)',
      },
    };
  }

  const sourceUrlRaw = asString(raw.source_url);
  if (!sourceUrlRaw || !isHttpUrl(sourceUrlRaw)) {
    return {
      ok: false,
      rejected: {
        row: rowNumber,
        ...(validProvidedHash ? { source_hash: validProvidedHash } : {}),
        reason_code: sourceUrlRaw ? 'invalid_url' : 'missing_field',
        reason: sourceUrlRaw
          ? 'Некорректная ссылка на источник (ожидается http:// или https://)'
          : 'Не указана ссылка на источник (source_url)',
      },
    };
  }

  const orgLinkRaw = asNullableString(raw.org_link);
  if (orgLinkRaw && !isHttpUrl(orgLinkRaw)) {
    return {
      ok: false,
      rejected: {
        row: rowNumber,
        ...(validProvidedHash ? { source_hash: validProvidedHash } : {}),
        reason_code: 'invalid_url',
        reason: 'Некорректная ссылка организатора (org_link)',
      },
    };
  }

  const priceMinParsed = parsePriceValue(raw.price_min);
  const priceMaxParsed = parsePriceValue(raw.price_max);
  if (!priceMinParsed.ok || !priceMaxParsed.ok) {
    return {
      ok: false,
      rejected: {
        row: rowNumber,
        ...(validProvidedHash ? { source_hash: validProvidedHash } : {}),
        reason_code: 'invalid_price',
        reason: 'Некорректная цена билета (должна быть неотрицательным числом)',
      },
    };
  }

  let priceMin = priceMinParsed.value;
  let priceMax = priceMaxParsed.value;
  const boolFree = parseBool(raw.is_free);
  let isFree = false;
  if (boolFree === true) {
    if (priceMin !== null && priceMin > 0) {
      return {
        ok: false,
        rejected: {
          row: rowNumber,
          ...(validProvidedHash ? { source_hash: validProvidedHash } : {}),
          reason_code: 'invalid_price',
          reason: 'Противоречие: is_free=true при ненулевой цене',
        },
      };
    }
    priceMin = 0;
    priceMax = 0;
    isFree = true;
  } else if (priceMin !== null) {
    if (priceMax === null) priceMax = priceMin;
    if (priceMax < priceMin) {
      return {
        ok: false,
        rejected: {
          row: rowNumber,
          ...(validProvidedHash ? { source_hash: validProvidedHash } : {}),
          reason_code: 'invalid_price',
          reason: 'Максимальная цена меньше минимальной',
        },
      };
    }
    isFree = priceMin === 0 && priceMax === 0;
  }

  const ageParsed = parseAgeValue(raw.age_limit);
  if (!ageParsed.ok) {
    return {
      ok: false,
      rejected: {
        row: rowNumber,
        ...(validProvidedHash ? { source_hash: validProvidedHash } : {}),
        reason_code: 'invalid_age_limit',
        reason: 'Недопустимое возрастное ограничение (разрешено 0, 6, 12, 16, 18)',
      },
    };
  }
  const ageLimit = ageParsed.value;

  const matchedVenue = SEED_VENUES.find(
    (v) =>
      v.city === city.slug &&
      ((rawVenueId && (v.id === rawVenueId || v.legacy_id === rawVenueId)) ||
        (rawVenue && normalizeText(v.name) === normalizeText(rawVenue))),
  );

  const venue = matchedVenue?.name ?? rawVenue ?? rawVenueId!;
  const venueId =
    matchedVenue?.id ??
    toVenueSlug(rawVenueId ?? `ven-${city.slug}-${sha256(normalizeText(venue)).slice(0, 8)}`);
  const address = asNullableString(raw.address) ?? matchedVenue?.address ?? null;

  const latRaw = typeof raw.lat === 'number' ? raw.lat : Number(asString(raw.lat));
  const lonRaw = typeof raw.lon === 'number' ? raw.lon : Number(asString(raw.lon));
  const lat =
    asString(raw.lat) !== '' && Number.isFinite(latRaw) && latRaw >= -90 && latRaw <= 90
      ? latRaw
      : (matchedVenue?.lat ?? null);
  const lon =
    asString(raw.lon) !== '' && Number.isFinite(lonRaw) && lonRaw >= -180 && lonRaw <= 180
      ? lonRaw
      : (matchedVenue?.lon ?? null);

  const description = asString(raw.description);
  const reviewReasons: string[] = [];
  if (priceMin === null) reviewReasons.push('price_unknown');
  if (ageLimit === null) reviewReasons.push('age_unknown');
  if (!matchedVenue) reviewReasons.push('venue_unmatched');
  if (description.length < 15) reviewReasons.push('missing_description');

  const disputed = reviewReasons.length > 0;
  const rawStatus = asString(raw.status);
  const status: EventStatus =
    rawStatus === 'cancelled'
      ? 'cancelled'
      : rawStatus === 'draft' || disputed
        ? 'draft'
        : 'published';

  const durationNum = Number(asString(raw.duration_min));
  const durationMin = Number.isInteger(durationNum) && durationNum >= 1 ? durationNum : null;

  const rawLang = asString(raw.language).toLowerCase();
  const language = /^[a-z]{2,3}$/.test(rawLang) ? rawLang : null;

  const rawSourceType = asString(raw.source_type) as SourceType;
  const sourceType: SourceType = VALID_SOURCE_TYPES.has(rawSourceType) ? rawSourceType : 'import';

  const rawKind = asString(raw.kind) as EventKind;
  const kind: EventKind = VALID_KINDS.has(rawKind) ? rawKind : 'standalone';

  const confRaw = Number(asString(raw.confidence));
  const confidence =
    asString(raw.confidence) !== '' && Number.isFinite(confRaw) && confRaw >= 0 && confRaw <= 1
      ? confRaw
      : disputed
        ? 0.65
        : 0.95;

  const normalized = normalizeTitle(title);
  const dedup = dedupKey(normalized, dateParsed.ymd, venueId);
  const sourceHash =
    validProvidedHash ??
    sha256(
      JSON.stringify({
        title,
        category: parsedCategory,
        city: city.slug,
        venueId,
        dateStart,
        dateEnd,
        priceMin,
        priceMax,
        isFree,
        ageLimit,
        description,
        orgLink: orgLinkRaw,
        sourceUrl: sourceUrlRaw,
        status,
      }),
    );

  const eventId = uuidFromCode(`imp:${sourceUrlRaw}:${sourceHash}`);
  const synthetic = parseBool(raw.synthetic) ?? true;
  const tags = parseTags(raw.tags);
  if (isFree && !tags.includes('бесплатно')) tags.push('бесплатно');

  return {
    ok: true,
    value: {
      rowNumber,
      eventId,
      occurrenceId: `occ_${eventId.replace(/-/g, '').slice(0, 12)}_1`,
      offerId: `off_${eventId.replace(/-/g, '').slice(0, 12)}_1`,
      title,
      normalizedTitle: normalized,
      titleBa: asNullableString(raw.title_ba),
      description,
      category: parsedCategory,
      tags,
      ymdStart: dateParsed.ymd,
      dateStart,
      dateEnd,
      durationMin,
      timePrecision,
      citySlug: city.slug,
      cityName: city.name,
      venueId,
      venue,
      address,
      lat,
      lon,
      priceMin,
      priceMax,
      isFree,
      ageLimit,
      language,
      orgLink: orgLinkRaw,
      sourceUrl: sourceUrlRaw,
      sourceType,
      sourceHash,
      verifiedAt: asNullableString(raw.verified_at),
      confidence,
      status,
      dedup,
      kind,
      popularity: 30,
      organizer: asNullableString(raw.organizer),
      image: asNullableString(raw.image),
      synthetic,
      disputed,
      reviewReasons,
      rawPayload: raw,
    },
  };
}

async function resolveCanonicalEventId(tx: QueryExecutor, eventId: string): Promise<string> {
  let current = eventId;
  for (let i = 0; i < 5; i += 1) {
    const res = await tx.query<{ merged_into: string | null }>(
      'SELECT merged_into FROM events WHERE id = $1',
      [current],
    );
    const next = res.rows[0]?.merged_into ?? null;
    if (!next) return current;
    current = next;
  }
  return current;
}

async function ensureVenueExists(tx: QueryExecutor, row: NormalizedRow): Promise<void> {
  await tx.query(
    `INSERT INTO venues (id, city_slug, name, address, lat, lon)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO NOTHING`,
    [row.venueId, row.citySlug, row.venue, row.address, row.lat, row.lon],
  );
}

async function insertImportedEvent(
  tx: QueryExecutor,
  row: NormalizedRow,
  importId: string,
  nowIso: string,
): Promise<void> {
  await ensureVenueExists(tx, row);

  await tx.query(
    `INSERT INTO events (
      id, title, normalized_title, title_ba, description, category, tags,
      date_start, date_end, duration_min, time_precision,
      city_id, city, venue_id, venue, address, lat, lon,
      price_min, price_max, is_free, age_limit, language, org_link,
      source_url, source_type, source_hash, verified_at, confidence, status, dedup_key,
      kind, popularity, organizer, image, synthetic, disputed, review_reasons,
      import_id, created_at, updated_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7::jsonb,
      $8,$9,$10,$11,
      $12,$13,$14,$15,$16,$17,$18,
      $19,$20,$21,$22,$23,$24,
      $25,$26,$27,$28,$29,$30,$31,
      $32,$33,$34,$35,$36,$37,$38::jsonb,
      $39,$40,$41
    )`,
    [
      row.eventId,
      row.title,
      row.normalizedTitle,
      row.titleBa,
      row.description,
      row.category,
      JSON.stringify(row.tags),
      row.dateStart,
      row.dateEnd,
      row.durationMin,
      row.timePrecision,
      row.citySlug,
      row.cityName,
      row.venueId,
      row.venue,
      row.address,
      row.lat,
      row.lon,
      row.priceMin,
      row.priceMax,
      row.isFree,
      row.ageLimit,
      row.language,
      row.orgLink,
      row.sourceUrl,
      row.sourceType,
      row.sourceHash,
      row.verifiedAt,
      row.confidence,
      row.status,
      row.dedup,
      row.kind,
      row.popularity,
      row.organizer,
      row.image,
      row.synthetic,
      row.disputed,
      JSON.stringify(row.reviewReasons),
      importId,
      nowIso,
      nowIso,
    ],
  );

  await tx.query(
    `INSERT INTO event_occurrences (
      id, event_id, venue_id, date_start, date_end, time_precision,
      status, status_verified, previous_date_start, availability, sort_order
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL,$9,0)`,
    [
      row.occurrenceId,
      row.eventId,
      row.venueId,
      row.dateStart,
      row.dateEnd,
      row.timePrecision,
      row.status === 'cancelled' ? 'cancelled' : 'scheduled',
      Boolean(row.verifiedAt),
      'available',
    ],
  );

  if (row.isFree || row.priceMin !== null) {
    await tx.query(
      `INSERT INTO event_offers (id, event_id, name, price, audience, is_free, sort_order)
       VALUES ($1,$2,$3,$4,'adult',$5,0)`,
      [
        row.offerId,
        row.eventId,
        row.isFree ? 'Бесплатный вход' : 'Стандартный билет',
        row.isFree ? 0 : row.priceMin,
        row.isFree,
      ],
    );
  }

  await tx.query(
    `INSERT INTO event_sources (event_id, source_url, source_type, source_hash, verified_at, title, is_primary)
     VALUES ($1,$2,$3,$4,$5,$6,TRUE)
     ON CONFLICT (event_id, source_hash) DO NOTHING`,
    [row.eventId, row.sourceUrl, row.sourceType, row.sourceHash, row.verifiedAt, row.organizer ?? row.sourceUrl],
  );
}

async function applyEventUpdateOrMerge(
  tx: QueryExecutor,
  targetId: string,
  row: NormalizedRow,
  importId: string,
  nowIso: string,
  mergeOnly: boolean,
): Promise<void> {
  await ensureVenueExists(tx, row);

  if (mergeOnly) {
    await tx.query(
      `UPDATE events SET
         description = CASE WHEN description = '' THEN $2 ELSE description END,
         address = COALESCE(address, $3),
         price_min = COALESCE(price_min, $4),
         price_max = COALESCE(price_max, $5),
         is_free = is_free OR ($6 AND price_min IS NULL),
         age_limit = COALESCE(age_limit, $7),
         organizer = COALESCE(organizer, $8),
         org_link = COALESCE(org_link, $9),
         updated_at = $10
       WHERE id = $1`,
      [
        targetId,
        row.description,
        row.address,
        row.priceMin,
        row.priceMax,
        row.isFree,
        row.ageLimit,
        row.organizer,
        row.orgLink,
        nowIso,
      ],
    );
  } else {
    await tx.query(
      `UPDATE events SET
         title = $2,
         normalized_title = $3,
         title_ba = COALESCE($4, title_ba),
         description = $5,
         category = $6,
         tags = $7::jsonb,
         date_start = $8,
         date_end = $9,
         duration_min = $10,
         time_precision = $11,
         venue_id = $12,
         venue = $13,
         address = $14,
         price_min = $15,
         price_max = $16,
         is_free = $17,
         age_limit = $18,
         language = $19,
         org_link = $20,
         source_url = $21,
         source_hash = $22,
         status = $23,
         disputed = $24,
         review_reasons = $25::jsonb,
         dedup_key = $26,
         import_id = $27,
         updated_at = $28
       WHERE id = $1`,
      [
        targetId,
        row.title,
        row.normalizedTitle,
        row.titleBa,
        row.description,
        row.category,
        JSON.stringify(row.tags),
        row.dateStart,
        row.dateEnd,
        row.durationMin,
        row.timePrecision,
        row.venueId,
        row.venue,
        row.address,
        row.priceMin,
        row.priceMax,
        row.isFree,
        row.ageLimit,
        row.language,
        row.orgLink,
        row.sourceUrl,
        row.sourceHash,
        row.status,
        row.disputed,
        JSON.stringify(row.reviewReasons),
        row.dedup,
        importId,
        nowIso,
      ],
    );

    await tx.query('DELETE FROM event_occurrences WHERE event_id = $1', [targetId]);
    await tx.query(
      `INSERT INTO event_occurrences (
        id, event_id, venue_id, date_start, date_end, time_precision,
        status, status_verified, previous_date_start, availability, sort_order
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL,'available',0)`,
      [
        `occ_${targetId.replace(/-/g, '').slice(0, 12)}_1`,
        targetId,
        row.venueId,
        row.dateStart,
        row.dateEnd,
        row.timePrecision,
        row.status === 'cancelled' ? 'cancelled' : 'scheduled',
        Boolean(row.verifiedAt),
      ],
    );

    if (row.isFree || row.priceMin !== null) {
      await tx.query('DELETE FROM event_offers WHERE event_id = $1', [targetId]);
      await tx.query(
        `INSERT INTO event_offers (id, event_id, name, price, audience, is_free, sort_order)
         VALUES ($1,$2,$3,$4,'adult',$5,0)`,
        [
          `off_${targetId.replace(/-/g, '').slice(0, 12)}_1`,
          targetId,
          row.isFree ? 'Бесплатный вход' : 'Стандартный билет',
          row.isFree ? 0 : row.priceMin,
          row.isFree,
        ],
      );
    }
  }

  await tx.query(
    `INSERT INTO event_sources (event_id, source_url, source_type, source_hash, verified_at, title, is_primary)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (event_id, source_hash) DO NOTHING`,
    [targetId, row.sourceUrl, row.sourceType, row.sourceHash, row.verifiedAt, row.organizer ?? row.sourceUrl, !mergeOnly],
  );
}

export async function runImport(db: Database, options: ImportOptions): Promise<ImportReport> {
  const now = options.now ?? new Date();
  const nowIso = formatRfc3339Local(now);
  const format = options.format ?? detectImportFormat(options.bodyText, options.fileName, options.contentType);
  const parsedRows = parseImportPayload(options.bodyText, format);

  if (parsedRows.length > MAX_IMPORT_ROWS) {
    throw new Error(`Слишком много строк: ${parsedRows.length}. Лимит импорта — ${MAX_IMPORT_ROWS} записей.`);
  }

  const importId = randomUUID();
  const actor = options.actor ?? 'moderator:demo';
  const fileName = options.fileName ?? null;

  const rejected: ImportRejected[] = [];
  const disputedList: ImportDisputed[] = [];
  const rows: ImportRowResult[] = [];

  let added = 0;
  let updated = 0;
  let merged = 0;
  let unchanged = 0;

  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO imports (id, created_at, actor, format, file_name, received, added, updated, merged, unchanged)
       VALUES ($1,$2,$3,$4,$5,$6,0,0,0,0)`,
      [importId, nowIso, actor, format, fileName, parsedRows.length],
    );

    for (const parsedRow of parsedRows) {
      const checked = validateAndNormalizeRow(parsedRow);
      if (!checked.ok) {
        rejected.push(checked.rejected);
        continue;
      }

      const item = checked.value;
      const hashMatch = await tx.query<{ id: string; merged_into: string | null }>(
        `SELECT id, merged_into FROM events WHERE source_hash = $1
         UNION
         SELECT e.id, e.merged_into FROM event_sources s JOIN events e ON e.id = s.event_id WHERE s.source_hash = $1
         LIMIT 1`,
        [item.sourceHash],
      );

      let targetEventId: string;
      let outcome: ImportRowResult['outcome'];
      let note: string;

      if (hashMatch.rows.length > 0) {
        targetEventId = hashMatch.rows[0].merged_into
          ? await resolveCanonicalEventId(tx, hashMatch.rows[0].merged_into)
          : hashMatch.rows[0].id;
        outcome = 'unchanged';
        note = 'Совпадает с уже загруженной версией по source_hash';
        unchanged += 1;
      } else {
        const dedupMatch = await tx.query<{ id: string; source_url: string }>(
          'SELECT id, source_url FROM events WHERE dedup_key = $1 AND merged_into IS NULL LIMIT 1',
          [item.dedup],
        );

        if (dedupMatch.rows.length > 0) {
          targetEventId = dedupMatch.rows[0].id;
          const isSameSource = dedupMatch.rows[0].source_url === item.sourceUrl;
          await applyEventUpdateOrMerge(tx, targetEventId, item, importId, nowIso, !isSameSource);
          if (isSameSource) {
            outcome = 'updated';
            note = 'Карточка обновлена по совпадению ключа и источника';
          } else {
            outcome = 'merged';
            note = 'Слито с существующим событием по названию, дате и площадке';
            merged += 1;
          }
          // Инвариант OpenAPI: received = added + updated + unchanged + rejected.length
          updated += 1;
        } else {
          targetEventId = item.eventId;
          await insertImportedEvent(tx, item, importId, nowIso);
          outcome = 'added';
          note = item.disputed ? 'Черновик отправлен на модерацию' : 'Опубликовано в каталоге';
          added += 1;
        }

        await tx.query(
          `INSERT INTO raw_records (id, import_id, event_id, source_url, source_type, source_hash, raw_payload, fetched_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
          [
            randomUUID(),
            importId,
            targetEventId,
            item.sourceUrl,
            item.sourceType,
            item.sourceHash,
            JSON.stringify(item.rawPayload),
            nowIso,
          ],
        );

        if (item.disputed) {
          disputedList.push({
            row: item.rowNumber,
            id: targetEventId,
            title: item.title,
            reasons: item.reviewReasons,
          });
        }
      }

      rows.push({
        row: item.rowNumber,
        id: targetEventId,
        title: item.title,
        outcome,
        note,
      });
    }

    await tx.query(
      `UPDATE imports SET
         added = $2,
         updated = $3,
         merged = $4,
         unchanged = $5,
         rejected = $6::jsonb,
         disputed = $7::jsonb,
         rows = $8::jsonb
       WHERE id = $1`,
      [
        importId,
        added,
        updated,
        merged,
        unchanged,
        JSON.stringify(rejected),
        JSON.stringify(disputedList),
        JSON.stringify(rows),
      ],
    );

    await tx.query(
      `INSERT INTO audit_log (id, at, actor, action, entity_type, entity_id, entity_title, changes, import_id, note)
       VALUES ($1,$2,$3,'import','import',$4,$5,$6::jsonb,$7,$8)`,
      [
        randomUUID(),
        nowIso,
        actor,
        importId,
        fileName ?? `import-${format}`,
        JSON.stringify([
          { field: 'added', from: 0, to: added },
          { field: 'updated', from: 0, to: updated },
          { field: 'unchanged', from: 0, to: unchanged },
          { field: 'rejected', from: 0, to: rejected.length },
        ]),
        importId,
        `Получено ${parsedRows.length}, добавлено ${added}, обновлено ${updated}, слияний ${merged}, без изменений ${unchanged}, отклонено ${rejected.length}`,
      ],
    );
  });

  return {
    import_id: importId,
    at: nowIso,
    actor,
    file_name: fileName,
    format,
    received: parsedRows.length,
    added,
    updated,
    merged,
    unchanged,
    rejected,
    disputed: disputedList,
    rows,
  };
}

interface ImportRowDb {
  id: string;
  created_at: Date | string;
  actor: string;
  format: 'csv' | 'json';
  file_name: string | null;
  received: number;
  added: number;
  updated: number;
  merged: number;
  unchanged: number;
  rejected: ImportRejected[] | string;
  disputed: ImportDisputed[] | string;
  rows: ImportRowResult[] | string;
}

function parseJsonCol<T>(val: T[] | string): T[] {
  if (Array.isArray(val)) return val;
  try {
    const parsed = JSON.parse(val);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export async function listImports(db: Database, limit = 50): Promise<ImportReport[]> {
  const res = await db.query<ImportRowDb>(
    'SELECT * FROM imports ORDER BY created_at DESC LIMIT $1',
    [limit],
  );
  return res.rows.map((r) => ({
    import_id: r.id,
    at: r.created_at instanceof Date ? formatRfc3339Local(r.created_at) : String(r.created_at),
    actor: r.actor,
    file_name: r.file_name,
    format: r.format,
    received: Number(r.received),
    added: Number(r.added),
    updated: Number(r.updated),
    merged: Number(r.merged),
    unchanged: Number(r.unchanged),
    rejected: parseJsonCol<ImportRejected>(r.rejected),
    disputed: parseJsonCol<ImportDisputed>(r.disputed),
    rows: parseJsonCol<ImportRowResult>(r.rows),
  }));
}
