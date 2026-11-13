/**
 * Подписи для дат, цен и «проверено N часов назад» на двух языках.
 * Чистые функции без зависимостей: годятся и для сервера, и для клиентских компонентов.
 */

import type { Lang } from '../i18n/lang';
import { dateParts, diffDays, valueDate, valueTime, weekdayOf } from './time';
import type { Occurrence, PriceSummary, TimeValue } from './types';

const NBSP = ' ';

const MONTHS_GENITIVE: Record<Lang, readonly string[]> = {
  ru: [
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
  ],
  ba: [
    'ғинуар',
    'февраль',
    'март',
    'апрель',
    'май',
    'июнь',
    'июль',
    'август',
    'сентябрь',
    'октябрь',
    'ноябрь',
    'декабрь',
  ],
};

/** Индекс: 0 воскресенье, 6 суббота. */
const WEEKDAYS_SHORT: Record<Lang, readonly string[]> = {
  ru: ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'],
  ba: ['йк', 'дш', 'шш', 'шр', 'кс', 'йм', 'шб'],
};

const WEEKDAYS_LONG: Record<Lang, readonly string[]> = {
  ru: ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'],
  ba: ['йәкшәмбе', 'дүшәмбе', 'шишәмбе', 'шаршамбы', 'кесаҙна', 'йома', 'шәмбе'],
};

/** «в субботу», «во вторник»: только для русского текста ассистента. */
const WEEKDAYS_IN_RU: readonly string[] = [
  'в воскресенье',
  'в понедельник',
  'во вторник',
  'в среду',
  'в четверг',
  'в пятницу',
  'в субботу',
];

/** Русское склонение после числа: 1 событие, 2 события, 5 событий. */
export function pluralRu(count: number, forms: readonly [string, string, string]): string {
  const abs = Math.abs(count) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (last === 1) return forms[0];
  if (last >= 2 && last <= 4) return forms[1];
  return forms[2];
}

/** Какая из трёх форм нужна: 'one' | 'few' | 'many'. В башкирском форма одна. */
export function pluralCategory(count: number, lang: Lang): 'one' | 'few' | 'many' {
  if (lang !== 'ru') return 'many';
  return pluralRu(count, ['one', 'few', 'many']) as 'one' | 'few' | 'many';
}

export function formatNumber(value: number): string {
  const [whole, fraction] = String(value).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return fraction ? `${grouped},${fraction}` : grouped;
}

/** Сумма в рублях: «1 500 ₽». */
export function formatRub(rub: number): string {
  return `${formatNumber(rub)}${NBSP}₽`;
}

/** Сумма из копеек: 150000 превращается в «1 500 ₽». */
export function formatMinor(amountMinor: number): string {
  return formatRub(amountMinor / 100);
}

/** Цена на карточке. «Бесплатно» и «цена не указана» различаются всегда. */
export function formatPrice(summary: PriceSummary, lang: Lang = 'ru'): string {
  if (summary.kind === 'free') return lang === 'ba' ? 'Бушлай' : 'Бесплатно';
  if (summary.kind === 'unknown') return lang === 'ba' ? 'Хаҡы күрһәтелмәгән' : 'Цена не указана';
  const amount = (summary.amount_minor ?? 0) / 100;
  return lang === 'ba' ? `${formatNumber(amount)}${NBSP}һумдан` : `от${NBSP}${formatRub(amount)}`;
}

export interface DayFormat {
  /** Добавить день недели: «сб, 14 ноября». */
  weekday?: 'short' | 'long';
  year?: boolean;
}

/** «14 ноября», «сб, 14 ноября», «14 ноября 2026». */
export function formatDay(date: string, lang: Lang = 'ru', format: DayFormat = {}): string {
  const { year, month, day } = dateParts(date);
  let text = `${day}${NBSP}${MONTHS_GENITIVE[lang][month - 1]}`;
  if (format.year) text += ` ${year}`;
  if (format.weekday) {
    const names = format.weekday === 'long' ? WEEKDAYS_LONG : WEEKDAYS_SHORT;
    text = `${names[lang][weekdayOf(date)]}, ${text}`;
  }
  return text;
}

