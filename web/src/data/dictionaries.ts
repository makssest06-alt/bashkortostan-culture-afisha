/**
 * Справочники афиши: категории, города, возрастные метки, статусы.
 * Чистые данные без зависимостей: модуль можно импортировать и на сервере,
 * и в клиентских компонентах, если подписи нужны без запроса к API.
 */

import type {
  AgeRating,
  AgeRatingEntry,
  Availability,
  AvailabilityEntry,
  CategoryEntry,
  CategoryId,
  CityEntry,
  CityId,
  DatePreset,
  Dictionaries,
  DisplayStatus,
  DisplayStatusEntry,
  Occurrence,
  OccurrenceStatus,
  OfferAudience,
  OptionEntry,
  PriceKind,
  SortKey,
  StatusEntry,
} from '../lib/api/types';

/**
 * Семь категорий из п. 8.1 ТЗ: концерт, спектакль, выставка, фестиваль, кино, экскурсия, другое.
 * «Детям» не категория, а аудитория: фильтр audience=kids и метка «дети» в tags.
 */
export const CATEGORIES: readonly CategoryEntry[] = [
  { id: 'concert', name: { ru: 'Концерты', ba: 'Концерттар' }, name_one: { ru: 'Концерт', ba: 'Концерт' } },
  { id: 'performance', name: { ru: 'Спектакли', ba: 'Спектаклдәр' }, name_one: { ru: 'Спектакль', ba: 'Спектакль' } },
  { id: 'exhibition', name: { ru: 'Выставки', ba: 'Күргәҙмәләр' }, name_one: { ru: 'Выставка', ba: 'Күргәҙмә' } },
  { id: 'festival', name: { ru: 'Фестивали', ba: 'Фестивалдәр' }, name_one: { ru: 'Фестиваль', ba: 'Фестиваль' } },
  { id: 'cinema', name: { ru: 'Кино', ba: 'Кино' }, name_one: { ru: 'Кинопоказ', ba: 'Кино' } },
  { id: 'excursion', name: { ru: 'Экскурсии', ba: 'Экскурсиялар' }, name_one: { ru: 'Экскурсия', ba: 'Экскурсия' } },
  { id: 'other', name: { ru: 'Другое', ba: 'Башҡа' }, name_one: { ru: 'Другое', ba: 'Башҡа' } },
];

/** Метка аудитории «детям» в tags (п. 8.1: «дети»). */
export const KIDS_TAG = 'дети';

/** Координаты: центр города с точностью до сотых градуса, для карты уровня города. */
export const CITIES: readonly CityEntry[] = [
  { slug: 'ufa', name: { ru: 'Уфа', ba: 'Өфө' }, name_in: { ru: 'в Уфе', ba: 'Өфөлә' }, lat: 54.74, lon: 55.97 },
  {
    slug: 'sterlitamak',
    name: { ru: 'Стерлитамак', ba: 'Стәрлетамаҡ' },
    name_in: { ru: 'в Стерлитамаке', ba: 'Стәрлетамаҡта' },
    lat: 53.63,
    lon: 55.95,
  },
  {
    slug: 'salavat',
    name: { ru: 'Салават', ba: 'Салауат' },
    name_in: { ru: 'в Салавате', ba: 'Салауатта' },
    lat: 53.36,
    lon: 55.93,
  },
  {
    slug: 'neftekamsk',
    name: { ru: 'Нефтекамск', ba: 'Нефтекама' },
    name_in: { ru: 'в Нефтекамске', ba: 'Нефтекамала' },
    lat: 56.09,
    lon: 54.25,
  },
  {
    slug: 'oktyabrsky',
    name: { ru: 'Октябрьский', ba: 'Октябрьский' },
    name_in: { ru: 'в Октябрьском', ba: 'Октябрьскийҙа' },
    lat: 54.48,
    lon: 53.47,
  },
  {
    slug: 'beloretsk',
    name: { ru: 'Белорецк', ba: 'Белорет' },
    name_in: { ru: 'в Белорецке', ba: 'Белоретта' },
    lat: 53.96,
    lon: 58.4,
  },
  { slug: 'sibay', name: { ru: 'Сибай', ba: 'Сибай' }, name_in: { ru: 'в Сибае', ba: 'Сибайҙа' }, lat: 52.72, lon: 58.67 },
  {
    slug: 'kumertau',
    name: { ru: 'Кумертау', ba: 'Күмертау' },
    name_in: { ru: 'в Кумертау', ba: 'Күмертауҙа' },
    lat: 52.77,
    lon: 55.78,
  },
];

