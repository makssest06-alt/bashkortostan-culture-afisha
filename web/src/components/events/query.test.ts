import { describe, expect, it } from 'vitest';

import { parseEventsQuery } from '@/lib/api/params';
import type { EventsQuery } from '@/lib/api/types';

import { catalogHref, normalizeQuery, resetFilters, toggleCity } from './query';

/** Ссылка каталога → условия, которые восстановит страница при открытии. */
function restore(href: string): EventsQuery {
  const parsed = parseEventsQuery(new URL(href, 'http://afisha.test').searchParams);
  if (!parsed.ok) throw new Error(parsed.issues.map((issue) => issue.message).join('; '));
  return normalizeQuery(parsed.value);
}

describe('фильтры каталога в адресе (п. 6.3)', () => {
  const full: EventsQuery = {
    city: ['ufa', 'sterlitamak'],
    category: ['concert', 'cinema'],
    date_from: '2026-11-14',
    date_to: '2026-11-15',
    time_from: '18:00',
    price_max: 1000,
    age: 7,
    audience: 'kids',
    q: 'орган и джаз',
    sort: 'price',
  };

  it('все условия переживают путь «условия → ссылка → открытие ссылки»', () => {
    expect(restore(catalogHref(full))).toEqual(normalizeQuery(full));
  });

  it('готовый период и «только бесплатные» тоже восстанавливаются', () => {
    const query: EventsQuery = { date: 'weekend', free_only: true, age_rating: ['6+'] };
    expect(restore(catalogHref(query))).toEqual(normalizeQuery(query));
  });

  it('снятие фильтра и сброс меняют ссылку', () => {
    expect(restore(catalogHref(toggleCity(full, 'ufa'))).city).toEqual(['sterlitamak']);
    expect(catalogHref(resetFilters(full))).toBe(catalogHref({ sort: 'price' }));
  });

  it('пагинация в ссылку не попадает', () => {
    expect(catalogHref({ city: ['ufa'], page: 3, page_size: 10 })).toBe(catalogHref({ city: ['ufa'] }));
  });
});