export function weekdayName(date: string, lang: Lang = 'ru', form: 'short' | 'long' = 'long'): string {
  return (form === 'long' ? WEEKDAYS_LONG : WEEKDAYS_SHORT)[lang][weekdayOf(date)];
}

/** «в субботу», «во вторник». */
export function weekdayInRu(date: string): string {
  return WEEKDAYS_IN_RU[weekdayOf(date)];
}

/** «14-15 ноября», «30 ноября - 2 декабря». Один день: «14 ноября». */
export function formatDateRange(from: string, to: string, lang: Lang = 'ru'): string {
  if (from === to) return formatDay(from, lang);
  const a = dateParts(from);
  const b = dateParts(to);
  if (a.year === b.year && a.month === b.month) {
    return `${a.day}-${b.day}${NBSP}${MONTHS_GENITIVE[lang][b.month - 1]}`;
  }
  return `${formatDay(from, lang)} - ${formatDay(to, lang)}`;
}

/** «сегодня», «завтра» или null для остальных дней. */
export function relativeDay(date: string, today: string, lang: Lang = 'ru'): string | null {
  const delta = diffDays(today, date);
  if (delta === 0) return lang === 'ba' ? 'бөгөн' : 'сегодня';
  if (delta === 1) return lang === 'ba' ? 'иртәгә' : 'завтра';
  return null;
}

/** Дата и время одного значения: «сб, 14 ноября, 12:00» или «14 ноября» без времени. */
export function formatTimeValue(value: TimeValue, lang: Lang = 'ru'): string {
  const date = valueDate(value);
  const time = valueTime(value);
  const day = formatDay(date, lang, { weekday: 'short' });
  return time ? `${day}, ${time}` : formatDay(date, lang);
}

/**
 * Когда проходит сеанс. Для сеанса со временем: «сб, 14 ноября, 12:00».
 * Для выставки с периодом: «до 2 декабря», если уже идёт, иначе «с 13 по 27 ноября».
 */
export function formatOccurrence(occurrence: Occurrence, lang: Lang = 'ru', today?: string): string {
  if (occurrence.start.precision === 'minute') return formatTimeValue(occurrence.start, lang);
  const from = valueDate(occurrence.start);
  if (!occurrence.end) return formatDay(from, lang);
  const to = valueDate(occurrence.end);
  if (today && from <= today) {
    return lang === 'ba' ? `${formatDay(to, lang)} тиклем` : `до ${formatDay(to, lang)}`;
  }
  const a = dateParts(from);
  const b = dateParts(to);
  if (lang === 'ba') return `${formatDay(from, lang)} - ${formatDay(to, lang)}`;
  if (a.year === b.year && a.month === b.month) return `с ${a.day} по ${formatDay(to, lang)}`;
  return `с ${formatDay(from, lang)} по ${formatDay(to, lang)}`;
}

/** Как давно проверяли запись: «2 часа назад», «вчера», «3 дня назад». */
export function formatAgo(checkedAt: string, now: Date = new Date(), lang: Lang = 'ru'): string {
  const diffMs = Math.max(0, now.getTime() - Date.parse(checkedAt));
  const minutes = Math.floor(diffMs / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (lang === 'ba') {
    if (minutes < 1) return 'әле генә';
    if (hours < 1) return `${minutes}${NBSP}минут элек`;
    if (days < 1) return `${hours}${NBSP}сәғәт элек`;
    if (days === 1) return 'кисә';
    return `${days}${NBSP}көн элек`;
  }
  if (minutes < 1) return 'только что';
  if (hours < 1) return `${minutes}${NBSP}${pluralRu(minutes, ['минуту', 'минуты', 'минут'])} назад`;
  if (days < 1) return `${hours}${NBSP}${pluralRu(hours, ['час', 'часа', 'часов'])} назад`;
  if (days === 1) return 'вчера';
  return `${days}${NBSP}${pluralRu(days, ['день', 'дня', 'дней'])} назад`;
}
