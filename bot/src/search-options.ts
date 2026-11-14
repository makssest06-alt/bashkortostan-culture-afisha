export type DatePreset = 'today' | 'tomorrow' | 'weekend' | 'week';

/** Пресет даты или конкретный день в формате ГГГГ-ММ-ДД. */
export type SearchDate = DatePreset | string;

export const DATE_PRESETS: readonly { id: DatePreset; label: string }[] = [
  { id: 'today', label: 'Сегодня' },
  { id: 'tomorrow', label: 'Завтра' },
  { id: 'weekend', label: 'На выходных' },
  { id: 'week', label: 'На этой неделе' },
];

export const PRICE_MAX_OPTIONS = [500, 1000, 2000, 3000, 5000] as const;

export const AGE_OPTIONS = [0, 3, 6, 12, 16, 18] as const;

export type SearchSort = 'date' | 'price' | 'popularity';

export const SORT_OPTIONS: readonly { id: SearchSort; label: string }[] = [
  { id: 'date', label: 'По дате' },
  { id: 'price', label: 'По цене' },
  { id: 'popularity', label: 'По популярности' },
];

export type LanguageCode = 'ru' | 'ba' | 'tt';

export const LANGUAGE_OPTIONS: readonly { id: LanguageCode; label: string }[] = [
  { id: 'ru', label: 'Русский' },
  { id: 'ba', label: 'Башкирский' },
  { id: 'tt', label: 'Татарский' },
];

export const RANGE_MAX_DAYS = 31;

export function ageLabel(age: number | null | undefined): string {
  if (age === null || age === undefined) return 'Любой возраст';
  const mod10 = age % 10;
  const mod100 = age % 100;
  const word =
    mod10 === 1 && mod100 !== 11
      ? 'год'
      : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
        ? 'года'
        : 'лет';
  return `${age} ${word}`;
}

export function sortLabel(sort: string | null | undefined): string {
  return SORT_OPTIONS.find((option) => option.id === sort)?.label ?? 'По дате';
}

export function languageLabel(language: string | null | undefined): string {
  if (!language) return 'Любой язык';
  return LANGUAGE_OPTIONS.find((option) => option.id === language)?.label ?? language;
}

export function isAgeOption(value: number): boolean {
  return AGE_OPTIONS.includes(value as (typeof AGE_OPTIONS)[number]);
}

export function isSearchSort(value: string): value is SearchSort {
  return SORT_OPTIONS.some((option) => option.id === value);
}

export function isLanguageCode(value: string): value is LanguageCode {
  return LANGUAGE_OPTIONS.some((option) => option.id === value);
}

export interface IsoRange {
  from: string;
  to: string;
}

/** Разбирает `2026-11-20..2026-11-25`; конец включительно. */
export function parseIsoRange(value: string): IsoRange | null {
  const normalized = value.trim().replace(/\s+/g, ' ');
  const match = /^(\d{4}-\d{2}-\d{2})\s*(?:\.\.|—|–|-)\s*(\d{4}-\d{2}-\d{2})$/.exec(
    normalized,
  );
  if (!match?.[1] || !match[2]) return null;
  const from = match[1];
  const to = match[2];
  if (!isIsoDate(from) || !isIsoDate(to)) return null;
  if (to < from) return null;
  const days = rangeDays(from, to);
  if (days === null || days > RANGE_MAX_DAYS) return null;
  return { from, to };
}

/** Число календарных дней в периоде, включая оба конца. */
export function rangeDays(from: string, to: string): number | null {
  if (!isIsoDate(from) || !isIsoDate(to) || to < from) return null;
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.round((end - start) / 86_400_000) + 1;
}

export function datePresetLabel(id: string | null | undefined): string | null {
  return DATE_PRESETS.find((preset) => preset.id === id)?.label ?? null;
}

export function isDatePreset(value: string): value is DatePreset {
  return DATE_PRESETS.some((preset) => preset.id === value);
}

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Проверяет не только форму, но и календарную дату. */
export function isIsoDate(value: string): boolean {
  const match = ISO_DATE_RE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** Афиша Башкортостана живёт в UTC+5, а сервер и Docker могут быть в UTC. */
export const AFISHA_TIME_ZONE = 'Asia/Yekaterinburg';

const ISO_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: AFISHA_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function isoPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((part) => part.type === type)?.value ?? '';
}

/** Сегодняшняя дата в часовом поясе афиши, независимо от TZ сервера. */
export function todayIsoDate(now: Date = new Date()): string {
  const parts = ISO_DATE_FORMATTER.formatToParts(now);
  return `${isoPart(parts, 'year')}-${isoPart(parts, 'month')}-${isoPart(parts, 'day')}`;
}

/** Сдвигает календарную дату `ГГГГ-ММ-ДД` без зависимости от TZ сервера. */
export function addIsoDays(value: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days),
  );
  return date.toISOString().slice(0, 10);
}
