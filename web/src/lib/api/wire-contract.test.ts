/**
 * Сайт против бэка, который отдаёт строго обязательную часть контракта v1:
 * событие только с полями п. 8.1, список только с items и счётчиками страниц,
 * расширения — в контрактной форме (age_limits, подписи строкой).
 */
import { describe, expect, it } from 'vitest';

import { loadCatalog } from './db';
import { searchEvents } from './search';
import type { ApiEventInput, ApiEventsListInput } from './wire';
import { fromApiEvent, fromApiEventsList, toApiEvent } from './wire';
import { normalizeFacets, normalizeRelaxations } from './wire-list';

const NOW = new Date('2026-11-12T09:00:00Z');
const TZ_FIELDS = [
  'id', 'title', 'normalized_title', 'category', 'tags', 'date_start', 'date_end', 'duration_min', 'city', 'venue',
  'address', 'lat', 'lon', 'description', 'price_min', 'price_max', 'is_free', 'age_limit', 'language', 'org_link',
  'source_url', 'source_type', 'source_hash', 'verified_at', 'confidence', 'status', 'dedup_key', 'created_at', 'updated_at',
] as const;

/** Только поля п. 8.1, без расширений сайта. */
function contractOnly(event: ReturnType<typeof toApiEvent>): ApiEventInput {
  return Object.fromEntries(TZ_FIELDS.map((field) => [field, event[field]])) as unknown as ApiEventInput;
}

describe('событие без расширений', () => {
  const { events } = loadCatalog(NOW);
  const full = toApiEvent(events.find((event) => event.venue.city === 'sterlitamak' && event.date_start?.includes('T'))!);
  const bare = contractOnly(full);

  it('получает один сеанс из date_start/date_end, город по названию и устойчивый код площадки', () => {
    const event = fromApiEvent(bare);
    expect(event.occurrences).toHaveLength(1);
    expect(event.occurrences[0].start.local).toBe(bare.date_start);
    expect(event.occurrences[0].start.precision).toBe('minute');
    expect(event.venue.city).toBe('sterlitamak');
    expect(event.venue.city_name.ba).toBe('Стәрлетамаҡ');
    expect(event.venue.id).toMatch(/^venue_[0-9a-z]+$/);
    expect(fromApiEvent(bare).venue.id).toBe(event.venue.id);
    expect(event.offers.length).toBeGreaterThan(0);
    expect(event.sources).toHaveLength(1);
  });

  it('статус сеанса подтверждён, только если есть дата проверки; отмена переходит на сеанс', () => {
    expect(fromApiEvent({ ...bare, verified_at: null }).occurrences[0].status_is_verified).toBe(false);
    expect(fromApiEvent({ ...bare, status: 'cancelled' }).occurrences[0].status).toBe('cancelled');
  });

  it('дата без времени даёт сеанс с точностью до дня', () => {
    const event = fromApiEvent({ ...bare, date_start: '2026-12-01', date_end: '2026-12-03' });
    expect(event.time_precision).toBe('date');
    expect(event.occurrences[0].start.precision).toBe('date');
  });
});

describe('список без расширений', () => {
  const list = searchEvents({ city: ['ufa'], page_size: 5 }, NOW);
  const bare: ApiEventsListInput = {
    items: list.items.map((item) => contractOnly(toApiEvent(item))),
    page: 1,
    page_size: 5,
    total: list.total,
    total_pages: list.total_pages,
  };

  it('каждый элемент получает подходящие сеансы и главный сеанс, счётчиков нет, условия — из запроса', () => {
    const result = fromApiEventsList(bare, { city: ['ufa'], free_only: true, page_size: 5 });
    expect(result.items).toHaveLength(bare.items.length);
    for (const item of result.items) {
      expect(item.matched_occurrence_ids.length).toBeGreaterThan(0);
      expect(item.matched_occurrence_ids).toContain(item.primary_occurrence_id);
    }
    expect(result.facets).toBeNull();
    expect(result.relaxations).toEqual([]);
    expect(result.applied.city).toEqual(['ufa']);
    expect(result.applied.free_only).toBe(true);
    expect(result.applied.active).toEqual(['city', 'free_only']);
    expect(result.reference_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('расширения в контрактной форме', () => {
  it('age_limits и подписи строкой переводятся в форму сайта с подписями на двух языках', () => {
    const facets = normalizeFacets({
      cities: [{ id: 'ufa', name: 'Уфа', count: 12 }],
      categories: [{ id: 'exhibition', name: 'Выставки', count: 3 }],
      age_limits: [{ value: 6, count: 4 }, { value: null, count: 1 }],
      price: { free: 2, paid: 9, unknown: 1 },
      total: 12,
    });
    expect(facets?.cities[0]).toEqual({ id: 'ufa', name: { ru: 'Уфа', ba: 'Өфө' }, count: 12 });
    expect(facets?.categories[0].name.ba).toBe('Күргәҙмәләр');
    expect(facets?.age_ratings.map((entry) => entry.id)).toEqual(['6+', 'unknown']);
    expect(facets?.price).toEqual({ free: 2, paid: 9, unknown: 1 });
  });

  it('вариант ослабления без готового запроса не показывается, с запросом — показывается', () => {
    const relaxations = normalizeRelaxations([
      { code: 'date', codes: ['date'], label: 'Любая дата', count: 5 },
      { code: 'budget', codes: ['budget'], label: 'Без ограничения цены', count: 3, query: { city: ['ufa'] } },
    ]);
    expect(relaxations).toHaveLength(1);
    expect(relaxations[0].label).toEqual({ ru: 'Без ограничения цены', ba: 'Без ограничения цены' });
  });
});
