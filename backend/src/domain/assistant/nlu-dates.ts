import {
  addDays,
  dateParts,
  daysBetween,
  endOfMonth,
  isValidYmd,
  makeDate,
  minutesToTime,
  mondayOf,
  nextWeekday,
  resolveDatePreset,
} from '../time.js';
import {
  MONTH_GENITIVE_PATTERN,
  MONTH_PREPOSITIONAL_PATTERN,
  NUMBER_WORDS,
  NUMBER_WORD_PATTERN,
  WEEKDAY_PATTERNS,
  monthNumber,
} from './nlu-lexicon.js';
import { consume, find, take, word, type Scanner } from './nlu-scanner.js';

export interface DateRange {
  from: string;
  to: string;
}

export interface TimeRange {
  start_from?: string;
  start_to?: string;
  fits_from?: string;
  fits_to?: string;
}

export interface NluAssumption {
  key: string;
  text: string;
}

export interface ParsedDate {
  range?: DateRange;
  past: boolean;
  notes: NluAssumption[];
}

const ASSUME_NEXT_YEAR_AFTER_DAYS = 60;

function resolveDate(
  day: number,
  month: number,
  explicitYear: number | null,
  today: string,
  notes: NluAssumption[],
): string | null {
  const currentYear = dateParts(today).year;
  if (explicitYear !== null) {
    const year = explicitYear < 100 ? 2000 + explicitYear : explicitYear;
    const date = makeDate(year, month, day);
    return isValidYmd(date) ? date : null;
  }
  const thisYear = makeDate(currentYear, month, day);
  if (!isValidYmd(thisYear)) return null;
  if (thisYear >= today || daysBetween(today, thisYear) >= -ASSUME_NEXT_YEAR_AFTER_DAYS) {
    return thisYear;
  }
  const nextYear = makeDate(currentYear + 1, month, day);
  if (!isValidYmd(nextYear)) return null;
  notes.push({ key: 'year_assumed', text: `год не назван: считаю, что это ${currentYear + 1} год` });
  return nextYear;
}

function parseAbsolute(scanner: Scanner, today: string, notes: NluAssumption[]): DateRange | null {
  const iso = find(scanner, word('(\\d{4})-(\\d{2})-(\\d{2})'));
  if (iso) {
    const date = `${iso[1]}-${iso[2]}-${iso[3]}`;
    if (isValidYmd(date)) {
      consume(scanner, iso);
      return { from: date, to: date };
    }
  }

  const numericRange = find(scanner, word('(\\d{1,2})\\s*-\\s*(\\d{1,2})\\.(\\d{1,2})(?:\\.(\\d{4}|\\d{2}))?'));
  if (numericRange) {
    const year = numericRange[4] ? Number(numericRange[4]) : null;
    const from = resolveDate(Number(numericRange[1]), Number(numericRange[3]), year, today, notes);
    const to = resolveDate(Number(numericRange[2]), Number(numericRange[3]), year, today, notes);
    if (from && to && from <= to) {
      consume(scanner, numericRange);
      return { from, to };
    }
  }

  const numeric = find(
    scanner,
    word('(\\d{1,2})\\.(\\d{1,2})(?:\\.(\\d{4}|\\d{2}))?(?!\\s*(?:тыс|к(?![а-я])|млн))'),
  );
  if (numeric) {
    const date = resolveDate(Number(numeric[1]), Number(numeric[2]), numeric[3] ? Number(numeric[3]) : null, today, notes);
    if (date) {
      consume(scanner, numeric);
      return { from: date, to: date };
    }
  }

  const longRange = take(
    scanner,
    word(
      `(?:с\\s+)?(\\d{1,2})\\s+(${MONTH_GENITIVE_PATTERN})\\s*(?:по|до|-)\\s*(\\d{1,2})\\s+(${MONTH_GENITIVE_PATTERN})(?:\\s+(\\d{4}))?`,
    ),
  );
  if (longRange) {
    const year = longRange[5] ? Number(longRange[5]) : null;
    const from = resolveDate(Number(longRange[1]), monthNumber(longRange[2]), year, today, notes);
    const to = resolveDate(Number(longRange[3]), monthNumber(longRange[4]), year, today, notes);
    if (from && to && from <= to) return { from, to };
  }

  const shortRange = take(
    scanner,
    word(`(?:с\\s+)?(\\d{1,2})\\s*(?:по|до|-|и)\\s*(\\d{1,2})\\s+(${MONTH_GENITIVE_PATTERN})(?:\\s+(\\d{4}))?`),
  );
  if (shortRange) {
    const year = shortRange[4] ? Number(shortRange[4]) : null;
    const month = monthNumber(shortRange[3]);
    const from = resolveDate(Number(shortRange[1]), month, year, today, notes);
    const to = resolveDate(Number(shortRange[2]), month, year, today, notes);
    if (from && to && from <= to) return { from, to };
  }

  const single = take(scanner, word(`(\\d{1,2})\\s+(${MONTH_GENITIVE_PATTERN})(?:\\s+(\\d{4}))?`));
  if (single) {
    const date = resolveDate(
      Number(single[1]),
      monthNumber(single[2]),
      single[3] ? Number(single[3]) : null,
      today,
      notes,
    );
    if (date) return { from: date, to: date };
  }
  return null;
}

