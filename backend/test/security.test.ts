import { describe, expect, it, vi } from 'vitest';

import { checkAdminAuth } from '../src/domain/admin.js';
import { EXAMPLE_ADMIN_TOKEN, loadConfig } from '../src/config.js';
import { clientIpFromHeaders, normalizeClientIp } from '../src/domain/rate-limit.js';
import {
  createContractValidators,
  createTestContext,
  FIXED_NOW,
  type TestContext,
} from './helpers.js';

const LONG_TOKEN = 'a'.repeat(48);
const validators = createContractValidators();

function feedbackBody(text = 'Вопрос из теста') {
  return JSON.stringify({
    kind: 'question',
    name: 'Тестовый пользователь',
    contact: 'test@example.invalid',
    text,
    website: '',
  });
}

describe('P0-1: админка не открыта по умолчанию', () => {
  it('production не стартует с ADMIN_OPEN=1 и без длинного ADMIN_TOKEN', () => {
    expect(() =>
      loadConfig({ NODE_ENV: 'production', ADMIN_OPEN: '1', ADMIN_TOKEN: LONG_TOKEN }),
    ).toThrow(/ADMIN_OPEN=1 запрещён/);

    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/ADMIN_TOKEN/);
    expect(() => loadConfig({ NODE_ENV: 'production', ADMIN_TOKEN: 'short' })).toThrow(/32/);
    expect(() =>
      loadConfig({ NODE_ENV: 'production', ADMIN_TOKEN: EXAMPLE_ADMIN_TOKEN }),
    ).toThrow(/ADMIN_TOKEN/);

    const ok = loadConfig({ NODE_ENV: 'production', ADMIN_TOKEN: LONG_TOKEN });
    expect(ok.adminOpen).toBe(false);
    expect(ok.production).toBe(true);

    // Локальное демо без NODE_ENV=production по-прежнему может открыть админку.
    const demo = loadConfig({ ADMIN_OPEN: '1' });
    expect(demo.adminOpen).toBe(true);
    expect(demo.production).toBe(false);
  });

  it('checkAdminAuth не открывает админку в production даже при adminOpen=true', () => {
    const config = { ...loadConfig({ ADMIN_OPEN: '1' }), production: true, adminOpen: true };
    const res = checkAdminAuth({}, config);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(401);
  });

  it('docker compose и .env.example не включают ADMIN_OPEN=1 по умолчанию', async () => {
    const fs = await import('node:fs/promises');
    const compose = await fs.readFile(new URL('../../docker-compose.yml', import.meta.url), 'utf8');
    const webCompose = await fs.readFile(new URL('../../web/compose.yaml', import.meta.url), 'utf8');
    const envExample = await fs.readFile(new URL('../../.env.example', import.meta.url), 'utf8');

    expect(compose).not.toMatch(/ADMIN_OPEN:\s*\$\{ADMIN_OPEN:-1\}/);
    expect(webCompose).not.toMatch(/ADMIN_OPEN:\s*\$\{ADMIN_OPEN:-1\}/);
    expect(envExample).not.toMatch(/^ADMIN_OPEN=1$/m);
  });
});

describe('P0-2: подменённый X-Forwarded-For не меняет ключ лимита', () => {
  it('при TRUST_PROXY=0 заголовки игнорируются, лимит общий', async () => {
    const ctx: TestContext = await createTestContext({ trustProxy: false, trustedProxyHops: 0 });
    try {
      for (let i = 0; i < 5; i += 1) {
        const res = await ctx.req('/api/v1/feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.0.0.${i + 1}` },
          body: feedbackBody(`Вопрос ${i}`),
        });
        expect(res.status).toBe(202);
      }
      const limited = await ctx.req('/api/v1/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.0.0.99' },
        body: feedbackBody('Шестой вопрос'),
      });
      expect(limited.status).toBe(429);
      expect(limited.headers.get('retry-after')).toBeTruthy();
      validators.assertValid('Error', await limited.json());
    } finally {
      await ctx.close();
    }
  });

  it('берёт правый адрес цепочки, а не подделываемый левый', () => {
    const headers = new Headers({ 'X-Forwarded-For': '1.2.3.4, 203.0.113.7' });
    expect(clientIpFromHeaders(headers, 1)).toBe('203.0.113.7');
    expect(clientIpFromHeaders(headers, 2)).toBe('1.2.3.4');
    expect(normalizeClientIp('::ffff:127.0.0.1')).toBe('127.0.0.1');
  });

  it('docker compose не публикует API на все интерфейсы и не включает TRUST_PROXY', async () => {
    const fs = await import('node:fs/promises');
    const compose = await fs.readFile(new URL('../../docker-compose.yml', import.meta.url), 'utf8');
    expect(compose).not.toMatch(/TRUST_PROXY:\s*\$\{TRUST_PROXY:-1\}/);
    expect(compose).toMatch(/127\.0\.0\.1:\$\{API_PORT:-8000\}:8000/);
  });
});