export const AGE_RATINGS: readonly AgeRatingEntry[] = [
  { id: '0+', min_age: 0, label: { ru: '0+', ba: '0+' } },
  { id: '6+', min_age: 6, label: { ru: '6+', ba: '6+' } },
  { id: '12+', min_age: 12, label: { ru: '12+', ba: '12+' } },
  { id: '16+', min_age: 16, label: { ru: '16+', ba: '16+' } },
  { id: '18+', min_age: 18, label: { ru: '18+', ba: '18+' } },
];

export const STATUSES: readonly StatusEntry[] = [
  { id: 'scheduled', label: { ru: 'Состоится', ba: 'Буласаҡ' }, tone: 'positive' },
  { id: 'cancelled', label: { ru: 'Отменён', ba: 'Юҡҡа сығарылған' }, tone: 'negative' },
  {
    id: 'postponed',
    label: { ru: 'Перенесён, дата уточняется', ba: 'Кисектерелгән, көнө асыҡлана' },
    tone: 'warning',
  },
  { id: 'rescheduled', label: { ru: 'Перенесён на новую дату', ba: 'Яңы көнгә күсерелгән' }, tone: 'warning' },
  { id: 'unknown', label: { ru: 'Статус не подтверждён', ba: 'Статусы раҫланмаған' }, tone: 'neutral' },
];

/** Подписи для плашки сеанса: статус и наличие билетов одним значением. */
export const DISPLAY_STATUSES: readonly DisplayStatusEntry[] = [
  { id: 'scheduled', label: { ru: 'Состоится', ba: 'Буласаҡ' }, tone: 'positive' },
  { id: 'cancelled', label: { ru: 'Отменён', ba: 'Юҡҡа сығарылған' }, tone: 'negative' },
  {
    id: 'postponed',
    label: { ru: 'Перенесён, дата уточняется', ba: 'Кисектерелгән, көнө асыҡлана' },
    tone: 'warning',
  },
  { id: 'rescheduled', label: { ru: 'Перенесён', ba: 'Күсерелгән' }, tone: 'warning' },
  { id: 'sold_out', label: { ru: 'Билеты кончились', ba: 'Билеттар бөткән' }, tone: 'neutral' },
  { id: 'unverified', label: { ru: 'Статус не подтверждён', ba: 'Статусы раҫланмаған' }, tone: 'neutral' },
];

export const AVAILABILITY: readonly AvailabilityEntry[] = [
  { id: 'available', label: { ru: 'Билеты есть', ba: 'Билеттар бар' }, tone: 'positive' },
  { id: 'sold_out', label: { ru: 'Билеты кончились', ba: 'Билеттар бөткән' }, tone: 'neutral' },
  {
    id: 'unknown',
    label: { ru: 'Наличие билетов не подтверждено', ba: 'Билеттар барлығы раҫланмаған' },
    tone: 'neutral',
  },
];

export const PRICE_KINDS: readonly OptionEntry<PriceKind>[] = [
  { id: 'free', label: { ru: 'Бесплатно', ba: 'Бушлай' } },
  { id: 'from', label: { ru: 'Платно', ba: 'Түләүле' } },
  { id: 'unknown', label: { ru: 'Цена не указана', ba: 'Хаҡы күрһәтелмәгән' } },
];

export const OFFER_AUDIENCES: readonly OptionEntry<OfferAudience>[] = [
  { id: 'adult', label: { ru: 'Взрослый', ba: 'Өлкәндәр өсөн' } },
  { id: 'child', label: { ru: 'Детский', ba: 'Балалар өсөн' } },
  { id: 'reduced', label: { ru: 'Льготный', ba: 'Ташламалы' } },
];