function parseRelative(scanner: Scanner, today: string, notes: NluAssumption[]): DateRange | null {
  if (take(scanner, word('послезавтра'))) return { from: addDays(today, 2), to: addDays(today, 2) };
  if (take(scanner, word('позавчера'))) return { from: addDays(today, -2), to: addDays(today, -2) };
  if (take(scanner, word('завтра'))) return { from: addDays(today, 1), to: addDays(today, 1) };
  if (take(scanner, word('вчера'))) return { from: addDays(today, -1), to: addDays(today, -1) };
  if (take(scanner, word('сегодня|сегодняшн[а-я]+|сейчас|прямо\\s+сейчас'))) return { from: today, to: today };

  const inDays = take(scanner, word(`через\\s+(\\d{1,2}|${NUMBER_WORD_PATTERN})\\s+(?:дн[а-я]+|день)`));
  if (inDays) {
    const count = /^\d+$/.test(inDays[1]) ? Number(inDays[1]) : NUMBER_WORDS[inDays[1]];
    const date = addDays(today, count);
    return { from: date, to: date };
  }
  if (take(scanner, word('через\\s+неделю'))) return { from: addDays(today, 7), to: addDays(today, 7) };

  const nextWeekend = take(scanner, word('(?:на|в)\\s+следующ[а-я]+\\s+выходн[а-я]+'));
  if (nextWeekend) {
    const saturday = addDays(mondayOf(addDays(today, 7)), 5);
    notes.push({ key: 'next_week_calendar_interpretation', text: 'следующие выходные = выходные следующей недели' });
    return { from: saturday, to: addDays(saturday, 1) };
  }
  if (take(scanner, word('(?:(?:на|в)\\s+)?(?:эти[а-я]*\\s+|ближайш[а-я]+\\s+)?выходн[а-я]+|уикенд[а-я]*'))) {
    return resolveDatePreset('weekend', today);
  }

  if (take(scanner, word('на\\s+следующей\\s+неделе'))) {
    const monday = mondayOf(addDays(today, 7));
    return { from: monday, to: addDays(monday, 6) };
  }
  if (take(scanner, word('на\\s+(?:этой\\s+)?неделе|в\\s+течение\\s+недели|в\\s+ближайшие\\s+дни'))) {
    return resolveDatePreset('week', today);
  }

  const days: string[] = [];
  for (const { weekday, pattern } of WEEKDAY_PATTERNS) {
    const match = take(scanner, word(`(?:(?:в|во|на|к)\\s+)?(следующ[а-я]+\\s+|эт[а-я]+\\s+|ближайш[а-я]+\\s+)?(?:${pattern})`));
    if (!match) continue;
    if (match[1]?.startsWith('следующ')) {
      const date = addDays(mondayOf(addDays(today, 7)), weekday === 0 ? 6 : weekday - 1);
      notes.push({ key: 'next_week_calendar_interpretation', text: 'следующая = на следующей календарной неделе' });
      days.push(date);
    } else {
      const nearest = nextWeekday(today, weekday);
      const meansToday = Boolean(match[1]?.startsWith('эт'));
      days.push(nearest === today && !meansToday ? addDays(nearest, 7) : nearest);
    }
  }
  if (days.length > 0) {
    days.sort();
    return { from: days[0], to: days[days.length - 1] };
  }

  const month = take(scanner, word(`в\\s+(${MONTH_PREPOSITIONAL_PATTERN})`));
  if (month) {
    const number = monthNumber(month[1]);
    const current = dateParts(today);
    const year = number < current.month ? current.year + 1 : current.year;
    const first = makeDate(year, number, 1);
    return { from: first > today ? first : today, to: endOfMonth(year, number) };
  }
  return null;
}

