/**
 * Время афиши. Все события республики идут по поясу Asia/Yekaterinburg.
 * Смещение там постоянное (+05:00, перехода на летнее время нет),
 * поэтому даты считаются арифметикой без Intl и без внешних библиотек.
 */

import type { TimeValue, Timezone } from './types';

export const TIMEZONE: Timezone = 'Asia/Yekaterinburg';
export const TZ_OFFSET_MINUTES = 300;
export const TZ_OFFSET = '+05:00';

const MS_MINUTE = 60_000;
const MS_DAY = 86_400_000;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export interface LocalNow {
  /** Дата в поясе афиши, ГГГГ-ММ-ДД. */
  date: string;
  /** Время в поясе афиши, ЧЧ:ММ. */
  time: string;
  /** День недели: 0 воскресенье, 6 суббота. */
  weekday: number;
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** Раскладывает момент времени на дату и время в поясе афиши. */
export function localNow(now: Date): LocalNow {
  const shifted = new Date(now.getTime() + TZ_OFFSET_MINUTES * MS_MINUTE);
  const date = `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
  const time = `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
  return { date, time, weekday: shifted.getUTCDay() };
}

/** Проверяет и формат, и существование даты: 2026-02-30 не пройдёт. */
export function isValidDate(value: string): boolean {
  const match = DATE_RE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

export function isValidTime(value: string): boolean {
  return TIME_RE.test(value);
}

function dateToUtcMs(date: string): number {
  const match = DATE_RE.exec(date);
  if (!match) throw new Error(`Некорректная дата: ${date}`);
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

export function makeDate(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function addDays(date: string, days: number): string {
  const shifted = new Date(dateToUtcMs(date) + days * MS_DAY);
  return makeDate(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

/** Разница b - a в днях. */
export function diffDays(a: string, b: string): number {
  return Math.round((dateToUtcMs(b) - dateToUtcMs(a)) / MS_DAY);
}

/** День недели даты: 0 воскресенье, 6 суббота. */
export function weekdayOf(date: string): number {
  return new Date(dateToUtcMs(date)).getUTCDay();
}

export function dateParts(date: string): { year: number; month: number; day: number } {
  const match = DATE_RE.exec(date);
  if (!match) throw new Error(`Некорректная дата: ${date}`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

export function timeToMinutes(time: string): number {
  const match = TIME_RE.exec(time);
  if (!match) throw new Error(`Некорректное время: ${time}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

export function minutesToTime(minutes: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, minutes));
  return `${pad(Math.floor(clamped / 60))}:${pad(clamped % 60)}`;
}

/** Момент начала локальных суток в миллисекундах UTC. */
export function startOfLocalDayMs(date: string): number {
  return dateToUtcMs(date) - TZ_OFFSET_MINUTES * MS_MINUTE;
}

/** Момент «дата + время» в миллисекундах UTC. */
export function localToMs(date: string, time: string): number {
  return startOfLocalDayMs(date) + timeToMinutes(time) * MS_MINUTE;
}

/** Значение времени с точностью до минуты. */
export function timedValue(date: string, time: string): TimeValue {
  return {
    local: `${date}T${time}:00${TZ_OFFSET}`,
    utc: new Date(localToMs(date, time)).toISOString().replace('.000Z', 'Z'),
    timezone: TIMEZONE,
    precision: 'minute',
  };
}

/** Значение времени с точностью до дня: UTC не вычисляется. */
export function dateValue(date: string): TimeValue {
  return { local: date, utc: null, timezone: TIMEZONE, precision: 'date' };
}

/** Дата (ГГГГ-ММ-ДД) из значения времени. */
export function valueDate(value: TimeValue): string {
  return value.local.slice(0, 10);
}

/** Время (ЧЧ:ММ) из значения времени или null для точности до дня. */
export function valueTime(value: TimeValue): string | null {
  return value.precision === 'minute' ? value.local.slice(11, 16) : null;
}

/**
 * Диапазон «выходные» относительно сегодняшней даты:
 * в будни это ближайшие суббота и воскресенье, в субботу сегодня и завтра,
 * в воскресенье только сегодня (прошедшая суббота в выдачу не попадает).
 */
export function weekendRange(today: string): { from: string; to: string } {
  const weekday = weekdayOf(today);
  if (weekday === 0) return { from: today, to: today };
  if (weekday === 6) return { from: today, to: addDays(today, 1) };
  const saturday = addDays(today, 6 - weekday);
  return { from: saturday, to: addDays(saturday, 1) };
}

/** Диапазон «на этой неделе»: с сегодня по ближайшее воскресенье включительно. */
export function weekRange(today: string): { from: string; to: string } {
  const weekday = weekdayOf(today);
  const daysToSunday = weekday === 0 ? 0 : 7 - weekday;
  return { from: today, to: addDays(today, daysToSunday) };
}

/** Ближайшая дата с нужным днём недели, начиная с сегодняшней (сегодня тоже считается). */
export function nextWeekday(today: string, weekday: number): string {
  const delta = (weekday - weekdayOf(today) + 7) % 7;
  return addDays(today, delta);
}

/** Понедельник недели, в которую входит дата. */
export function mondayOf(date: string): string {
  const weekday = weekdayOf(date);
  return addDays(date, weekday === 0 ? -6 : 1 - weekday);
}

/** Последний день месяца. */
export function endOfMonth(year: number, month: number): string {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return makeDate(year, month, last);
}

/** Округляет момент до начала минуты: ответы внутри одной минуты совпадают. */
export function floorToMinute(now: Date): Date {
  return new Date(Math.floor(now.getTime() / MS_MINUTE) * MS_MINUTE);
}
