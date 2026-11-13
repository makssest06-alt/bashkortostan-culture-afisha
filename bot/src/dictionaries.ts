export type CityId =
  | 'ufa'
  | 'sterlitamak'
  | 'salavat'
  | 'neftekamsk'
  | 'oktyabrsky'
  | 'beloretsk'
  | 'sibay'
  | 'kumertau';

export type CategoryId =
  | 'concert'
  | 'performance'
  | 'exhibition'
  | 'festival'
  | 'cinema'
  | 'excursion'
  | 'other';

export type DatePreset = 'today' | 'tomorrow' | 'weekend' | 'week';

/** Пресет даты или конкретный день в формате ГГГГ-ММ-ДД. */
export type SearchDate = DatePreset | string;

export interface CityInfo {
  id: CityId;
  name: string;
  nameIn: string;
}

export interface CategoryInfo {
  id: CategoryId;
  name: string;
  nameOne: string;
}

export const CITIES: readonly CityInfo[] = [
  { id: 'ufa', name: 'Уфа', nameIn: 'в Уфе' },
  { id: 'sterlitamak', name: 'Стерлитамак', nameIn: 'в Стерлитамаке' },
  { id: 'salavat', name: 'Салават', nameIn: 'в Салавате' },
  { id: 'neftekamsk', name: 'Нефтекамск', nameIn: 'в Нефтекамске' },
  { id: 'oktyabrsky', name: 'Октябрьский', nameIn: 'в Октябрьском' },
  { id: 'beloretsk', name: 'Белорецк', nameIn: 'в Белорецке' },
  { id: 'sibay', name: 'Сибай', nameIn: 'в Сибае' },
  { id: 'kumertau', name: 'Кумертау', nameIn: 'в Кумертау' },
];

export const CATEGORIES: readonly CategoryInfo[] = [
  { id: 'concert', name: 'Концерты', nameOne: 'Концерт' },
  { id: 'performance', name: 'Спектакли', nameOne: 'Спектакль' },
  { id: 'exhibition', name: 'Выставки', nameOne: 'Выставка' },
  { id: 'festival', name: 'Фестивали', nameOne: 'Фестиваль' },
  { id: 'cinema', name: 'Кино', nameOne: 'Кинопоказ' },
  { id: 'excursion', name: 'Экскурсии', nameOne: 'Экскурсия' },
  { id: 'other', name: 'Другое', nameOne: 'Событие' },
];

export const DATE_PRESETS: readonly { id: DatePreset; label: string }[] = [
  { id: 'today', label: 'Сегодня' },
  { id: 'tomorrow', label: 'Завтра' },
  { id: 'weekend', label: 'На выходных' },
  { id: 'week', label: 'На этой неделе' },
];

export function cityById(id: string | null | undefined): CityInfo | undefined {
  return CITIES.find((city) => city.id === id);
}

export function categoryById(id: string | null | undefined): CategoryInfo | undefined {
  return CATEGORIES.find((category) => category.id === id);
}

export function cityName(id: string | null | undefined): string | null {
  return cityById(id)?.name ?? null;
}

export function categoryName(id: string | null | undefined): string | null {
  return categoryById(id)?.name ?? null;
}

export function categoryNameOne(id: string | null | undefined): string | null {
  return categoryById(id)?.nameOne ?? null;
}

export function datePresetLabel(id: string | null | undefined): string | null {
  return DATE_PRESETS.find((preset) => preset.id === id)?.label ?? null;
}

export function isCityId(value: string): value is CityId {
  return CITIES.some((city) => city.id === value);
}

export function isCategoryId(value: string): value is CategoryId {
  return CATEGORIES.some((category) => category.id === value);
}

export function isDatePreset(value: string): value is DatePreset {
  return DATE_PRESETS.some((preset) => preset.id === value);
}

export const PRICE_MAX_OPTIONS = [500, 1000, 2000, 3000, 5000] as const;

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

function normalizeLookup(value: string): string {
  return value.trim().toLowerCase().replace(/^в\s+/, '').replace(/ё/g, 'е');
}

export function findCityId(value: string): CityId | null {
  const needle = normalizeLookup(value);
  if (!needle) return null;
  const city = CITIES.find(
    (item) =>
      item.id === needle ||
      normalizeLookup(item.name) === needle ||
      normalizeLookup(item.nameIn) === needle,
  );
  return city?.id ?? null;
}

export function findCategoryId(value: string): CategoryId | null {
  const needle = normalizeLookup(value);
  if (!needle) return null;
  const category = CATEGORIES.find(
    (item) =>
      item.id === needle ||
      normalizeLookup(item.name) === needle ||
      normalizeLookup(item.nameOne) === needle,
  );
  if (category) return category.id;
  // «концерт» и «концерты» должны находить одну категорию.
  const byStem = CATEGORIES.find((item) => {
    const name = normalizeLookup(item.name);
    const one = normalizeLookup(item.nameOne);
    return name.startsWith(needle) || one.startsWith(needle);
  });
  return byStem?.id ?? null;
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
