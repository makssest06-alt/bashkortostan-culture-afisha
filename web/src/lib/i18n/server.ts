/**
 * Язык на сервере: читает cookie, которую ставит переключатель РУС/БАШ.
 *
 *   const lang = await getServerLang();
 *   <html lang={HTML_LANG[lang]}>
 *     <I18nProvider initialLang={lang}>...</I18nProvider>
 *
 * Чтение cookie делает страницу динамической (она перестаёт собираться статически).
 * Если статическая сборка важнее, этот модуль можно не использовать:
 * I18nProvider сам подхватит язык в браузере сразу после загрузки.
 */

import { cookies } from 'next/headers';

import { createT } from './dict';
import type { TFunction } from './dict';
import { LANG_COOKIE, parseLang } from './lang';
import type { Lang } from './lang';

export async function getServerLang(): Promise<Lang> {
  const store = await cookies();
  return parseLang(store.get(LANG_COOKIE)?.value);
}

/** Функция перевода для серверного компонента на языке из cookie. */
export async function getServerT(): Promise<{ t: TFunction; lang: Lang }> {
  const lang = await getServerLang();
  return { t: createT(lang), lang };
}
