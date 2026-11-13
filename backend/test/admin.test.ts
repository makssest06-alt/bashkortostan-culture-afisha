import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EXAMPLE_ADMIN_TOKEN, loadConfig } from '../src/config.js';
import {
  createContractValidators,
  createTestContext,
  type TestContext,
} from './helpers.js';

describe('Admin, Moderation, Audit, Subscriptions & Feedback Privacy', () => {
  let ctx: TestContext;
  const validators = createContractValidators();

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('rejects missing admin token and ignores example placeholder token', async () => {
    const res401 = await ctx.req('/api/v1/admin/events');
    expect(res401.status).toBe(401);
    validators.assertValid('Error', await res401.json());

    const badCfg = loadConfig({ ADMIN_TOKEN: EXAMPLE_ADMIN_TOKEN });
    expect(badCfg.adminToken).toBeUndefined();
    expect(badCfg.adminOpen).toBe(false);
  });

  it('enforces ETag If-Match on PATCH /admin/events/{id} and records audit log', async () => {
    const listRes = await ctx.adminReq('/api/v1/admin/events?page_size=5');
    expect(listRes.status).toBe(200);
    const listData = (await listRes.json()) as {
      items: Array<{ id: string; title: string; etag: string }>;
      counts: { all: number };
    };
    expect(listData.counts.all).toBeGreaterThan(0);
    const target = listData.items[0];

    const getRes = await ctx.adminReq(`/api/v1/admin/events/${target.id}`);
    expect(getRes.status).toBe(200);
    const etag = getRes.headers.get('etag')!;
    expect(etag).toBeTruthy();

    // Отсутствует If-Match и expected_updated_at -> 409
    const missingPrecondRes = await ctx.adminReq(`/api/v1/admin/events/${target.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ price_min: '750' }),
    });
    expect(missingPrecondRes.status).toBe(409);
    validators.assertValid('Error', await missingPrecondRes.json());

    // Устаревший If-Match -> 412
    const staleRes = await ctx.adminReq(`/api/v1/admin/events/${target.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'If-Match': 'W/"stale-etag"' },
      body: JSON.stringify({ price_min: 750, price_max: 1200 }),
    });
    expect(staleRes.status).toBe(412);
    validators.assertValid('Error', await staleRes.json());

    // Валидный If-Match + строковые числа + кириллический X-Actor -> 200 + audit
    const okRes = await ctx.adminReq(`/api/v1/admin/events/${target.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'If-Match': etag,
        'X-Actor': encodeURIComponent('Модератор Анна'),
      },
      body: JSON.stringify({ price_min: '750', price_max: '1200' }),
    });
    expect(okRes.status).toBe(200);
    const patchBody = await okRes.json();
    validators.assertValidEvent(patchBody.event);
    expect(patchBody.price_min).toBe(750);
    expect(patchBody.changes.some((c: { field: string }) => c.field === 'price_min')).toBe(true);

    const auditRes = await ctx.adminReq(`/api/v1/admin/audit?entity_id=${target.id}`);
    expect(auditRes.status).toBe(200);
    const auditBody = await auditRes.json();
    validators.assertValid('AuditList', auditBody);
    expect(auditBody.total).toBeGreaterThanOrEqual(1);
    expect(auditBody.items[0].actor).toBe('Модератор Анна');
    expect(auditBody.items[0].action).toBe('update');
  });

  it('supports moderation publish and merge without polluting event.review schema', async () => {
    // Импортируем 2 спорные карточки с похожим названием и без цены
    const items = [
      {
        title: 'Синтетическая сказка о лесе',
        category: 'performance',
        city: 'ufa',
        venue: 'Башкирский государственный театр кукол',
        date_start: '2026-12-01T11:00:00+05:00',
        description: 'Спорная запись без цены номер один.',
        source_url: 'https://example.invalid/demo/mod-1',
        synthetic: true,
      },
      {
        title: 'Синтетическая сказка о лесе: дубль',
        category: 'performance',
        city: 'ufa',
        venue: 'Башкирский государственный театр кукол',
        date_start: '2026-12-01T11:00:00+05:00',
        description: 'Спорная запись номер два для проверки слияния.',
        source_url: 'https://example.invalid/demo/mod-2',
        synthetic: true,
      },
    ];
    const impRes = await ctx.adminReq('/api/v1/admin/imports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(items),
    });
    const imp = await impRes.json();
    const id1 = imp.rows[0].id as string;
    const id2 = imp.rows[1].id as string;

    const mergeRes = await ctx.adminReq(`/api/v1/admin/moderation/${id2}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'merge', merge_into: id1, comment: 'Дубликат от другого источника' }),
    });
    expect(mergeRes.status).toBe(200);
    const mergeData = await mergeRes.json();
    validators.assertValidEvent(mergeData.event);
    expect(mergeData.event.sources.length).toBeGreaterThanOrEqual(2);
    expect(mergeData.event.review?.merged_into).toBeUndefined();

    // Публикуем id1
    const pubRes = await ctx.adminReq(`/api/v1/admin/moderation/${id1}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'publish' }),
    });
    expect(pubRes.status).toBe(200);
    const pubData = await pubRes.json();
    expect(pubData.event.status).toBe('published');
  });

  it('handles subscriptions CRUD with physical deletion and feedback honeypot + rate limit', async () => {
    const userRef = 'u_test_user_ref_00001';
    const createSub = await ctx.req('/api/v1/subscriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel: 'telegram',
        user_ref: userRef,
        city: 'ufa',
        category: 'concert',
        period: 'weekend',
      }),
    });
    expect(createSub.status).toBe(201);
    const subJson = await createSub.json();
    validators.assertValid('Subscription', subJson);
    expect(createSub.headers.get('location')).toBe(`/api/v1/subscriptions/${subJson.id}`);

    // Повторная такая же подписка -> 409 conflict
    const dupSub = await ctx.req('/api/v1/subscriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel: 'telegram',
        user_ref: userRef,
        city: 'ufa',
        category: 'concert',
        period: 'weekend',
      }),
    });
    expect(dupSub.status).toBe(409);

    const listSub = await ctx.req(`/api/v1/subscriptions?user_ref=${userRef}`);
    expect(listSub.status).toBe(200);
    const listSubJson = await listSub.json();
    validators.assertValid('SubscriptionList', listSubJson);
    expect(listSubJson.items).toHaveLength(1);

    // Физическое удаление
    const delSub = await ctx.req(`/api/v1/subscriptions/${subJson.id}`, { method: 'DELETE' });
    expect(delSub.status).toBe(204);

    const afterDel = await ctx.req(`/api/v1/subscriptions?user_ref=${userRef}`);
    expect((await afterDel.json()).items).toHaveLength(0);

    // Honeypot: отвечает 202, но не попадает в /admin/applications
    const honey = await ctx.req('/api/v1/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.0.0.99' },
      body: JSON.stringify({
        kind: 'question',
        name: 'Спамер',
        contact: 'spam@example.invalid',
        text: 'Рекламное сообщение',
        website: 'https://spam-bot.invalid',
      }),
    });
    expect(honey.status).toBe(202);
    validators.assertValid('FeedbackAccepted', await honey.json());

    const appsBefore = await ctx.adminReq('/api/v1/admin/applications');
    expect((await appsBefore.json()).total).toBe(0);

    // Ограничение частоты 5 / 10 мин с одного IP (первый был honeypot с того же IP -> осталось 4)
    for (let i = 0; i < 4; i += 1) {
      const ok = await ctx.req('/api/v1/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.0.0.99' },
        body: JSON.stringify({
          kind: 'question',
          name: 'Айгуль',
          contact: 'aigul@example.invalid',
          text: `Вопрос №${i}`,
          website: '',
        }),
      });
      expect(ok.status).toBe(202);
    }

    const rateLimited = await ctx.req('/api/v1/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.0.0.99' },
      body: JSON.stringify({
        kind: 'question',
        name: 'Айгуль',
        contact: 'aigul@example.invalid',
        text: 'Шестой вопрос',
        website: '',
      }),
    });
    expect(rateLimited.status).toBe(429);
    expect(rateLimited.headers.get('retry-after')).toBeTruthy();
    validators.assertValid('Error', await rateLimited.json());

    // Проверяем, что в аудит не утекли ПДн (имя/контакт)
    const auditAfter = await ctx.adminReq('/api/v1/admin/audit');
    const auditText = JSON.stringify(await auditAfter.json());
    expect(auditText).not.toContain('aigul@example.invalid');
    expect(auditText).not.toContain('Айгуль');
  });

  it('resets demo data on POST /admin/reset', async () => {
    const res = await ctx.adminReq('/api/v1/admin/reset', { method: 'POST' });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.reset).toBe(true);
    expect(data.events).toBeGreaterThan(20);
  });
});
