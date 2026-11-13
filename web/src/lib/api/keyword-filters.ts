/**
 * Фильтры по ключевым словам без языковой модели: основа резервного режима /ask (п. 7.5)
 * и базовая линия для сравнения с агентом (п. 6.5). Только явные слова: город, день,
 * категория, «бесплатно», «с ребёнком», «до N рублей». Ничего не угадывается.
 * Модуль чистый, работает и в браузере.
 */

import { CITIES } from '../../data/dictionaries';
import { normalizeText } from './text';
import type { CategoryId, CityId, DatePreset, EventsQuery } from './types';

/** Основа названия города: «уфе», «уфы», «уфу» находит Уфу, «стерлитамаке» находит Стерлитамак. */
const CITY_STEMS: readonly { stem: string; id: CityId }[] = CITIES.map((city) => {
  const name = normalizeText(city.name.ru);
  return { stem: name.length > 6 ? name.slice(0, -2) : name.slice(0, -1), id: city.slug };
});

const CATEGORY_WORDS: readonly { pattern: RegExp; ids: CategoryId[] }[] = [
  { pattern: /концерт|джаз|оркестр|филармони|органн/, ids: ['concert'] },
  { pattern: /спектакл|театр|балет|опер[аеуы]|постановк/, ids: ['performance'] },
  { pattern: /выставк|экспозици|галере/, ids: ['exhibition'] },
  { pattern: /фестивал|праздник/, ids: ['festival'] },
  { pattern: /кино|фильм|мультфильм/, ids: ['cinema'] },
  { pattern: /экскурси/, ids: ['excursion'] },
  { pattern: /музе/, ids: ['exhibition', 'excursion'] },
  { pattern: /мастер-класс/, ids: ['other'] },
];

const DATE_WORDS: readonly { pattern: RegExp; preset: DatePreset }[] = [
  { pattern: /сегодня|сейчас|вечером/, preset: 'today' },
  { pattern: /завтра/, preset: 'tomorrow' },
  { pattern: /выходн|суббот|воскресен/, preset: 'weekend' },
  { pattern: /недел/, preset: 'week' },
];

export function keywordFilters(text: string): EventsQuery {
  const normalized = normalizeText(text);
  const query: EventsQuery = {};

  const cities = CITY_STEMS.filter(({ stem }) => new RegExp(`(^|[^а-я])${stem}`).test(normalized)).map(({ id }) => id);
  if (cities.length) query.city = [...new Set(cities)];

  const categories = CATEGORY_WORDS.filter(({ pattern }) => pattern.test(normalized)).flatMap(({ ids }) => ids);
  if (categories.length) query.category = [...new Set(categories)];

  const date = DATE_WORDS.find(({ pattern }) => pattern.test(normalized));
  if (date) query.date = date.preset;

  if (/бесплатн|без билет|вход свободн/.test(normalized)) query.free_only = true;
  if (/ребен|ребён|детьми|детей|детск|для детей|малыш/.test(normalized)) query.audience = 'kids';

  const price = normalized.match(/до\s+(\d[\d\s]{1,6})\s*(?:₽|руб|р\b)/);
  if (price && !query.free_only) {
    const value = Number(price[1].replace(/\s/g, ''));
    if (value > 0) query.price_max = value;
  }
  return query;
}

/** Условия диалога и фильтры новой фразы вместе: новое уточняет, прежнее не теряется. */
export function mergeQueries(base: EventsQuery | null, next: EventsQuery): EventsQuery {
  const merged: EventsQuery = { ...(base ?? {}), ...next };
  delete merged.page;
  delete merged.page_size;
  return merged;
}
