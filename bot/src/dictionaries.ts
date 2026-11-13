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
