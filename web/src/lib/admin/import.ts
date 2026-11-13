/**
 * Импорт событий из CSV и JSON (п. 6.1): разбор файла, проверка каждой строки,
 * дедупликация и план изменений с отчётом «добавлено, обновлено, отклонено и почему».
 *
 * Повторная загрузка того же файла ничего не меняет: каждая строка получает
 * source_hash (sha256 исходной записи), и запись с тем же хешем считается уже загруженной.
 * Одно и то же событие из другого источника (тот же dedup_key: название, дата, площадка)
 * не создаёт дубль, а добавляет источник к существующей карточке.
 *
 * Модуль чистый: состояние хранилища приходит в аргументах, сам он ничего не пишет.
 */

import { getCity } from '../../data/dictionaries';
import { dedupKey, normalizeTitle, sha256, uuidFromCode } from '../api/identity';
import { normalizeText } from '../api/text';
import type { EventSource, Venue } from '../api/types';
import type { FieldChange, ImportChanged, ImportDisputed, ImportRejected, ImportReport, StoredRecord } from './types';
import {
  isBlank,
  parseAgeLimit,
  parseBoolean,
  parseCategory,
  parseCity,
  parseDateTime,
  parseDescription,
  parseLanguage,
  parseNumber,
  parsePrice,
  parseStatus,
  parseTags,
  parseTitle,
  parseUrl,
} from './validate';
import type { Parsed } from './validate';

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 2000;

/** Пространство имён для UUID импортированных записей. */
const IMPORT_NAMESPACE = '2b7d9c41-8e3f-4a52-b6d0-7f1e2a3c4d5e';

// ---------------------------------------------------------------------------
// Разбор файла
// ---------------------------------------------------------------------------

