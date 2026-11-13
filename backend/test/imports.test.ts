import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createContractValidators,
  createTestContext,
  FIXTURES_DIR,
  type TestContext,
} from './helpers.js';

describe('Imports Pipeline (CSV / JSON / Multipart / Dedup / Idempotency)', () => {
  let ctx: TestContext;
  const validators = createContractValidators();

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('imports 100-row CSV within 5 seconds and is 100% idempotent on repeat', async () => {
    const csvText = readFileSync(resolve(FIXTURES_DIR, 'import-100.csv'), 'utf8');
    const started = Date.now();
    const res1 = await ctx.adminReq('/api/v1/admin/imports?file_name=import-100.csv', {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv; charset=utf-8' },
      body: csvText,
    });
    const elapsedMs = Date.now() - started;

    expect(res1.status).toBe(200);
    expect(elapsedMs).toBeLessThan(5000);
    const rep1 = await res1.json();
    validators.assertValid('ImportReport', rep1);
    expect(rep1.received).toBe(100);
    expect(rep1.added).toBe(100);
    expect(rep1.updated).toBe(0);
    expect(rep1.unchanged).toBe(0);
    expect(rep1.rejected).toHaveLength(0);

    // Повторный импорт того же файла -> 100% unchanged
    const res2 = await ctx.adminReq('/api/v1/admin/imports?file_name=import-100.csv', {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv; charset=utf-8' },
      body: csvText,
    });
    expect(res2.status).toBe(200);
    const rep2 = await res2.json();
    validators.assertValid('ImportReport', rep2);
    expect(rep2.received).toBe(100);
    expect(rep2.added).toBe(0);
    expect(rep2.updated).toBe(0);
    expect(rep2.unchanged).toBe(100);
    expect(rep2.rejected).toHaveLength(0);
  });

  it('handles JSON import with clean add, disputed draft, cross-source merge, and rejections', async () => {
    const jsonText = readFileSync(resolve(FIXTURES_DIR, 'import-sample.json'), 'utf8');
    const res = await ctx.adminReq('/api/v1/admin/imports?file_name=import-sample.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: jsonText,
    });
    expect(res.status).toBe(200);
    const rep = await res.json();
    validators.assertValid('ImportReport', rep);

    expect(rep.received).toBe(5);
    expect(rep.added).toBe(2); // poetry-1 + winter-unknown
    expect(rep.updated).toBe(1); // poetry-mirror merged into poetry-1
    expect(rep.merged).toBe(1);
    expect(rep.unchanged).toBe(0);
    expect(rep.rejected).toHaveLength(2);
    expect(rep.disputed.length).toBeGreaterThanOrEqual(1);
    expect(rep.added + rep.updated + rep.unchanged + rep.rejected.length).toBe(rep.received);

    // Проверяем, что спорная запись появилась в очереди модерации
    const modRes = await ctx.adminReq('/api/v1/admin/moderation');
    expect(modRes.status).toBe(200);
    const modData = await modRes.json();
    validators.assertValid('ModerationList', modData);
    const winterItem = modData.items.find(
      (i: { event: { title: string } }) => i.event.title.includes('Зимние узоры'),
    );
    expect(winterItem).toBeDefined();
    expect(winterItem.event.status).toBe('draft');
    expect(winterItem.reasons).toContain('price_unknown');

    // Проверяем, что у свёрнутой карточки Демо-вечера стало 2 источника
    const poetryRow = rep.rows.find((r: { outcome: string }) => r.outcome === 'added');
    const poetryCard = await ctx.req(`/api/v1/events/${poetryRow.id}`);
    expect(poetryCard.status).toBe(200);
    const poetryJson = await poetryCard.json();
    validators.assertValidEvent(poetryJson);
    expect(poetryJson.sources.length).toBeGreaterThanOrEqual(2);
  });

  it('supports multipart/form-data CSV upload with Russian headers', async () => {
    const csv = [
      'название,категория,город,площадка,дата,время,цена,возраст,описание,источник',
      'Демо-встреча у курая,concert,ufa,Государственный концертный зал «Башкортостан»,24.11.2026,18:30,0,0+,Синтетический мастер-класс игры на курае для всех желающих.,https://example.invalid/demo/kurai-1',
    ].join('\n');

    const form = new FormData();
    form.set('file', new File([csv], 'events.csv', { type: 'text/csv' }));

    const res = await ctx.adminReq('/api/v1/admin/imports', {
      method: 'POST',
      body: form,
    });
    expect(res.status).toBe(200);
    const rep = await res.json();
    validators.assertValid('ImportReport', rep);
    expect(rep.file_name).toBe('events.csv');
    expect(rep.added).toBe(1);
    expect(rep.rejected).toHaveLength(0);
  });
});