export function parseDate(scanner: Scanner, today: string): ParsedDate {
  const notes: NluAssumption[] = [];
  const range = parseAbsolute(scanner, today, notes) ?? parseRelative(scanner, today, notes);
  if (!range) return { past: false, notes };
  return { range, past: range.to < today, notes };
}

const HOUR = `(\\d{1,2})(?::(\\d{2}))?|${NUMBER_WORD_PATTERN}`;
const DAY_PART = '(?:\\s+(?:час(?:а|ов)?|ч))?(?:\\s+(утра|дня|вечера|ночи))?';

function toClock(raw: string, minutes: string | undefined, part: string | undefined): string | null {
  let hour = /^\d/.test(raw) ? Number(raw.split(':')[0]) : NUMBER_WORDS[raw];
  if (hour === undefined || Number.isNaN(hour) || hour > 23) return null;
  if (part === 'вечера' && hour < 12) hour += 12;
  if (part === 'дня' && hour < 6) hour += 12;
  const mins = minutes ? Number(minutes) : 0;
  if (mins > 59) return null;
  return minutesToTime(hour * 60 + mins);
}

export interface ParsedTime {
  time?: TimeRange;
  notes: NluAssumption[];
}

export function parseTime(scanner: Scanner): ParsedTime {
  const notes: NluAssumption[] = [];
  const time: TimeRange = {};

  const window = find(
    scanner,
    word(`(начал[а-я]*\\s+)?с\\s+(\\d{1,2})(?::(\\d{2}))?\\s+до\\s+(\\d{1,2})(?::(\\d{2}))?(?!\\s*(?:лет|год|руб|₽|тыс))`),
  );
  if (window) {
    const from = toClock(window[2], window[3], undefined);
    const to = toClock(window[4], window[5], undefined);
    if (from && to && from < to) {
      consume(scanner, window);
      if (window[1]) {
        time.start_from = from;
        time.start_to = to;
      } else {
        time.fits_from = from;
        time.fits_to = to;
      }
    }
  }

  const after = find(scanner, word(`(?:после|не\\s+раньше|позже|начиная\\s+с)\\s+(${HOUR})${DAY_PART}`));
  if (after) {
    const clock = toClock(after[1], after[3], after[4]);
    if (clock) {
      consume(scanner, after);
      time.start_from = clock;
    }
  }

  const before = find(
    scanner,
    word(`(начал[а-я]*\\s+|началось\\s+|старт[а-я]*\\s+)?(до|не\\s+позже|не\\s+позднее|раньше)\\s+(${HOUR})(\\s+(?:час(?:а|ов)?|ч))?(?:\\s+(утра|дня|вечера|ночи))?`),
  );
  if (before) {
    const hasColon = before[5] !== undefined;
    const explicit = Boolean(before[1]) || hasColon || Boolean(before[6]) || Boolean(before[7]) || before[2] !== 'до';
    const clock = explicit ? toClock(before[3], before[5], before[7]) : null;
    if (clock) {
      consume(scanner, before);
      time.start_to = clock;
    }
  }

  if (time.start_from === undefined && time.start_to === undefined && time.fits_from === undefined) {
    if (take(scanner, word('вечером|вечерн[а-я]+|на\\s+вечер|вечерк[а-я]+'))) {
      time.start_from = '18:00';
      time.start_to = '23:00';
    } else if (take(scanner, word('утром|с\\s+утра|утренн[а-я]+|на\\s+утро'))) {
      time.start_from = '06:00';
      time.start_to = '12:00';
    } else if (take(scanner, word('днем|дневн[а-я]+|в\\s+обед|после\\s+обеда'))) {
      time.start_from = '12:00';
      time.start_to = '18:00';
    }
  }

  if (time.start_to === undefined && take(scanner, word('не\\s+поздно|без\\s+поздних|не\\s+допоздна'))) {
    time.start_to = '20:00';
    notes.push({ key: 'not_late_20', text: 'не поздно = начало до 20:00' });
  }

  return Object.keys(time).length > 0 ? { time, notes } : { notes };
}
