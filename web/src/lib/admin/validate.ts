/**
 * Разбор и проверка значений полей события для импорта и ручной правки.
 * Сообщения пишутся для модератора: что не так и как исправить, без кодов и стектрейсов.
 */

import { CATEGORIES, CITIES } from '../../data/dictionaries';
import { normalizeText } from '../api/text';
import type { AgeLimit, ApiErrorDetail, CategoryId, CityId, EventStatus } from '../api/types';
import { EDITABLE_FIELDS } from './types';
import type { EditableFields } from './types';

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

const ok = <T>(value: T): Parsed<T> => ({ ok: true, value });
const fail = <T>(message: string): Parsed<T> => ({ ok: false, message });

const AGE_LIMITS: readonly AgeLimit[] = [0, 6, 12, 16, 18];
const STATUSES: readonly EventStatus[] = ['published', 'draft', 'cancelled'];

export const MAX_TITLE = 200;
export const MAX_DESCRIPTION = 4000;
export const MAX_TAGS = 12;

function text(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

/** Пустое значение: пустая строка, null, undefined. Ноль пустым не считается. */
export function isBlank(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

// ---------------------------------------------------------------------------
// Справочные поля
// ---------------------------------------------------------------------------

/** Русские слова, которыми категорию пишут в файлах учреждений. */
const CATEGORY_WORDS: Record<string, CategoryId> = {
  концерт: 'concert',
  концерты: 'concert',
  спектакль: 'performance',
  спектакли: 'performance',
  театр: 'performance',
  постановка: 'performance',
  выставка: 'exhibition',
  выставки: 'exhibition',
  экспозиция: 'exhibition',
  фестиваль: 'festival',
  фестивали: 'festival',
  кино: 'cinema',
  кинопоказ: 'cinema',
  фильм: 'cinema',
  экскурсия: 'excursion',
  экскурсии: 'excursion',
  другое: 'other',
  прочее: 'other',
  'мастер-класс': 'other',
};

export function parseCategory(value: unknown): Parsed<CategoryId> {
  const raw = normalizeText(text(value));
  if (!raw) return fail('Не указана категория');
  const byId = CATEGORIES.find((entry) => entry.id === raw);
  if (byId) return ok(byId.id);
  const byWord = CATEGORY_WORDS[raw];
  if (byWord) return ok(byWord);
  return fail(
    `Категория «${text(value)}» не из списка. Допустимо: концерт, спектакль, выставка, фестиваль, кино, экскурсия, другое`,
  );
}

export function parseCity(value: unknown): Parsed<CityId> {
  const raw = normalizeText(text(value));
  if (!raw) return fail('Не указан город');
  const city = CITIES.find(
    (entry) => entry.slug === raw || normalizeText(entry.name.ru) === raw || normalizeText(entry.name.ba) === raw,
  );
  if (city) return ok(city.slug);
  return fail(
    `Город «${text(value)}» не найден в справочнике. Сейчас в афише: ${CITIES.map((entry) => entry.name.ru).join(', ')}`,
  );
}

export function parseStatus(value: unknown): Parsed<EventStatus | null> {
  const raw = normalizeText(text(value));
  if (!raw) return ok(null);
  const words: Record<string, EventStatus> = {
    опубликовано: 'published',
    черновик: 'draft',
    отменено: 'cancelled',
    отменён: 'cancelled',
    отменен: 'cancelled',
  };
  const status = STATUSES.find((entry) => entry === raw) ?? words[raw];
  return status ? ok(status) : fail(`Статус «${text(value)}» не из списка: опубликовано, черновик, отменено`);
}

// ---------------------------------------------------------------------------
// Числа и флаги
// ---------------------------------------------------------------------------

export function parseAgeLimit(value: unknown): Parsed<AgeLimit | null> {
  if (isBlank(value)) return ok(null);
  const raw = text(value).replace(/\+$/, '').trim();
  const number = Number(raw);
  if (Number.isInteger(number) && AGE_LIMITS.includes(number as AgeLimit)) return ok(number as AgeLimit);
  return fail(`Возрастное ограничение «${text(value)}» не из списка: 0, 6, 12, 16, 18`);
}

/** Цена в рублях: «500», «500 ₽», «1 200». Пусто: цена не указана (null), а не бесплатно. */
export function parsePrice(value: unknown, field: string): Parsed<number | null> {
  if (isBlank(value)) return ok(null);
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 && value <= 1_000_000
      ? ok(Math.round(value))
      : fail(`${field}: цена должна быть числом от 0 до 1 000 000 рублей`);
  }
  const raw = text(value).replace(/[\s  ]/g, '').replace(/(₽|руб\.?|р\.?)$/i, '').replace(',', '.');
  const number = Number(raw);
  if (raw === '' || !Number.isFinite(number) || number < 0 || number > 1_000_000) {
    return fail(`${field}: «${text(value)}» не похоже на цену в рублях. Пример: 500`);
  }
  return ok(Math.round(number));
}

export function parseBoolean(value: unknown, field: string): Parsed<boolean | null> {
  if (isBlank(value)) return ok(null);
  if (typeof value === 'boolean') return ok(value);
  const raw = normalizeText(text(value));
  if (['true', '1', 'да', 'yes'].includes(raw)) return ok(true);
  if (['false', '0', 'нет', 'no'].includes(raw)) return ok(false);
  return fail(`${field}: ожидается да или нет`);
}

export function parseNumber(value: unknown, field: string, min: number, max: number): Parsed<number | null> {
  if (isBlank(value)) return ok(null);
  const number = typeof value === 'number' ? value : Number(text(value).replace(',', '.'));
  if (!Number.isFinite(number) || number < min || number > max) return fail(`${field}: ожидается число от ${min} до ${max}`);
  return ok(number);
}

// ---------------------------------------------------------------------------
// Даты
// ---------------------------------------------------------------------------

export interface ParsedDate {
  /** date-time с поясом Уфы: 2026-11-14T19:00:00+05:00. */
  iso: string;
  precision: 'minute' | 'date';
}

const pad = (value: number) => String(value).padStart(2, '0');

function validParts(year: number, month: number, day: number, hour = 0, minute = 0): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return false;
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day;
}