/** CSV по RFC 4180: кавычки, запятые и переводы строк внутри кавычек. Разделитель , или ; определяется по заголовку. */
export function parseCsv(input: string): string[][] {
  const source = input.replace(/^﻿/, '');
  const firstLine = source.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"' && field === '') quoted = true;
    else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i += 1;
      row.push(field);
      if (row.some((cell) => cell.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  row.push(field);
  if (row.some((cell) => cell.trim() !== '')) rows.push(row);
  return rows;
}

/** Русские заголовки колонок, которыми пишут файлы учреждений, в имена полей п. 8.1. */
const COLUMN_ALIASES: Record<string, string> = {
  название: 'title',
  категория: 'category',
  метки: 'tags',
  теги: 'tags',
  начало: 'date_start',
  дата: 'date_start',
  дата_начала: 'date_start',
  окончание: 'date_end',
  дата_окончания: 'date_end',
  длительность: 'duration_min',
  город: 'city',
  площадка: 'venue',
  адрес: 'address',
  широта: 'lat',
  долгота: 'lon',
  описание: 'description',
  цена: 'price',
  цена_от: 'price_min',
  цена_до: 'price_max',
  бесплатно: 'is_free',
  возраст: 'age_limit',
  язык: 'language',
  билеты: 'org_link',
  ссылка_на_билеты: 'org_link',
  источник: 'source_url',
  ссылка: 'source_url',
  статус: 'status',
  уверенность: 'confidence',
  внешний_id: 'external_id',
};

function columnName(header: string): string {
  const key = normalizeText(header).replace(/\s+/g, '_');
  return COLUMN_ALIASES[key] ?? key;
}

export type RawRow = { row: number; data: Record<string, unknown> };

export type ParseFileResult =
  | { ok: true; format: 'csv' | 'json'; rows: RawRow[] }
  | { ok: false; code: string; message: string };

/** Формат по имени файла или по содержимому: JSON начинается с [ или {. */
export function detectFormat(text: string, fileName?: string | null, contentType?: string | null): 'csv' | 'json' {
  if (fileName?.toLowerCase().endsWith('.json') || contentType?.includes('json')) return 'json';
  if (fileName?.toLowerCase().endsWith('.csv') || contentType?.includes('csv')) return 'csv';
  return /^\s*[[{]/.test(text.replace(/^﻿/, '')) ? 'json' : 'csv';
}

export function parseImportFile(text: string, format: 'csv' | 'json'): ParseFileResult {
  if (!text.trim()) return { ok: false, code: 'empty_file', message: 'Файл пустой' };
  if (format === 'json') {
    let data: unknown;
    try {
      data = JSON.parse(text.replace(/^﻿/, ''));
    } catch {
      return { ok: false, code: 'invalid_json', message: 'Файл не разбирается как JSON. Проверьте запятые и кавычки' };
    }
    const list = Array.isArray(data) ? data : (data as { events?: unknown })?.events;
    if (!Array.isArray(list)) {
      return { ok: false, code: 'invalid_json', message: 'В JSON ожидается массив событий или объект { "events": [...] }' };
    }
    if (list.length > MAX_IMPORT_ROWS) {
      return { ok: false, code: 'too_many_rows', message: `В файле больше ${MAX_IMPORT_ROWS} событий. Разбейте его на части` };
    }
    return {
      ok: true,
      format,
      rows: list.map((item, index) => ({
        row: index + 1,
        data: typeof item === 'object' && item !== null && !Array.isArray(item) ? (item as Record<string, unknown>) : { __invalid: true },
      })),
    };
  }

  const table = parseCsv(text);
  if (table.length < 2) return { ok: false, code: 'empty_file', message: 'В CSV нет строк с событиями: нужен заголовок и хотя бы одна строка' };
  if (table.length - 1 > MAX_IMPORT_ROWS) {
    return { ok: false, code: 'too_many_rows', message: `В файле больше ${MAX_IMPORT_ROWS} событий. Разбейте его на части` };
  }
  const header = table[0].map(columnName);
  if (!header.includes('title')) {
    return { ok: false, code: 'no_title_column', message: 'В заголовке CSV нет колонки title (или «название»)' };
  }
  return {
    ok: true,
    format,
    rows: table.slice(1).map((cells, index) => {
      const data: Record<string, unknown> = {};
      header.forEach((name, column) => {
        if (name) data[name] = cells[column] ?? '';
      });
      return { row: index + 2, data };
    }),
  };
}

// ---------------------------------------------------------------------------
// Проверка строки
// ---------------------------------------------------------------------------

/** Хеш исходной записи: те же значения в любом порядке колонок дают тот же хеш. */
export function rowHash(data: Record<string, unknown>): string {
  const keys = Object.keys(data)
    .filter((key) => !key.startsWith('__'))
    .sort();
  const canonical = keys.map((key) => [columnName(key), isBlank(data[key]) ? '' : String(data[key]).trim()]);
  return sha256(JSON.stringify(canonical));
}

export interface ImportContext {
  now: Date;
  actor: string;
  importId: string;
  /** Известные площадки справочника. */
  venues: readonly Venue[];
  /** Все события каталога (демо и записи) для дедупликации. */
  events: readonly { id: string; kind: 'seed' | 'record'; title: string; dedup_key: string; sources: readonly EventSource[] }[];
  records: Readonly<Record<string, StoredRecord>>;
}

export type ImportOp =
  | { op: 'add'; row: number; record: StoredRecord }
  | { op: 'update'; row: number; id: string; before: StoredRecord; after: StoredRecord; changes: FieldChange[] }
  | { op: 'merge'; row: number; targetId: string; targetKind: 'seed' | 'record'; targetTitle: string; source: EventSource };

type Candidate = Omit<StoredRecord, 'id' | 'created_at' | 'updated_at' | 'sources' | 'import_id'> & {
  external_id: string | null;
  disputes: string[];
};

function venueFor(city: string, name: string, venues: readonly Venue[]): { id: string; known: Venue | null } {
  const wanted = normalizeTitle(name);
  const inCity = venues.filter((venue) => venue.city === city);
  const known =
    inCity.find((venue) => normalizeTitle(venue.name) === wanted) ??
    inCity.find((venue) => wanted.length >= 6 && normalizeTitle(venue.name).includes(wanted)) ??
    null;
  return { id: known?.id ?? `ven_imp_${sha256(`${city}|${wanted}`).slice(0, 12)}`, known };
}

/** Строка файла → кандидат в записи или причина отказа. */
function checkRow(raw: RawRow, ctx: ImportContext): { ok: true; candidate: Candidate } | { ok: false; reasons: string[]; code: string } {
  const data = raw.data;
  if (data.__invalid) return { ok: false, code: 'not_an_object', reasons: ['Строка не объект с полями события'] };
  const reasons: string[] = [];
  let code = 'invalid_field';
  const need = <T>(parsed: Parsed<T>, onOk: (value: T) => void) => {
    if (parsed.ok) onOk(parsed.value);
    else reasons.push(parsed.message);
  };

  let title = '';
  need(parseTitle(data.title), (value) => (title = value));
  let category: Candidate['category'] = 'other';
  need(parseCategory(data.category), (value) => (category = value));
  let city: Candidate['city_id'] = 'ufa';
  need(parseCity(data.city), (value) => (city = value));
  const venueName = String(data.venue ?? '').trim().replace(/\s+/g, ' ');
  if (!venueName) reasons.push('Не указана площадка');
  let start = { iso: '', precision: 'minute' as 'minute' | 'date' };
  need(parseDateTime(data.date_start, 'Начало'), (value) => (start = value));
  let end = null as string | null;
  if (!isBlank(data.date_end)) need(parseDateTime(data.date_end, 'Окончание'), (value) => (end = value.iso));

  const single = parsePrice(data.price, 'Цена');
  let priceMin = null as number | null;
  let priceMax = null as number | null;
  need(parsePrice(data.price_min, 'Цена от'), (value) => (priceMin = value));
  need(parsePrice(data.price_max, 'Цена до'), (value) => (priceMax = value));
  if (single.ok && single.value !== null && priceMin === null) {
    priceMin = single.value;
    priceMax = priceMax ?? single.value;
  } else if (!single.ok) reasons.push(single.message);
  if (priceMin !== null && priceMax === null) priceMax = priceMin;
  let isFree = false as boolean;
  need(parseBoolean(data.is_free, 'Бесплатно'), (value) => (isFree = value ?? (priceMin === 0 && priceMax === 0)));

  let age = null as Candidate['age_limit'];
  need(parseAgeLimit(data.age_limit), (value) => (age = value));
  let language = null as string | null;
  need(parseLanguage(data.language), (value) => (language = value));
  let orgLink = null as string | null;
  need(parseUrl(data.org_link, 'Ссылка на билеты'), (value) => (orgLink = value));
  let sourceUrl = null as string | null;
  need(parseUrl(data.source_url, 'Ссылка на источник'), (value) => (sourceUrl = value));
  let description = '';
  need(parseDescription(data.description), (value) => (description = value));
  let status = null as Candidate['status'] | null;
  need(parseStatus(data.status), (value) => (status = value));
  let duration = null as number | null;
  need(parseNumber(data.duration_min, 'Длительность', 1, 60 * 24 * 60), (value) => (duration = value === null ? null : Math.round(value)));
  let lat = null as number | null;
  let lon = null as number | null;
  need(parseNumber(data.lat, 'Широта', -90, 90), (value) => (lat = value));
  need(parseNumber(data.lon, 'Долгота', -180, 180), (value) => (lon = value));
  let confidence = 1 as number;
  need(parseNumber(data.confidence, 'Уверенность', 0, 1), (value) => (confidence = value ?? 1));

  if (sourceUrl === null && !reasons.some((reason) => reason.startsWith('Ссылка на источник'))) {
    reasons.push('Нет ссылки на источник (source_url): без неё карточку нельзя проверить');
    code = 'no_source';
  }
  if (isFree && ((priceMin ?? 0) > 0 || (priceMax ?? 0) > 0)) {
    reasons.push(`Противоречие: событие отмечено бесплатным, но указана цена ${priceMin} ₽`);
  }
  if (priceMin !== null && priceMax !== null && priceMin > priceMax) reasons.push('«Цена до» меньше, чем «цена от»');
  if (start.iso && end && end < start.iso) reasons.push('Окончание раньше начала');
  if (start.iso) {
    const closes = Date.parse(end ?? (start.precision === 'date' ? start.iso.replace('T00:00:00', 'T23:59:00') : start.iso));
    if (closes < ctx.now.getTime()) {
      reasons.push('Событие уже прошло: в афишу попадают только предстоящие');
      code = 'past_event';
    }
  }
  if (reasons.length) return { ok: false, reasons, code: reasons.length > 1 ? 'invalid_fields' : code };

  const venue = venueFor(city, venueName, ctx.venues);
  const normalized = normalizeTitle(title);
  const disputes: string[] = [];
  if (!venue.known) disputes.push(`Площадки «${venueName}» нет в справочнике: проверьте название, она будет создана заново`);
  if (!description) disputes.push('Нет описания');
  if (confidence < 0.7) disputes.push(`Низкая уверенность извлечения: ${confidence}`);

  return {
    ok: true,
    candidate: {
      title,
      normalized_title: normalized,
      category,
      tags: (() => {
        const tags = parseTags(data.tags);
        if (isFree && !tags.includes('бесплатно')) tags.push('бесплатно');
        return tags;
      })(),
      date_start: start.iso,
      date_end: end,
      duration_min:
        duration ?? (end && start.precision === 'minute' ? Math.round((Date.parse(end) - Date.parse(start.iso)) / 60_000) : null),
      time_precision: start.precision,
      city_id: city,
      venue_id: venue.id,
      venue: venue.known?.name ?? venueName,
      address: String(data.address ?? '').trim() || venue.known?.address || null,
      lat: lat ?? venue.known?.lat ?? null,
      lon: lon ?? venue.known?.lon ?? null,
      description,
      price_min: isFree ? 0 : priceMin,
      price_max: isFree ? 0 : priceMax,
      is_free: isFree,
      age_limit: age,
      language,
      org_link: orgLink,
      source_url: sourceUrl as string,
      source_type: 'import',
      source_hash: rowHash(data),
      verified_at: ctx.now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
      confidence,
      status: disputes.length ? 'draft' : (status ?? 'published'),
      dedup_key: dedupKey(normalized, start.iso.slice(0, 10), venue.id),
      external_id: isBlank(data.external_id) ? null : String(data.external_id).trim().slice(0, 120),
      disputes,
    },
  };
}

// ---------------------------------------------------------------------------
// План импорта
// ---------------------------------------------------------------------------

const COMPARED_FIELDS: readonly (keyof StoredRecord)[] = [
  'title',
  'category',
  'tags',
  'date_start',
  'date_end',
  'duration_min',
  'venue',
  'address',
  'description',
  'price_min',
  'price_max',
  'is_free',
  'age_limit',
  'language',
  'org_link',
  'status',
];

function diff(before: StoredRecord, after: StoredRecord): FieldChange[] {
  return COMPARED_FIELDS.filter((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field])).map((field) => ({
    field,
    from: before[field],
    to: after[field],
  }));
}

/** Строит план изменений и отчёт. Ничего не записывает. */
export function planImport(
  text: string,
  options: { format: 'csv' | 'json'; fileName: string | null },
  ctx: ImportContext,
): { ok: true; report: ImportReport; ops: ImportOp[] } | { ok: false; code: string; message: string } {
  const parsed = parseImportFile(text, options.format);
  if (!parsed.ok) return parsed;

  const at = ctx.now.toISOString();
  const rejected: ImportRejected[] = [];
  const disputed: ImportDisputed[] = [];
  const rows: ImportChanged[] = [];
  const ops: ImportOp[] = [];
  const seenHashes = new Map<string, number>();
  const knownHashes = new Set<string>();
  for (const event of ctx.events) for (const source of event.sources) knownHashes.add(source.source_hash);
  for (const record of Object.values(ctx.records)) knownHashes.add(record.source_hash);
  const byDedup = new Map(ctx.events.map((event) => [event.dedup_key, event]));
  const plannedDedup = new Map<string, string>();

  for (const raw of parsed.rows) {
    const hash = raw.data.__invalid ? undefined : rowHash(raw.data);
    if (hash && seenHashes.has(hash)) {
      rejected.push({ row: raw.row, source_hash: hash, reason_code: 'duplicate_in_file', reason: `Повтор строки ${seenHashes.get(hash)} этого же файла` });
      continue;
    }
    if (hash) seenHashes.set(hash, raw.row);

    // Уже загружено тем же содержимым: идемпотентность повторного импорта.
    if (hash && knownHashes.has(hash)) {
      const owner = ctx.events.find((event) => event.sources.some((source) => source.source_hash === hash));
      rows.push({ row: raw.row, id: owner?.id ?? '', title: owner?.title ?? String(raw.data.title ?? ''), outcome: 'unchanged' });
      continue;
    }

    const checked = checkRow(raw, ctx);
    if (!checked.ok) {
      rejected.push({ row: raw.row, source_hash: hash, reason_code: checked.code, reason: checked.reasons.join('; ') });
      continue;
    }
    const candidate = checked.candidate;
    const source: EventSource = {
      source_url: candidate.source_url,
      source_type: 'import',
      source_hash: candidate.source_hash,
      verified_at: candidate.verified_at,
      title: (() => {
        try {
          return new URL(candidate.source_url).hostname.replace(/^www\./, '');
        } catch {
          return 'Импорт';
        }
      })(),
    };

    const identity = candidate.external_id ? `ext:${candidate.source_url}:${candidate.external_id}` : `dedup:${candidate.dedup_key}`;
    const id = uuidFromCode(identity, IMPORT_NAMESPACE);
    const existingRecord = ctx.records[id];
    const sameEvent = byDedup.get(candidate.dedup_key);

    // То же событие уже есть, но из другого источника: сводим в одну карточку и добавляем источник.
    // Поля карточки при этом не перезаписываются: расхождения разбирает модератор.
    const target = existingRecord
      ? { id: existingRecord.id, kind: 'record' as const, title: existingRecord.title, sources: existingRecord.sources }
      : sameEvent;
    if (target && !target.sources.some((item) => item.source_url === candidate.source_url)) {
      ops.push({ op: 'merge', row: raw.row, targetId: target.id, targetKind: target.kind, targetTitle: target.title, source });
      rows.push({ row: raw.row, id: target.id, title: target.title, outcome: 'merged', note: `Добавлен источник ${source.title}` });
      continue;
    }
    if (plannedDedup.has(candidate.dedup_key) && !existingRecord) {
      rejected.push({
        row: raw.row,
        source_hash: hash,
        reason_code: 'duplicate_in_file',
        reason: `То же событие (название, дата, площадка), что в строке ${plannedDedup.get(candidate.dedup_key)}`,
      });
      continue;
    }
    plannedDedup.set(candidate.dedup_key, String(raw.row));

    const { external_id: _externalId, disputes, ...fields } = candidate;
    void _externalId;
    const review = disputes.length ? { disputed: true, reasons: disputes } : undefined;

    if (existingRecord) {
      const after: StoredRecord = {
        ...existingRecord,
        ...fields,
        id,
        created_at: existingRecord.created_at,
        updated_at: at,
        sources: [source, ...existingRecord.sources.filter((item) => item.source_url !== source.source_url)],
        import_id: ctx.importId,
        ...(review ? { review } : {}),
      };
      if (!review) delete after.review;
      ops.push({ op: 'update', row: raw.row, id, before: existingRecord, after, changes: diff(existingRecord, after) });
      rows.push({ row: raw.row, id, title: after.title, outcome: 'updated' });
    } else {
      const record: StoredRecord = { ...fields, id, created_at: at, updated_at: at, sources: [source], import_id: ctx.importId, ...(review ? { review } : {}) };
      ops.push({ op: 'add', row: raw.row, record });
      rows.push({ row: raw.row, id, title: record.title, outcome: 'added' });
    }
    if (review) disputed.push({ row: raw.row, id, title: candidate.title, reasons: disputes });
  }

  const count = (outcome: ImportChanged['outcome']) => rows.filter((row) => row.outcome === outcome).length;
  return {
    ok: true,
    ops,
    report: {
      import_id: ctx.importId,
      at,
      actor: ctx.actor,
      file_name: options.fileName,
      format: parsed.format,
      received: parsed.rows.length,
      added: count('added'),
      updated: count('updated'),
      merged: count('merged'),
      unchanged: count('unchanged'),
      rejected,
      disputed,
      rows,
    },
  };
}

/** Подпись города для отчётов. */
export function cityLabel(slug: string): string {
  return getCity(slug)?.name.ru ?? slug;
}
