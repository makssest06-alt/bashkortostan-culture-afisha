/**
 * Словари интерфейса и функция перевода. Чистый модуль без React:
 * годится для серверных компонентов, generateMetadata и обработчиков API.
 *
 *   translate('ba', 'nav.events')                    -> 'Саралар'
 *   translate('ru', 'events.count', { count: 5 })    -> '5 событий'
 *   translate('ru', 'event.checked', { ago: '2 часа назад' })
 *
 * Множественное число: в словаре лежат три ключа с окончаниями .one, .few и .many,
 * а вызывается общий ключ без окончания и с числом в `count`.
 * Если ключа нет в башкирском словаре, берётся русский текст.
 */

import { ba } from './dict.ba';
import { ru } from './dict.ru';
import type { DictKey } from './dict.ru';
import { DEFAULT_LANG } from './lang';
import type { Lang } from './lang';

export { ru, ba };
export type { DictKey };

/** Общий ключ множественного числа: 'events.count' для 'events.count.one' и соседей. */
export type PluralKey = DictKey extends infer Key ? (Key extends `${infer Base}.one` ? Base : never) : never;

/** Всё, что можно передать в t(): обычный ключ или общий ключ множественного числа. */
export type TKey = DictKey | PluralKey;

export type TVars = Record<string, string | number>;

export type TFunction = (key: TKey, vars?: TVars) => string;

export const dictionaries: Record<Lang, Partial<Record<DictKey, string>>> = { ru, ba };

type PluralForm = 'one' | 'few' | 'many';

/** Русские формы после числа: 1 событие, 2 события, 5 событий. В башкирском форма одна. */
export function pluralForm(count: number, lang: Lang): PluralForm {
  if (lang !== 'ru') return 'many';
  const abs = Math.abs(Math.trunc(count)) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return 'many';
  if (last === 1) return 'one';
  if (last >= 2 && last <= 4) return 'few';
  return 'many';
}

function lookup(lang: Lang, key: string): string | undefined {
  const own = (dictionaries[lang] as Record<string, string | undefined>)[key];
  if (own !== undefined && own !== '') return own;
  return (dictionaries[DEFAULT_LANG] as Record<string, string | undefined>)[key];
}

function interpolate(template: string, vars: TVars | undefined): string {
  if (!vars) return template;
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (placeholder, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : placeholder,
  );
}

/** Есть ли такой ключ в словарях (обычный или общий ключ множественного числа). */
export function hasKey(key: string): key is TKey {
  return lookup(DEFAULT_LANG, key) !== undefined || lookup(DEFAULT_LANG, `${key}.one`) !== undefined;
}

/**
 * Перевод ключа. Неизвестный ключ возвращается как есть: пропуск виден на экране
 * и не роняет страницу.
 */
export function translate(lang: Lang, key: TKey, vars?: TVars): string {
  const direct = lookup(lang, key);
  if (direct !== undefined) return interpolate(direct, vars);

  const count = vars?.count;
  if (typeof count === 'number') {
    const plural = lookup(lang, `${key}.${pluralForm(count, lang)}`);
    if (plural !== undefined) return interpolate(plural, vars);
  }
  return key;
}

/** Функция перевода, привязанная к языку: удобно в серверных компонентах. */
export function createT(lang: Lang): TFunction {
  return (key, vars) => translate(lang, key, vars);
}