export const SORTS: readonly OptionEntry<SortKey>[] = [
  { id: 'date', label: { ru: 'Сначала ближайшие', ba: 'Башта яҡындағылары' } },
  { id: 'price', label: { ru: 'Сначала дешевле', ba: 'Башта арзаныраҡтары' } },
  { id: 'popularity', label: { ru: 'Сначала популярные', ba: 'Башта популярҙары' } },
];

export const DATE_PRESETS: readonly OptionEntry<DatePreset>[] = [
  { id: 'today', label: { ru: 'Сегодня', ba: 'Бөгөн' } },
  { id: 'tomorrow', label: { ru: 'Завтра', ba: 'Иртәгә' } },
  { id: 'weekend', label: { ru: 'На выходных', ba: 'Ял көндәрендә' } },
  { id: 'week', label: { ru: 'На этой неделе', ba: 'Ошо аҙнала' } },
];

export const OCCURRENCE_STATUSES: readonly OccurrenceStatus[] = STATUSES.map((entry) => entry.id);

/** Статусы, которые показываются без явного запроса. */
export const DEFAULT_STATUSES: readonly OccurrenceStatus[] = ['scheduled', 'rescheduled'];

export const DICTIONARIES: Dictionaries = {
  timezone: 'Asia/Yekaterinburg',
  currency: 'RUB',
  categories: [...CATEGORIES],
  cities: [...CITIES],
  age_ratings: [...AGE_RATINGS],
  statuses: [...STATUSES],
  display_statuses: [...DISPLAY_STATUSES],
  availability: [...AVAILABILITY],
  price_kinds: [...PRICE_KINDS],
  offer_audiences: [...OFFER_AUDIENCES],
  sorts: [...SORTS],
  date_presets: [...DATE_PRESETS],
};

export function isCategoryId(value: string): value is CategoryId {
  return CATEGORIES.some((entry) => entry.id === value);
}

export function isCityId(value: string): value is CityId {
  return CITIES.some((entry) => entry.slug === value);
}

export function isAgeRating(value: string): value is AgeRating {
  return AGE_RATINGS.some((entry) => entry.id === value);
}

export function isOccurrenceStatus(value: string): value is OccurrenceStatus {
  return OCCURRENCE_STATUSES.includes(value as OccurrenceStatus);
}

export function getCategory(id: string): CategoryEntry | undefined {
  return CATEGORIES.find((entry) => entry.id === id);
}

export function getCity(slug: string): CityEntry | undefined {
  return CITIES.find((entry) => entry.slug === slug);
}

/** С какого возраста можно по метке: «6+» это 6. */
export function ageRatingMin(rating: AgeRating): number {
  const entry = AGE_RATINGS.find((item) => item.id === rating);
  return entry ? entry.min_age : 0;
}

export function getDisplayStatusEntry(id: DisplayStatus): DisplayStatusEntry {
  const entry = DISPLAY_STATUSES.find((item) => item.id === id);
  if (!entry) throw new Error(`Неизвестный статус показа: ${id}`);
  return entry;
}

export function getAvailabilityEntry(id: Availability): AvailabilityEntry {
  const entry = AVAILABILITY.find((item) => item.id === id);
  if (!entry) throw new Error(`Неизвестное наличие билетов: ${id}`);
  return entry;
}

/**
 * Что писать на плашке сеанса. Отмена и перенос важнее наличия билетов,
 * неподтверждённый статус не выдаётся за «состоится».
 */
export function displayStatusOf(occurrence: Pick<Occurrence, 'status' | 'status_is_verified' | 'availability'>): DisplayStatus {
  if (occurrence.status === 'cancelled') return 'cancelled';
  if (occurrence.status === 'postponed') return 'postponed';
  if (occurrence.status === 'unknown' || !occurrence.status_is_verified) return 'unverified';
  if (occurrence.availability === 'sold_out') return 'sold_out';
  if (occurrence.status === 'rescheduled') return 'rescheduled';
  return 'scheduled';
}
