import { describe, expect, it, vi } from 'vitest';

import { checkAdminAuth } from '../src/domain/admin.js';
import { ToolRuntime } from '../src/domain/assistant/tools.js';
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

  it('CORS админки не отдаёт Access-Control-Allow-Origin: *', async () => {
    const ctx = await createTestContext();
    try {
      const adminPreflight = await ctx.req('/api/v1/admin/events', {
        method: 'OPTIONS',
        headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' },
      });
      expect(adminPreflight.status).toBe(204);
      expect(adminPreflight.headers.get('access-control-allow-origin')).toBeNull();

      const admin401 = await ctx.req('/api/v1/admin/events');
      expect(admin401.status).toBe(401);
      expect(admin401.headers.get('access-control-allow-origin')).toBeNull();

      const publicPreflight = await ctx.req('/api/v1/events', {
        method: 'OPTIONS',
        headers: { Origin: 'https://partner.example', 'Access-Control-Request-Method': 'GET' },
      });
      expect(publicPreflight.headers.get('access-control-allow-origin')).toBe('*');

      // Неаутентифицированный admin-запрос не должен читать большое тело.
      const unauthBig = await ctx.req('/api/v1/admin/events', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: 'x'.repeat(2_000_000),
      });
      expect(unauthBig.status).toBe(401);
    } finally {
      await ctx.close();
    }
  });

  it('PATCH события не принимает javascript: в org_link/source_url', async () => {
    const ctx = await createTestContext();
    try {
      const list = await ctx.adminReq('/api/v1/admin/events?page_size=1');
      const target = (await list.json()).items[0] as { id: string };
      const detail = await ctx.adminReq(`/api/v1/admin/events/${target.id}`);
      const etag = detail.headers.get('etag');
      const res = await ctx.adminReq(`/api/v1/admin/events/${target.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'If-Match': etag ?? '' },
        body: JSON.stringify({ org_link: 'javascript:alert(1)', source_url: 'data:text/html,evil' }),
      });
      expect(res.status).toBe(400);
    } finally {
      await ctx.close();
    }
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
    // Короткая цепочка при двух доверенных прокси — не доверяем, берём сокет.
    expect(clientIpFromHeaders(headers, 3, '10.0.0.5')).toBe('10.0.0.5');
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
  it('11 разных пользователей с одного IP не блокируют друг друга (IP backstop)', async () => {
    const ctx = await createTestContext();
    try {
      const codes: number[] = [];
      for (let i = 1; i <= 11; i += 1) {
        const res = await ctx.req('/api/v1/subscriptions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            channel: 'telegram',
            user_ref: `u_backstop_${String(i).padStart(6, '0')}`,
            city: 'ufa',
            category: 'concert',
            period: 'weekend',
          }),
        });
        codes.push(res.status);
      }
      expect(codes).toEqual(new Array(11).fill(201));
    } finally {
      await ctx.close();
    }
  });

  it('11 разных пользователей ассистента с одного IP проходят (IP backstop)', async () => {
    const ctx = await createTestContext();
    try {
      const codes: number[] = [];
      for (let i = 1; i <= 11; i += 1) {
        const res = await ctx.req('/api/v1/assistant/query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: 'Концерты в Уфе',
            user_ref: `u_ask_backstop_${String(i).padStart(6, '0')}`,
          }),
        });
        codes.push(res.status);
      }
      expect(codes).toEqual(new Array(11).fill(200));
    } finally {
      await ctx.close();
    }
  });

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

  it('body limit отсекает 2 МБ на /subscriptions и 100 КБ на /assistant/query', async () => {
    const ctx = await createTestContext();
    try {
      const huge = JSON.stringify({
        channel: 'telegram',
        user_ref: 'u_body_limit_000001',
        city: 'ufa',
        padding: 'x'.repeat(2_000_000),
      });
      const sub = await ctx.req('/api/v1/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: huge,
      });
      expect(sub.status).toBe(413);
      validators.assertValid('Error', await sub.json());

      const ask = await ctx.req('/api/v1/assistant/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'x'.repeat(100_000) }),
      });
      expect(ask.status).toBe(413);
      validators.assertValid('Error', await ask.json());
    } finally {
      await ctx.close();
    }
  });

  it('в production /metrics скрыт без METRICS_TOKEN и требует токен с ним', async () => {
    const prod = await createTestContext({ production: true, metricsToken: undefined });
    try {
      expect((await prod.req('/metrics')).status).toBe(404);
    } finally {
      await prod.close();
    }
    const protectedCtx = await createTestContext({
      production: true,
      metricsToken: 'metrics-secret-for-tests-123456',
    });
    try {
      expect((await protectedCtx.req('/metrics')).status).toBe(401);
      const ok = await protectedCtx.req('/metrics', {
        headers: { Authorization: 'Bearer metrics-secret-for-tests-123456' },
      });
      expect(ok.status).toBe(200);
      expect(await ok.text()).toContain('http_requests_total');
    } finally {
      await protectedCtx.close();
    }
  });

  it('метрики используют шаблон маршрута, а не UUID', async () => {
    const ctx = await createTestContext();
    try {
      const list = await ctx.req('/api/v1/events?page_size=1');
      const event = (await list.json()).items[0] as { id: string };
      expect((await ctx.req(`/api/v1/events/${event.id}`)).status).toBe(200);
      const metrics = ctx.metrics.formatPrometheus();
      expect(metrics).not.toContain(event.id);
      expect(metrics).toContain('/api/v1/events/:id');
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

  it('два параллельных confirm выполняют действие ровно один раз', async () => {
    const ctx = await createTestContext();
    const userRef = 'u_confirm_race_000001';
    try {
      const q = await ctx.req('/api/v1/assistant/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'Подпиши меня на концерты в Уфе на выходных',
          user_ref: userRef,
        }),
      });
      const data = await q.json();
      const token = data.confirmation.confirmation_id as string;
      const confirm = () =>
        ctx.req('/api/v1/assistant/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirmation_id: token, user_ref: userRef, confirm: true }),
        });
      const results = await Promise.all([confirm(), confirm()]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);

      const subs = await ctx.req('/api/v1/subscriptions', {
        headers: { Authorization: `Bearer ${userRef}` },
      });
      expect((await subs.json()).items).toHaveLength(1);
    } finally {
      await ctx.close();
    }
  });

  it('текст обращения не попадает в шаги трассы сырым', async () => {
    const ctx = await createTestContext();
    const userRef = 'u_trace_pii_00000001';
    const secret = 'secret@example.com';
    try {
      const q = await ctx.req('/api/v1/assistant/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Сообщить об ошибке: пишите на ${secret}, телефон +7 999 123-45-67`,
          user_ref: userRef,
        }),
      });
      const data = await q.json();
      expect(data.action).toBe('confirmation_required');
      const traceRes = await ctx.adminReq(`/api/v1/admin/traces/${data.trace_id}`);
      const trace = await traceRes.json();
      const serialized = JSON.stringify(trace.steps);
      expect(serialized).not.toContain(secret);
      expect(serialized).not.toContain('999 123-45-67');
      expect(JSON.stringify(trace.plan)).not.toContain(secret);
      expect(JSON.stringify(trace.plan)).not.toContain('999 123-45-67');
      expect(trace.user_query_masked).toContain('[email]');
    } finally {
      await ctx.close();
    }
  });

  it('сохраняет channel подтверждения (telegram не превращается в web)', async () => {
    const ctx = await createTestContext();
    const userRef = 'u_channel_confirm_001';
    try {
      const q = await ctx.req('/api/v1/assistant/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'Подпиши меня на концерты в Уфе на выходных',
          user_ref: userRef,
          channel: 'telegram',
        }),
      });
      const data = await q.json();
      const confirm = await ctx.req('/api/v1/assistant/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirmation_id: data.confirmation.confirmation_id,
          user_ref: userRef,
          confirm: true,
        }),
      });
      const body = await confirm.json();
      expect(body.status).toBe('done');
      expect(body.subscription.channel).toBe('telegram');
    } finally {
      await ctx.close();
    }
  });

  it('confirm со строкой "false" не создаёт подписку', async () => {
    const ctx = await createTestContext();
    const userRef = 'u_confirm_bool_000001';
    try {
      const q = await ctx.req('/api/v1/assistant/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'Подпиши меня на концерты в Уфе на выходных',
          user_ref: userRef,
        }),
      });
      const data = await q.json();
      const res = await ctx.req('/api/v1/assistant/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          confirmation_id: data.confirmation.confirmation_id,
          user_ref: userRef,
          confirm: 'false',
        }),
      });
      expect(res.status).toBe(400);
      const subs = await ctx.req('/api/v1/subscriptions', {
        headers: { Authorization: `Bearer ${userRef}` },
      });
      expect((await subs.json()).items).toHaveLength(0);
    } finally {
      await ctx.close();
    }
  });

  it('save_feedback без user_ref не создаёт подтверждение', async () => {
    const ctx = await createTestContext();
    try {
      const q = await ctx.req('/api/v1/assistant/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Сообщить об ошибке: неверная дата начала' }),
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

  it('traceArgs рекурсивно редактирует вложенные ПДн', async () => {
    const ctx = await createTestContext();
    try {
      const runtime = new ToolRuntime(ctx.db, {
        requestId: 'req_trace_args',
        userRef: 'u_trace_args_00000001',
        now: FIXED_NOW,
      });
      await runtime.execute('save_feedback', {
        kind: 'question',
        text: 'secret@example.com',
        meta: { email: 'secret@example.com', TEXT: 'secret@example.com' },
      });
      const serialized = JSON.stringify(runtime.steps);
      expect(serialized).not.toContain('secret@example.com');
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

      // После выполнения не храним текст обращения и user_ref до retention.
      const rowsAfter = await ctx.db.query<{ payload: unknown; user_ref: string | null }>(
        'SELECT payload, user_ref FROM agent_confirmations',
      );
      expect(JSON.stringify(rowsAfter.rows[0]?.payload)).toBe('{}');
      expect(rowsAfter.rows[0]?.user_ref).toBeNull();

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
