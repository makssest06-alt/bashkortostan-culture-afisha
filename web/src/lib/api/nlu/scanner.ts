/**
 * Просмотр фразы по частям. Каждый разборщик забирает свой фрагмент,
 * и на его месте остаются пробелы: число из «до 7 лет» уже не станет бюджетом,
 * а «14 ноября» не превратится в возраст.
 */

import { normalizeText } from '../text';

export interface Scanner {
  /** Ещё не разобранный текст в нормализованном виде, с пробелами по краям. */
  rest: string;
  /** Вся фраза в нормализованном виде: для проверок, которым нужен контекст. */
  readonly full: string;
}

/** Граница слова для кириллицы: встроенный \b в JavaScript её не понимает. */
const LEFT = '(?<![a-zа-я0-9])';
const RIGHT = '(?![a-zа-я0-9])';

/** Собирает выражение, которое совпадает только с целыми словами. */
export function word(body: string): RegExp {
  return new RegExp(`${LEFT}(?:${body})${RIGHT}`);
}

export function createScanner(text: string): Scanner {
  const normalized = ` ${normalizeText(text)} `;
  return { rest: normalized, full: normalized };
}

/** Ищет совпадение в неразобранной части, ничего не забирая. */
export function find(scanner: Scanner, pattern: RegExp): RegExpExecArray | null {
  return new RegExp(pattern.source, pattern.flags.replace('g', '')).exec(scanner.rest);
}

/** Забирает найденный фрагмент: на его месте остаются пробелы той же длины. */
export function consume(scanner: Scanner, match: RegExpExecArray): void {
  const start = match.index;
  const end = start + match[0].length;
  scanner.rest = scanner.rest.slice(0, start) + ' '.repeat(end - start) + scanner.rest.slice(end);
}

/** Ищет и сразу забирает первое совпадение. */
export function take(scanner: Scanner, pattern: RegExp): RegExpExecArray | null {
  const match = find(scanner, pattern);
  if (match) consume(scanner, match);
  return match;
}

/** Забирает все совпадения по очереди. */
export function takeAll(scanner: Scanner, pattern: RegExp): RegExpExecArray[] {
  const matches: RegExpExecArray[] = [];
  for (let guard = 0; guard < 20; guard += 1) {
    const match = take(scanner, pattern);
    if (!match) break;
    matches.push(match);
  }
  return matches;
}

/** Есть ли совпадение во всей фразе, включая уже разобранные части. */
export function mentions(scanner: Scanner, pattern: RegExp): boolean {
  return pattern.test(scanner.full);
}

/** Текст перед совпадением: нужен, чтобы заметить «кроме» или «не» перед словом. */
export function before(scanner: Scanner, match: RegExpExecArray, length = 14): string {
  return scanner.full.slice(Math.max(0, match.index - length), match.index);
}