describe('P0-3: лимиты и бюджет ассистента', () => {
  it('N+1 запрос к /assistant/query получает 429 + Retry-After', async () => {
    const ctx = await createTestContext({
      assistantRatePer10Min: 2,
      assistantDailyLimit: 100,
    });
    try {
      const ask = () =>
        ctx.req('/api/v1/assistant/query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Концерты в Уфе' }),
        });
      expect((await ask()).status).toBe(200);
      expect((await ask()).status).toBe(200);
      const limited = await ask();
      expect(limited.status).toBe(429);
      expect(limited.headers.get('retry-after')).toBeTruthy();
      expect(limited.headers.get('x-request-id')).toBeTruthy();
      validators.assertValid('Error', await limited.json());
    } finally {
      await ctx.close();
    }
  });

  it('лимит на confirm срабатывает раньше повторного использования токена', async () => {
    const ctx = await createTestContext({ assistantConfirmPer10Min: 1 });
    try {
      const q = await ctx.req('/api/v1/assistant/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'Подпиши меня на концерты в Уфе на выходных',
          user_ref: 'u_confirm_rate_00001',
        }),
      });
      const data = await q.json();
      expect(data.action).toBe('confirmation_required');

      const confirm = () =>
        ctx.req('/api/v1/assistant/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            confirmation_id: data.confirmation.confirmation_id,
            user_ref: 'u_confirm_rate_00001',
            confirm: true,
          }),
        });

      expect((await confirm()).status).toBe(200);
      const limited = await confirm();
      expect(limited.status).toBe(429);
      expect(limited.headers.get('retry-after')).toBeTruthy();
    } finally {
      await ctx.close();
    }
  });

  it('при исчерпанном дневном бюджете LLM не вызывается: rules-budget-v2 и трасса', async () => {
    const ctx = await createTestContext({
      llmApiKey: 'test-llm-key',
      assistantDailyBudgetRub: 0,
    });
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const res = await ctx.req('/api/v1/assistant/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Концерты в Уфе' }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      validators.assertValid('AssistantQueryResponse', body);
      expect(body.engine).toBe('rules-budget-v2');
      expect(fetchSpy).not.toHaveBeenCalled();

      const traceRes = await ctx.adminReq(`/api/v1/admin/traces/${body.trace_id}`);
      expect(traceRes.status).toBe(200);
      const trace = await traceRes.json();
      expect(trace.fallback_used).toBe(true);
      expect(trace.error).toContain('daily_budget_exhausted');

      expect(ctx.metrics.formatPrometheus()).toContain(
        'afisha_assistant_budget_fallbacks_total 1',
      );
    } finally {
      vi.unstubAllGlobals();
      await ctx.close();
    }
  });

  it('лимит на создание подписок отдаёт 429', async () => {
    const ctx = await createTestContext();
    try {
      const body = JSON.stringify({
        channel: 'telegram',
        user_ref: 'u_sub_rate_limit_001',
        city: 'ufa',
        category: 'concert',
        period: 'weekend',
      });
      for (let i = 0; i < 10; i += 1) {
        const res = await ctx.req('/api/v1/subscriptions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        });
        expect([201, 409]).toContain(res.status);
      }
      const limited = await ctx.req('/api/v1/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      expect(limited.status).toBe(429);
      expect(limited.headers.get('retry-after')).toBeTruthy();
    } finally {
      await ctx.close();
    }
  });
});

