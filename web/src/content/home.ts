/**
 * Тексты главной страницы: 15 сцен на русском и башкирском.
 *
 *   import { getHome, HOME, HOME_SCENE_IDS } from '@/content/home';
 *
 *   const home = getHome(lang);          // все сцены на одном языке
 *   home.hero.title                      // ['НЕ ПРОСТО', 'АФИША.']
 *   HOME.hero.ba.title                   // то же по id сцены и языку
 *
 * Тексты лежат в ./home/ru.ts и ./home/ba.ts, ссылки и запросы к API в ./home/shared.ts.
 * Чисел о каталоге в текстах нет: сцены cities, popular, thermal и fullscreen получают
 * данные из API по запросам из HOME_QUERIES. Модуль чистый, годится и серверу, и клиенту.
 */

import type { Lang } from '../lib/i18n/lang';
import { HOME_BA } from './home/ba';
import { HOME_RU } from './home/ru';
import type { HomeCopy, HomeSceneId } from './home/types';

export { ASK_ACTION, ASK_PARAM, CITY_HREF_BASE, HOME_QUERIES, HOME_SCENE_IDS, askHref } from './home/shared';
export type * from './home/types';

const BY_LANG: Readonly<Record<Lang, HomeCopy>> = { ru: HOME_RU, ba: HOME_BA };

/** Тексты каждой сцены на обоих языках: HOME[id сцены][язык]. */
export type HomeDictionary = { readonly [Id in HomeSceneId]: Readonly<Record<Lang, HomeCopy[Id]>> };

export const HOME: HomeDictionary = {
  intro: { ru: HOME_RU.intro, ba: HOME_BA.intro },
  hero: { ru: HOME_RU.hero, ba: HOME_BA.hero },
  ai: { ru: HOME_RU.ai, ba: HOME_BA.ai },
  gallery: { ru: HOME_RU.gallery, ba: HOME_BA.gallery },
  fullscreen: { ru: HOME_RU.fullscreen, ba: HOME_BA.fullscreen },
  thermal: { ru: HOME_RU.thermal, ba: HOME_BA.thermal },
  blueprint: { ru: HOME_RU.blueprint, ba: HOME_BA.blueprint },
  wordmark: { ru: HOME_RU.wordmark, ba: HOME_BA.wordmark },
  filters: { ru: HOME_RU.filters, ba: HOME_BA.filters },
  dedup: { ru: HOME_RU.dedup, ba: HOME_BA.dedup },
  trust: { ru: HOME_RU.trust, ba: HOME_BA.trust },
  cities: { ru: HOME_RU.cities, ba: HOME_BA.cities },
  popular: { ru: HOME_RU.popular, ba: HOME_BA.popular },
  choose: { ru: HOME_RU.choose, ba: HOME_BA.choose },
  footer: { ru: HOME_RU.footer, ba: HOME_BA.footer },
};

/** Все сцены главной на одном языке. Неизвестный язык даёт русский текст. */
export function getHome(lang: Lang): HomeCopy {
  return BY_LANG[lang] ?? HOME_RU;
}

/** Тексты одной сцены на нужном языке. */
export function getHomeScene<Id extends HomeSceneId>(id: Id, lang: Lang): HomeCopy[Id] {
  return getHome(lang)[id];
}
