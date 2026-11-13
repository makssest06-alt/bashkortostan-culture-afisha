/**
 * Нормализация текста для поиска и разбора фраз.
 * Регистр и разница между «ё» и «е» не учитываются.
 */

/** Нижний регистр, ё как е, любые тире и кавычки приводятся к простым знакам. */
export function normalizeText(input: string): string {
  return input
    .normalize('NFC')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[‐-―−]/g, '-')
    .replace(/[«»“”„"]/g, ' ')
    .replace(/[   ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Слова запроса длиной от двух знаков. */
export function tokenize(input: string): string[] {
  return normalizeText(input)
    .split(/[^a-zа-я0-9әөүғҡңҙҫһ]+/i)
    .filter((token) => token.length >= 2);
}

/**
 * Грубая основа слова: у длинных слов срезается окончание,
 * чтобы «органный» находил «органной», а «выставки» находили «выставка».
 */
export function stem(token: string): string {
  if (/^\d+$/.test(token)) return token;
  if (token.length >= 7) return token.slice(0, -2);
  if (token.length >= 5) return token.slice(0, -1);
  return token;
}

/** Все ли слова запроса встречаются в тексте (по основам). */
export function matchesAllTokens(haystack: string, query: string): boolean {
  const tokens = tokenize(query);
  if (tokens.length === 0) return true;
  const normalized = normalizeText(haystack);
  return tokens.every((token) => normalized.includes(stem(token)));
}