/** Момент UTC → местное время Уфы (+05:00) строкой. */
function toLocalIso(ms: number): string {
  const local = new Date(ms + 5 * 3_600_000);
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:00+05:00`;
}

/**
 * Дата и время из файла учреждения. Понимает ISO 8601 (с поясом и без), «ГГГГ-ММ-ДД ЧЧ:ММ»,
 * «ДД.ММ.ГГГГ ЧЧ:ММ» и одну дату без времени. Время без пояса считается временем Уфы.
 */
export function parseDateTime(value: unknown, field: string): Parsed<ParsedDate> {
  const raw = text(value);
  if (!raw) return fail(`${field}: не указана дата`);

  let match = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/);
  if (match) {
    const [, y, mo, d, h, mi, , zone] = match;
    const year = Number(y);
    const month = Number(mo);
    const day = Number(d);
    if (h === undefined) {
      if (!validParts(year, month, day)) return fail(`${field}: такой даты нет: «${raw}»`);
      return ok({ iso: `${y}-${mo}-${d}T00:00:00+05:00`, precision: 'date' });
    }
    const hour = Number(h);
    const minute = Number(mi);
    if (!validParts(year, month, day, hour, minute)) return fail(`${field}: такой даты или времени нет: «${raw}»`);
    if (!zone || zone === '+05:00' || zone === '+0500') {
      return ok({ iso: `${y}-${mo}-${d}T${h}:${mi}:00+05:00`, precision: 'minute' });
    }
    const ms = Date.parse(`${y}-${mo}-${d}T${h}:${mi}:00${zone === 'Z' ? 'Z' : zone.replace(/^([+-]\d{2})(\d{2})$/, '$1:$2')}`);
    if (Number.isNaN(ms)) return fail(`${field}: не удалось разобрать часовой пояс в «${raw}»`);
    return ok({ iso: toLocalIso(ms), precision: 'minute' });
  }

  match = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ ,]+(\d{1,2}):(\d{2}))?$/);
  if (match) {
    const [, d, mo, y, h, mi] = match;
    const year = Number(y);
    const month = Number(mo);
    const day = Number(d);
    if (h === undefined) {
      if (!validParts(year, month, day)) return fail(`${field}: такой даты нет: «${raw}»`);
      return ok({ iso: `${y}-${pad(month)}-${pad(day)}T00:00:00+05:00`, precision: 'date' });
    }
    if (!validParts(year, month, day, Number(h), Number(mi))) return fail(`${field}: такой даты или времени нет: «${raw}»`);
    return ok({ iso: `${y}-${pad(month)}-${pad(day)}T${pad(Number(h))}:${mi}:00+05:00`, precision: 'minute' });
  }

  return fail(`${field}: дата «${raw}» в непонятном формате. Примеры: 2026-11-14 19:00 или 14.11.2026 19:00`);
}

// ---------------------------------------------------------------------------
// Ссылки и текст
// ---------------------------------------------------------------------------

export function parseUrl(value: unknown, field: string): Parsed<string | null> {
  const raw = text(value);
  if (!raw) return ok(null);
  if (raw.length > 2000) return fail(`${field}: ссылка длиннее 2000 знаков`);
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return fail(`${field}: ссылка должна начинаться с http:// или https://`);
    return ok(url.toString());
  } catch {
    return fail(`${field}: «${raw.slice(0, 80)}» не похоже на ссылку. Пример: https://example.ru/afisha`);
  }
}

export function parseTags(value: unknown): string[] {
  const list = Array.isArray(value) ? value.map(text) : text(value).split(/[;|,]/);
  const result: string[] = [];
  for (const item of list) {
    const tag = item.trim().toLowerCase().slice(0, 40);
    if (tag && !result.includes(tag)) result.push(tag);
  }
  return result.slice(0, MAX_TAGS);
}

