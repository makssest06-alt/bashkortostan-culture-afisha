import { describe, expect, it } from 'vitest';

import { loadCatalog } from './db';
import { UUID_PATTERN } from './identity';
import { searchEvents } from './search';
import { fromApiEvent, fromApiEventsList, toApiEvent, toApiEventsList } from './wire';

const NOW = new Date('2026-11-12T09:00:00Z');
const CATEGORIES = ['concert', 'performance', 'exhibition', 'festival', 'cinema', 'excursion', 'other'];
const AGE_LIMITS = [0, 6, 12, 16, 18, null];
const TZ_FIELDS = [
  'id', 'title', 'normalized_title', 'category', 'tags', 'date_start', 'date_end', 'duration_min', 'city', 'venue',
  'address', 'lat', 'lon', 'description', 'price_min', 'price_max', 'is_free', 'age_limit', 'language', 'org_link',
  'source_url', 'source_type', 'source_hash', 'verified_at', 'confidence', 'status', 'dedup_key', 'created_at', 'updated_at',
];

/** Идентификаторы тарифов внутри сайта и на проводе разные: сравниваем без них. */
function withoutOfferIds<T extends { offers: { id: string }[] }>(event: T) {
  return { ...event, offers: event.offers.map((offer) => ({ ...offer, id: '' })) };
}

describe('событие по п. 8.1 ТЗ', () => {
  const { events } = loadCatalog(NOW);

  it('у каждого события есть все поля п. 8.1 с допустимыми значениями', () => {
    for (const event of events) {
      const wire = toApiEvent(event);
      for (const field of TZ_FIELDS) expect(wire, `${event.title}: ${field}`).toHaveProperty(field);
      expect(wire.id).toMatch(UUID_PATTERN);
      expect(CATEGORIES).toContain(wire.category);
      expect(AGE_LIMITS).toContain(wire.age_limit);
      expect(['published', 'draft', 'cancelled']).toContain(wire.status);
      expect(['manual', 'import', 'rss', 'api', 'page']).toContain(wire.source_type);
      expect(wire.confidence).toBeGreaterThanOrEqual(0);
      expect(wire.confidence).toBeLessThanOrEqual(1);
      expect(wire.sources.length).toBeGreaterThan(0);
      expect(wire.sources[0].source_url).toBe(wire.source_url);
    }
  });

  it('неизвестная цена остаётся null и не считается бесплатной', () => {
    for (const event of events) {
      const wire = toApiEvent(event);
      if (wire.is_free) {
        expect(wire.price_min).toBe(0);
        expect(wire.price_max).toBe(0);
      }
      if (event.price_summary.kind === 'unknown') {
        expect(wire.price_min).toBeNull();
        expect(wire.is_free).toBe(false);
      }
    }
  });

  it('все 7 категорий представлены в демо-данных', () => {
    const present = new Set(events.map((event) => event.category));
    for (const category of CATEGORIES) expect(present, category).toContain(category);
  });

  it('перевод в контракт и обратно ничего не теряет', () => {
    for (const event of events) {
      expect(withoutOfferIds(fromApiEvent(toApiEvent(event)))).toEqual(withoutOfferIds(event));
    }
  });

  it('список событий переводится туда и обратно', () => {
    const list = searchEvents({ page_size: 50 }, NOW);
    const back = fromApiEventsList(toApiEventsList(list));
    expect(back.items.map(withoutOfferIds)).toEqual(list.items.map(withoutOfferIds));
    expect(back.total).toBe(list.total);
  });
});
