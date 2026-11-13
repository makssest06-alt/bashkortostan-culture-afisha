/**
 * Работа с датами и временем в часовом поясе республики (Asia/Yekaterinburg, UTC+05:00).
 */

export const TIMEZONE = 'Asia/Yekaterinburg' as const;
export const TZ_OFFSET = '+05:00';
const OFFSET_MS = 5 * 3_600_000;

export type DatePreset = 'today' | 'tomorrow' | 'weekend' | 'week';

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Локальные дата и время ЧЧ:ММ для момента now в +05:00. */
export function localNow(now: Date = new Date()): { date: string; time: string } {
  const shifted = new Date(now.getTime() + OFFSET_MS);
  return {
    date: `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`,
    time: `${pad2(shifted.getUTCHours())}:${pad2(shifted.getUTCMinutes())}`,
  };
}

/** Добавить N дней к дате ГГГГ-ММ-ДД. */
export function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/** День недели 0 (вс) .. 6 (сб) для локальной даты ГГГГ-ММ-ДД. */
export function weekdayIndex(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Ближайшая такая же дата или следующий такой день недели (0=вс..6=сб). */
export function nextWeekday(fromYmd: string, targetDay: number): string {
  const current = weekdayIndex(fromYmd);
  const diff = (targetDay - current + 7) % 7;
  return addDays(fromYmd, diff);
}

/** Миллисекунды UTC для локальных ГГГГ-ММ-ДД и ЧЧ:ММ (+05:00). */
export function localToMs(ymd: string, hm = '00:00'): number {
  return Date.parse(`${ymd}T${hm}:00${TZ_OFFSET}`);
}

/** RFC 3339 с поясом +05:00. */
export function formatRfc3339Local(date: Date | number): string {
  const ms = typeof date === 'number' ? date : date.getTime();
  const shifted = new Date(ms + OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = pad2(shifted.getUTCMonth() + 1);
  const d = pad2(shifted.getUTCDate());
  const hh = pad2(shifted.getUTCHours());
  const mm = pad2(shifted.getUTCMinutes());
  const ss = pad2(shifted.getUTCSeconds());
  return `${y}-${m}-${d}T${hh}:${mm}:${ss}${TZ_OFFSET}`;
}

export function isValidYmd(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() + 1 === m && dt.getUTCDate() === d;
}

export function isValidHm(value: string): boolean {
  if (!/^\d{2}:\d{2}$/.test(value)) return false;
  const [hh, mm] = value.split(':').map(Number);
  return hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59;
}

export function daysBetween(fromYmd: string, toYmd: string): number {
  const [fy, fm, fd] = fromYmd.split('-').map(Number);
  const [ty, tm, td] = toYmd.split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

/** Развернуть готовый период today | tomorrow | weekend | week в диапазон [from, to]. */
export function resolveDatePreset(preset: DatePreset, today: string): { from: string; to: string } {
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'tomorrow': {
      const t = addDays(today, 1);
      return { from: t, to: t };
    }
    case 'weekend': {
      const dow = weekdayIndex(today);
      if (dow === 0) return { from: today, to: today };
      if (dow === 6) return { from: today, to: addDays(today, 1) };
      const sat = addDays(today, 6 - dow);
      return { from: sat, to: addDays(sat, 1) };
    }
    case 'week': {
      return { from: today, to: addDays(today, 6) };
    }
  }
}

export function formatRuDay(ymd: string): string {
  const [, m, d] = ymd.split('-').map(Number);
  const months = [
    'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
  ];
  return `${d} ${months[m - 1] ?? ''}`.trim();
}