const LANGUAGE_WORDS: Record<string, string> = {
  русский: 'ru',
  башкирский: 'ba',
  татарский: 'tt',
  ru: 'ru',
  ba: 'ba',
  tt: 'tt',
};

export function parseLanguage(value: unknown): Parsed<string | null> {
  const raw = normalizeText(text(value));
  if (!raw) return ok(null);
  const code = LANGUAGE_WORDS[raw];
  return code ? ok(code) : fail(`Язык «${text(value)}» не распознан. Допустимо: русский, башкирский, татарский`);
}

export function parseTitle(value: unknown): Parsed<string> {
  const raw = text(value).replace(/\s+/g, ' ');
  if (!raw) return fail('Не указано название');
  if (raw.length > MAX_TITLE) return fail(`Название длиннее ${MAX_TITLE} знаков`);
  return ok(raw);
}

export function parseDescription(value: unknown): Parsed<string> {
  const raw = text(value);
  if (raw.length > MAX_DESCRIPTION) return fail(`Описание длиннее ${MAX_DESCRIPTION} знаков`);
  return ok(raw);
}

// ---------------------------------------------------------------------------
// Правка модератора
// ---------------------------------------------------------------------------

/**
 * Проверяет тело PATCH /admin/events/{id}. Неизвестные поля и даты у демо-событий
 * отклоняются, чтобы правка не пропадала молча.
 */
export function validateEdit(
  body: unknown,
  options: { datesEditable: boolean },
): { ok: true; value: EditableFields } | { ok: false; issues: ApiErrorDetail[] } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, issues: [{ field: 'body', message: 'Ожидается объект с полями события' }] };
  }
  const input = body as Record<string, unknown>;
  const issues: ApiErrorDetail[] = [];
  const value: EditableFields = {};
  const take = <T>(field: keyof EditableFields, parsed: Parsed<T>, assign: (v: T) => void) => {
    if (parsed.ok) assign(parsed.value);
    else issues.push({ field, message: parsed.message });
  };

  for (const key of Object.keys(input)) {
    if (key === 'expected_updated_at') continue;
    if (!EDITABLE_FIELDS.includes(key as keyof EditableFields)) {
      issues.push({ field: key, message: `Поле «${key}» нельзя менять через админку` });
    }
  }
  if ('title' in input) take('title', parseTitle(input.title), (v) => (value.title = v));
  if ('description' in input) take('description', parseDescription(input.description), (v) => (value.description = v));
  if ('category' in input) take('category', parseCategory(input.category), (v) => (value.category = v));
  if ('tags' in input) value.tags = parseTags(input.tags);
  if ('status' in input) {
    take('status', parseStatus(input.status), (v) => {
      if (v === null) issues.push({ field: 'status', message: 'Не указан статус' });
      else value.status = v;
    });
  }
  if ('age_limit' in input) take('age_limit', parseAgeLimit(input.age_limit), (v) => (value.age_limit = v));
  if ('price_min' in input) take('price_min', parsePrice(input.price_min, 'Цена от'), (v) => (value.price_min = v));
  if ('price_max' in input) take('price_max', parsePrice(input.price_max, 'Цена до'), (v) => (value.price_max = v));
  if ('is_free' in input) {
    take('is_free', parseBoolean(input.is_free, 'Бесплатно'), (v) => (value.is_free = v ?? false));
  }
  if ('address' in input) value.address = text(input.address).slice(0, 300) || null;
  if ('org_link' in input) take('org_link', parseUrl(input.org_link, 'Ссылка на билеты'), (v) => (value.org_link = v));
  if ('language' in input) take('language', parseLanguage(input.language), (v) => (value.language = v));
  if ('source_url' in input) {
    take('source_url', parseUrl(input.source_url, 'Ссылка на источник'), (v) => {
      if (v === null) issues.push({ field: 'source_url', message: 'Ссылка на источник обязательна: без неё карточку не проверить' });
      else value.source_url = v;
    });
  }
  for (const field of ['date_start', 'date_end'] as const) {
    if (!(field in input)) continue;
    if (!options.datesEditable) {
      issues.push({ field, message: 'Даты демо-события вычисляются от сегодняшнего дня и не редактируются' });
      continue;
    }
    if (field === 'date_end' && isBlank(input[field])) {
      value.date_end = null;
      continue;
    }
    take(field, parseDateTime(input[field], field === 'date_start' ? 'Начало' : 'Окончание'), (v) => (value[field] = v.iso));
  }

  if (value.is_free === true && ((value.price_min ?? 0) > 0 || (value.price_max ?? 0) > 0)) {
    issues.push({ field: 'is_free', message: 'Событие отмечено бесплатным, но у него указана цена. Уберите цену или отметку' });
  }
  if (value.price_min != null && value.price_max != null && value.price_min > value.price_max) {
    issues.push({ field: 'price_max', message: '«Цена до» меньше, чем «цена от»' });
  }
  if (value.date_start && value.date_end && value.date_end < value.date_start) {
    issues.push({ field: 'date_end', message: 'Окончание раньше начала' });
  }
  return issues.length ? { ok: false, issues } : { ok: true, value };
}