describe('P0-4: confirmation-токены привязаны к user_ref и хранятся хешем', () => {
  it('не принимает confirmation_token в /assistant/query и не обходит подтверждение', async () => {
    const ctx = await createTestContext();
    const userRef = 'u_bypass_regression_01';
    try {
      const res = await ctx.req('/api/v1/assistant/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'Подпиши меня на концерты в Уфе на выходных',
          user_ref: userRef,
          confirmation_token: 'fake-token-must-be-ignored',
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.action).toBe('confirmation_required');
      expect(body.subscription).toBeUndefined();

      const subs = await ctx.req('/api/v1/subscriptions', {
        headers: { Authorization: `Bearer ${userRef}` },
      });
      expect((await subs.json()).items).toHaveLength(0);
    } finally {
      await ctx.close();
    }
  });

  it('≥128 бит энтропии, в БД хеш, чужой user_ref → 404, повтор → 409', async () => {
    const ctx = await createTestContext();
    const userRef = 'u_confirm_owner_00001';
    try {
      // Бюджет и лимиты в тестовом конфиге большие; это проверка именно токенов.
      const q = await ctx.req('/api/v1/assistant/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'Подпиши меня на концерты в Уфе на выходных',
          user_ref: userRef,
        }),
      });
      const data = await q.json();
      expect(data.action).toBe('confirmation_required');
      const token = data.confirmation.confirmation_id as string;
      expect(token).toMatch(/^cnf_[A-Za-z0-9_-]{32,}$/);

      // TTL — 5 минут (P0-4)
      expect(Date.parse(data.confirmation.expires_at)).toBe(FIXED_NOW.getTime() + 300_000);

      const rows = await ctx.db.query<{ token: string }>('SELECT token FROM agent_confirmations');
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0].token).not.toBe(token);
      expect(rows.rows[0].token).toMatch(/^[a-f0-9]{64}$/);

      const confirmBody = (extra: Record<string, unknown>) =>
        JSON.stringify({ confirmation_id: token, confirm: true, ...extra });

      const missingUser = await ctx.req('/api/v1/assistant/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: confirmBody({}),
      });
      expect(missingUser.status).toBe(400);

      const foreignUser = await ctx.req('/api/v1/assistant/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: confirmBody({ user_ref: 'u_confirm_attacker_01' }),
      });
      expect(foreignUser.status).toBe(404);

      const ok = await ctx.req('/api/v1/assistant/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: confirmBody({ user_ref: userRef }),
      });
      expect(ok.status).toBe(200);
      const okBody = await ok.json();
      expect(okBody.status).toBe('done');
      validators.assertValid('Subscription', okBody.subscription);

      const reuse = await ctx.req('/api/v1/assistant/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: confirmBody({ user_ref: userRef }),
      });
      expect(reuse.status).toBe(409);

      // В аудит попало подтверждение, но не сырой токен и не user_ref.
      const audit = await ctx.adminReq('/api/v1/admin/audit?action=confirm');
      const auditBody = await audit.json();
      expect(auditBody.total).toBe(1);
      const auditText = JSON.stringify(auditBody);
      expect(auditText).not.toContain(token);
      expect(auditText).not.toContain(userRef);
      expect(auditBody.items[0].entity_type).toBe('agent_confirmation');
    } finally {
      await ctx.close();
    }
  });

  it('подписка без user_ref не создаёт подтверждение', async () => {
    const ctx = await createTestContext();
    try {
      const q = await ctx.req('/api/v1/assistant/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Подпиши меня на концерты в Уфе на выходных' }),
      });
      expect(q.status).toBe(200);
      const rows = await ctx.db.query<{ cnt: string | number }>(
        'SELECT COUNT(*) AS cnt FROM agent_confirmations',
      );
      expect(Number(rows.rows[0]?.cnt ?? 0)).toBe(0);
    } finally {
      await ctx.close();
    }
  });
});
