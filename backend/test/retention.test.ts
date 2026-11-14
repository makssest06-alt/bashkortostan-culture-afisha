import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { cleanupExpiredData } from '../src/domain/retention.js';
import { createSubscription, listSubscriptions } from '../src/domain/subscriptions.js';
import { formatRfc3339Local } from '../src/domain/time.js';
import { createTestContext, FIXED_NOW } from './helpers.js';

const old = (days: number) => formatRfc3339Local(FIXED_NOW.getTime() - days * 86_400_000);

describe('Retention и активность подписок', () => {
  it('удаляет просроченные обращения, подтверждения, трассы, raw_records, аудит и старые подписки', async () => {
    const ctx = await createTestContext();
    try {
      await ctx.db.query(
        `INSERT INTO agent_traces (id, request_id, created_at, engine, action)
         VALUES ($1, 'req_retention', $2, 'rules-v2', 'search')`,
        [randomUUID(), old(40)],
      );
      await ctx.db.query(
        `INSERT INTO agent_confirmations (token, action, payload, summary, expires_at)
         VALUES ($1, 'subscribe', '{}'::jsonb, 'retention test', $2)`,
        [randomUUID().replace(/-/g, ''), old(1)],
      );
      await ctx.db.query(
        `INSERT INTO raw_records (id, source_url, source_type, source_hash, raw_payload, fetched_at)
         VALUES ($1, 'https://example.invalid/retention', 'import', $2, '{}'::jsonb, $3)`,
        [randomUUID(), `retention-${randomUUID()}`, old(190)],
      );
      await ctx.db.query(
        `INSERT INTO audit_log (id, at, actor, action, entity_type, entity_id)
         VALUES ($1, $2, 'system', 'retention', 'system', 'retention-test')`,
        [randomUUID(), old(400)],
      );
      const importId = randomUUID();
      await ctx.db.query(
        `INSERT INTO imports (id, created_at, actor, format, received, added, updated, merged, unchanged)
         VALUES ($1, $2, 'system', 'json', 0, 0, 0, 0, 0)`,
        [importId, old(200)],
      );
      await ctx.db.query(
        `INSERT INTO feedback (id, created_at, expires_at, kind, name, contact, text, status)
         VALUES ($1, $2, $3, 'question', 'Тест', 'test@example.invalid', 'Старое обращение', 'new')`,
        [randomUUID(), old(100), old(1)],
      );

      const userRef = 'u_retention_0000001';
      const created = await createSubscription(ctx.db, {
        channel: 'web',
        user_ref: userRef,
        city: 'ufa',
        category: 'concert',
        period: 'weekend',
      });
      expect(created.ok).toBe(true);
      await ctx.db.query('UPDATE subscriptions SET last_used_at = $2 WHERE user_ref = $1', [
        userRef,
        old(200),
      ]);

      const removed = await cleanupExpiredData(ctx.db, FIXED_NOW, ctx.config);
      expect(removed.feedback).toBeGreaterThanOrEqual(1);
      expect(removed.confirmations).toBeGreaterThanOrEqual(1);
      expect(removed.traces).toBeGreaterThanOrEqual(1);
      expect(removed.raw_records).toBeGreaterThanOrEqual(1);
      expect(removed.imports).toBeGreaterThanOrEqual(1);
      expect(removed.audit_log).toBeGreaterThanOrEqual(1);
      expect(removed.subscriptions).toBeGreaterThanOrEqual(1);

      const subs = await ctx.db.query('SELECT id FROM subscriptions WHERE user_ref = $1', [userRef]);
      expect(subs.rows).toHaveLength(0);
      const imports = await ctx.db.query('SELECT id FROM imports WHERE id = $1', [importId]);
      expect(imports.rows).toHaveLength(0);
    } finally {
      await ctx.close();
    }
  });

  it('listSubscriptions продлевает last_used_at и защищает подписку от очистки', async () => {
    const ctx = await createTestContext();
    try {
      const userRef = 'u_retention_0000002';
      const created = await createSubscription(ctx.db, {
        channel: 'web',
        user_ref: userRef,
        city: 'ufa',
        category: null,
        period: null,
      });
      expect(created.ok).toBe(true);
      await ctx.db.query('UPDATE subscriptions SET last_used_at = $2 WHERE user_ref = $1', [
        userRef,
        old(200),
      ]);

      const listed = await listSubscriptions(ctx.db, userRef, FIXED_NOW);
      expect(listed.ok).toBe(true);
      const row = await ctx.db.query<{ last_used_at: Date | string }>(
        'SELECT last_used_at FROM subscriptions WHERE user_ref = $1',
        [userRef],
      );
      const value = row.rows[0]?.last_used_at;
      const iso = value instanceof Date ? formatRfc3339Local(value) : String(value);
      expect(iso).toBe(formatRfc3339Local(FIXED_NOW));

      await cleanupExpiredData(ctx.db, FIXED_NOW, ctx.config);
      const subs = await ctx.db.query('SELECT id FROM subscriptions WHERE user_ref = $1', [userRef]);
      expect(subs.rows).toHaveLength(1);
    } finally {
      await ctx.close();
    }
  });
});
