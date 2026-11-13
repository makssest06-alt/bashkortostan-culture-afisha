const HOMOGLYPH_MAP: Record<string, string> = {
  a: 'а',
  e: 'е',
  o: 'о',
  p: 'р',
  c: 'с',
  x: 'х',
  k: 'к',
  y: 'у',
  t: 'т',
  h: 'н',
  m: 'м',
  b: 'в',
};

/**
 * Исправляет смешанную кириллицу+латиницу («Уфa» -> «Уфа») только внутри слов,
 * где есть хотя бы одна кириллическая буква. Чистая латиница («Ufa», «sql») остаётся как есть.
 */
export function normalizeHomoglyphs(input: string): { text: string; fixed: boolean } {
  let fixed = false;
  const text = input.replace(/[A-Za-zА-Яа-яЁё]+/g, (token) => {
    const hasCyr = /[А-Яа-яЁё]/.test(token);
    const hasLat = /[A-Za-z]/.test(token);
    if (!hasCyr || !hasLat) return token;
    const replaced = token.replace(/[A-Za-z]/g, (ch) => {
      const mapped = HOMOGLYPH_MAP[ch.toLowerCase()];
      if (mapped) fixed = true;
      return mapped ?? ch;
    });
    return replaced;
  });
  return { text, fixed };
}

export function normalizeNluText(input: string): string {
  return input
    .normalize('NFC')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[‐‑‒–—―−]/g, '-')
    .replace(/[«»“”„"]/g, ' ')
    .replace(/[\u00a0\u202f\u2009]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenizeNlu(input: string): string[] {
  return normalizeNluText(input)
    .split(/[^a-zа-я0-9әөүғҡңҙҫһ-]+/i)
    .map((t) => t.replace(/^-+|-+$/g, ''))
    .filter((token) => token.length >= 2);
}

export function stemRu(token: string): string {
  if (/^\d+$/.test(token)) return token;
  if (token.length >= 7) return token.slice(0, -2);
  if (token.length >= 5) return token.slice(0, -1);
  return token;
}

export function levenshtein1(a: string, b: string): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 1) return 2;
  const dp: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = i - 1;
    dp[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cur = dp[j];
      if (a[i - 1] === b[j - 1]) dp[j] = prev;
      else dp[j] = Math.min(prev, dp[j - 1], cur) + 1;
      prev = cur;
    }
  }
  return dp[b.length];
}

export interface Scanner {
  rest: string;
  readonly full: string;
  readonly homoglyphFixed: boolean;
}

const LEFT = '(?<![a-zа-я0-9])';
const RIGHT = '(?![a-zа-я0-9])';

export function word(body: string): RegExp {
  return new RegExp(`${LEFT}(?:${body})${RIGHT}`);
}

export function createScanner(rawText: string): Scanner {
  const { text, fixed } = normalizeHomoglyphs(rawText);
  const normalized = ` ${normalizeNluText(text)} `;
  return { rest: normalized, full: normalized, homoglyphFixed: fixed };
}

export function find(scanner: Scanner, pattern: RegExp): RegExpExecArray | null {
  return new RegExp(pattern.source, pattern.flags.replace('g', '')).exec(scanner.rest);
}

export function consume(scanner: Scanner, match: RegExpExecArray): void {
  const start = match.index;
  const end = start + match[0].length;
  scanner.rest = scanner.rest.slice(0, start) + ' '.repeat(end - start) + scanner.rest.slice(end);
}

export function take(scanner: Scanner, pattern: RegExp): RegExpExecArray | null {
  const match = find(scanner, pattern);
  if (match) consume(scanner, match);
  return match;
}

export function takeAll(scanner: Scanner, pattern: RegExp): RegExpExecArray[] {
  const matches: RegExpExecArray[] = [];
  for (let guard = 0; guard < 20; guard += 1) {
    const match = take(scanner, pattern);
    if (!match) break;
    matches.push(match);
  }
  return matches;
}

export function mentions(scanner: Scanner, pattern: RegExp): boolean {
  return pattern.test(scanner.full);
}

export function before(scanner: Scanner, match: RegExpExecArray, length = 16): string {
  return scanner.full.slice(Math.max(0, match.index - length), match.index);
}
