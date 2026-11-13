/** Подписи и форматирование для админки. */

import { CATEGORIES } from '@/data/dictionaries';
import type { CategoryId, EventStatus } from '@/lib/api/types';

export const STATUS_LABEL: Record<EventStatus, string> = {
  published: 'Опубликовано',
  draft: 'Черновик',
  cancelled: 'Отменено',
};

export const STATUS_TONE: Record<EventStatus, string> = {
  published: 'text-status-ok border-status-ok/50',
  draft: 'text-status-unverified border-status-unverified/50',
  cancelled: 'text-status-cancelled border-status-cancelled/60',
};

export const ACTION_LABEL: Record<string, string> = {
  create: 'создание',
  import: 'импорт файла',
  update: 'правка',
  status: 'смена статуса',
  import_add: 'импорт: добавлено',
  import_update: 'импорт: обновлено',
  import_merge: 'импорт: добавлен источник',
  moderation: 'модерация',
  application: 'заявка',
  reset: 'сброс демо-данных',
};

export const FIELD_LABEL: Record<string, string> = {
  title: 'Название',
  description: 'Описание',
  category: 'Категория',
  tags: 'Метки',
  status: 'Статус',
  age_limit: 'Возраст',
  price_min: 'Цена от',
  price_max: 'Цена до',
  is_free: 'Бесплатно',
  address: 'Адрес',
  org_link: 'Билеты',
  language: 'Язык',
  source_url: 'Источник',
  date_start: 'Начало',
  date_end: 'Окончание',
  duration_min: 'Длительность',
  venue: 'Площадка',
  sources: 'Источники',
  'review.disputed': 'Спорная',
};

export const REASON_LABEL: Record<string, string> = {
  price_unknown: 'Не указана цена',
  age_unknown: 'Не указано возрастное ограничение',
  venue_unmatched: 'Площадка не найдена в справочнике',
  missing_description: 'Нет описания события',
};

export function reasonText(reason: string): string {
  return REASON_LABEL[reason] ?? reason;
}

export function categoryLabel(id: CategoryId | string): string {
  return CATEGORIES.find((entry) => entry.id === id)?.name_one.ru ?? String(id);
}

const DATE = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', timeZone: 'Asia/Yekaterinburg' });
const DATE_TIME = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Yekaterinburg',
});

/** Дата события: «14 нояб., 19:00» или «14 нояб.», если известна только дата. */
export function eventWhen(dateStart: string | null, precision: 'minute' | 'date'): string {
  if (!dateStart) return 'нет сеансов';
  const date = new Date(dateStart);
  return precision === 'date' ? DATE.format(date) : DATE_TIME.format(date);
}

export function stamp(iso: string): string {
  return DATE_TIME.format(new Date(iso));
}

/** Значение поля в журнале: «пусто», «да/нет», статус по-русски. */
export function valueText(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return 'пусто';
  if (typeof value === 'boolean') return value ? 'да' : 'нет';
  if (field === 'status' && typeof value === 'string' && value in STATUS_LABEL) return STATUS_LABEL[value as EventStatus];
  if (field === 'category' && typeof value === 'string') return categoryLabel(value);
  if (Array.isArray(value)) return value.length ? value.join(', ') : 'пусто';
  const text = String(value);
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}
