import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createContractValidators,
  createTestContext,
  type TestContext,
} from './helpers.js';

describe('OpenAPI & Event Schema v1 Contracts', () => {
  let ctx: TestContext;
  const validators = createContractValidators();

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('validates GET /api/v1/events, ETag 304, and Event schema compliance', async () => {
    const res = await ctx.req('/api/v1/events?city=ufa&page_size=20');
    expect(res.status).toBe(200);
    expect(res.headers.get('x-request-id')).toBeTruthy();
    const etag = res.headers.get('etag');
    expect(etag).toBeTruthy();

    const body = (await res.json()) as {
      items: Array<{ id: string; status: string }>;
      total: number;
    };
    validators.assertValid('EventList', body);
    expect(body.total).toBeGreaterThan(0);

    // Опубликованная лента никогда не содержит draft или cancelled
    for (const item of body.items) {
      expect(item.status).toBe('published');
      validators.assertValidEvent(item);
    }

    // Проверка If-None-Match -> 304
    const res304 = await ctx.req('/api/v1/events?city=ufa&page_size=20', {
      headers: { 'If-None-Match': etag! },
    });
    expect(res304.status).toBe(304);
  });

  it('keeps unknown price != free and unknown age != 0+, hides draft on /events/{id}, keeps cancelled accessible', async () => {
    const freeRes = await ctx.req('/api/v1/events?free=true&page_size=50');
    expect(freeRes.status).toBe(200);
    const freeData = (await freeRes.json()) as {
      items: Array<{ is_free: boolean; price_min: number | null }>;
      hidden_unknown_price: number;
    };
    for (const item of freeData.items) {
      expect(item.is_free).toBe(true);
      expect(item.price_min).toBe(0);
    }
    expect(freeData.hidden_unknown_price).toBeGreaterThanOrEqual(0);

    const kidsRes = await ctx.req('/api/v1/events?age=5&page_size=50');
    expect(kidsRes.status).toBe(200);
    const kidsData = (await kidsRes.json()) as {
      items: Array<{ age_limit: number | null }>;
      hidden_unknown_age: number;
    };
    for (const item of kidsData.items) {
      expect(item.age_limit).not.toBeNull();
      expect(item.age_limit!).toBeLessThanOrEqual(5);
    }

    // Проверка прямого доступа к cancelled (200) и draft (404) через админский список
    const adminRes = await ctx.adminReq('/api/v1/admin/events?page_size=100');
    const adminData = (await adminRes.json()) as {
      items: Array<{ id: string; status: string }>;
    };
    const cancelled = adminData.items.find((e) => e.status === 'cancelled');
    const draft = adminData.items.find((e) => e.status === 'draft');

    if (cancelled) {
      const cRes = await ctx.req(`/api/v1/events/${cancelled.id}`);
      expect(cRes.status).toBe(200);
      const cJson = await cRes.json();
      validators.assertValidEvent(cJson);
    }
    if (draft) {
      const dRes = await ctx.req(`/api/v1/events/${draft.id}`);
      expect(dRes.status).toBe(404);
      validators.assertValid('Error', await dRes.json());
    }

    const noneRes = await ctx.req('/api/v1/events/none');
    expect(noneRes.status).toBe(404);
    validators.assertValid('Error', await noneRes.json());

    const badIdRes = await ctx.req('/api/v1/events/bad!id');
    expect(badIdRes.status).toBe(400);
    validators.assertValid('Error', await badIdRes.json());
  });

  it('validates /events/{id}/similar, /venues/{id}/schedule, /cities, /venues, /categories, /health', async () => {
    const citiesRes = await ctx.req('/api/v1/cities');
    expect(citiesRes.status).toBe(200);
    validators.assertValid('CityList', await citiesRes.json());

    const venuesRes = await ctx.req('/api/v1/venues?city=ufa');
    expect(venuesRes.status).toBe(200);
    const venuesData = (await venuesRes.json()) as { items: Array<{ id: string }> };
    validators.assertValid('VenueList', venuesData);
    expect(venuesData.items.length).toBeGreaterThan(0);

    const catsRes = await ctx.req('/api/v1/categories');
    expect(catsRes.status).toBe(200);
    validators.assertValid('CategoryList', await catsRes.json());

    const healthRes = await ctx.req('/api/v1/health');
    expect(healthRes.status).toBe(200);
    validators.assertValid('Health', await healthRes.json());

    const eventsRes = await ctx.req('/api/v1/events?city=ufa&page_size=5');
    const eventsData = (await eventsRes.json()) as { items: Array<{ id: string }> };
    const firstId = eventsData.items[0].id;

    const simRes = await ctx.req(`/api/v1/events/${firstId}/similar`);
    expect(simRes.status).toBe(200);
    validators.assertValid('EventList', await simRes.json());

    const schedRes = await ctx.req(
      `/api/v1/venues/${venuesData.items[0].id}/schedule?date_from=2026-11-13&date_to=2026-11-30`,
    );
    expect(schedRes.status).toBe(200);
    validators.assertValid('VenueSchedule', await schedRes.json());

    // Интервал > 31 дня отклонён 400
    const badSchedRes = await ctx.req(
      `/api/v1/venues/${venuesData.items[0].id}/schedule?date_from=2026-11-01&date_to=2026-12-20`,
    );
    expect(badSchedRes.status).toBe(400);
    validators.assertValid('Error', await badSchedRes.json());
  });

  it('validates 405 Method Not Allowed with Allow header and 400 Validation Error', async () => {
    const res405 = await ctx.req('/api/v1/cities', { method: 'POST' });
    expect(res405.status).toBe(405);
    expect(res405.headers.get('allow')).toContain('GET');
    validators.assertValid('Error', await res405.json());

    const res400 = await ctx.req('/api/v1/events?date=weekend&date_from=2026-11-13');
    expect(res400.status).toBe(400);
    validators.assertValid('Error', await res400.json());
  });

  it('validates relaxations on zero-match search', async () => {
    const res = await ctx.req('/api/v1/events?city=kumertau&free=true&q=несбыточныйзапрос999');
    expect(res.status).toBe(200);
    const data = await res.json();
    validators.assertValid('EventList', data);
    expect(data.total).toBe(0);
    expect(Array.isArray(data.relaxations)).toBe(true);
  });
});
