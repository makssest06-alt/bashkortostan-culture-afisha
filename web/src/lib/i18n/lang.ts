/**
 * Языки интерфейса. Чистый модуль без React: его можно импортировать
 * и из серверных компонентов, и из обработчиков API.
 */

export const LANGS = ['ru', 'ba'] as const;

export type Lang = (typeof LANGS)[number];

export const DEFAULT_LANG: Lang = 'ru';

/** Имя cookie и ключа localStorage, где хранится выбранный язык. */
export const LANG_COOKIE = 'afisha_lang';
export const LANG_STORAGE_KEY = 'afisha_lang';

/** Значение атрибута lang у <html>: ba это код башкирского по ISO 639-1. */
export const HTML_LANG: Record<Lang, string> = { ru: 'ru', ba: 'ba' };

/** Строка на двух языках: `name[lang]`. */
export type LocalizedText = Record<Lang, string>;

export function isLang(value: unknown): value is Lang {
  return value === 'ru' || value === 'ba';
}

/** Любое постороннее значение превращается в язык по умолчанию. */
export function parseLang(value: unknown): Lang {
  return isLang(value) ? value : DEFAULT_LANG;
}

export function pick(text: LocalizedText, lang: Lang): string {
  return text[lang] || text[DEFAULT_LANG];
}
