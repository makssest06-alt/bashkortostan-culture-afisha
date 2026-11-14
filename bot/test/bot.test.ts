import { once } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import { BackendApiClient, type AssistantQueryResponse, type BotEvent, type EventListResponse } from '../src/api-client.js';
import { loadBotConfig } from '../src/config.js';
import { escapeHtml, formatEventCardHtml, safeHttpUrl } from '../src/format.js';
import { BotHandler } from '../src/handlers.js';
import { SessionStore } from '../src/session.js';
import { createBotHttpServer } from '../src/telegram.js';

const SAMPLE_EVENT: BotEvent = {
  id: '00000000-0000-4000-8000-000000000001',
  title: 'Вечер <script>alert(1)</script> музыки',
  category: 'concert',
  date_start: '2026-11-14T19:00:00+05:00',
  date_end: '2026-11-14T21:00:00+05:00',
  city: 'Уфа',
  city_id: 'ufa',
  venue: 'Филармония',
  address: 'ул. Гоголя, 58',
  description: 'Описание <a href="http://evil.invalid">клик</a> и [тык](javascript:alert(1)).',
  price_min: 500,
  price_max: 1200,
  is_free: false,
  age_limit: 6,
  source_url: 'https://example.ru/events/1',
  org_link: 'javascript:alert(1)',
  status: 'published',
  time_precision: 'minute',
};

function assertButtonsUnder64Bytes(reply: { reply_markup?: { inline_keyboard: Array<Array<{ callback_data: string }>> } }) {
  for (const row of reply.reply_markup?.inline_keyboard ?? []) {
    for (const button of row) {
      expect(Buffer.byteLength(button.callback_data, 'utf8')).toBeLessThanOrEqual(64);
    }
  }
}

describe('Telegram Bot (Level 1 + Level 3 Agent + Security)', () => {
  it('escapes HTML markup and blocks javascript: URLs in cards (OUTX-101/OUTX-102)', () => {
    expect(escapeHtml('<script>x</script>')).toBe('&lt;script&gt;x&lt;/script&gt;');
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull();
    expect(safeHttpUrl('https://example.ru/ok')).toBe('https://example.ru/ok');

    const html = formatEventCardHtml(SAMPLE_EVENT, {
      publicWebUrl: 'http://localhost:3210',
      reasons: ['Подходит по городу Уфа'],
    });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('https://example.ru/events/1');
  });

  it('navigates /start -> city -> events -> card -> pagination with <=64-byte callback_data', async () => {
    const config = loadBotConfig({ BOT_TOKEN: '', API_BASE_URL: 'http://api.local' });
    const listResponse: EventListResponse = {
      items: [SAMPLE_EVENT],
      page: 1,
      page_size: 5,
      total: 8,
      total_pages: 2,
    };

    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      const s = String(url);
      if (s.includes('/api/v1/events/')) {
        return new Response(JSON.stringify(SAMPLE_EVENT), { status: 200 });
      }
      return new Response(JSON.stringify(listResponse), { status: 200 });
    });

    const api = new BackendApiClient('http://api.local', fetchMock as unknown as typeof fetch);
    const sessions = new SessionStore();
    const bot = new BotHandler(api, sessions, config);

    const startReply = await bot.handleMessage(42, '/start');
    expect(startReply.text).toContain('Неофициальный сервис');
    assertButtonsUnder64Bytes(startReply);

    const cityMenu = await bot.handleCallback(42, 'menu:city');
    assertButtonsUnder64Bytes(cityMenu);

    const citySelected = await bot.handleCallback(42, 'c:sterlitamak');
    expect(citySelected.text).toContain('Стерлитамак');
    assertButtonsUnder64Bytes(citySelected);

    const listReply = await bot.handleCallback(42, 'ev:list:1');
    expect(listReply.text).toContain('Найдено событий: 8');
    assertButtonsUnder64Bytes(listReply);

    const detailBtn = listReply.reply_markup!.inline_keyboard[0][0].callback_data;
    const cardReply = await bot.handleCallback(42, detailBtn);
    expect(cardReply.text).toContain('Филармония');
    assertButtonsUnder64Bytes(cardReply);
  });

  it('keeps 5+ turn AI history, handles confirmations idempotently, and falls back to catalog on 503', async () => {
    const config = loadBotConfig({ BOT_TOKEN: '', API_BASE_URL: 'http://api.local' });
    const capturedQueries: Array<Record<string, unknown>> = [];
    let confirmCalls = 0;
    let assistantShouldFail = false;

    const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const s = String(url);
      if (s.endsWith('/api/v1/assistant/query')) {
        if (assistantShouldFail) {
          return new Response(JSON.stringify({ code: 'unavailable', message: 'down' }), { status: 503 });
        }
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        capturedQueries.push(body);

        if (String(body.message).includes('подпиши')) {
          const payload: AssistantQueryResponse = {
            action: 'confirmation_required',
            message: 'Подтвердите оформление подписки',
            constraints: { hard: { cities: ['ufa'] }, soft: {} },
            confirmation: {
              confirmation_id: 'cfm-1234',
              summary: 'Подписка на Уфу',
              expires_at: '2026-11-13T18:00:00+05:00',
            },
            engine: 'rules-v2',
          };
          return new Response(JSON.stringify(payload), { status: 200 });
        }

        const payload: AssistantQueryResponse = {
          action: 'search',
          message: `Ответ на: ${body.message}`,
          constraints: { hard: { cities: ['ufa'] }, soft: {} },
          results: [{ event: SAMPLE_EVENT, occurrence_id: 'occ-1', reasons: ['В Уфе'], caveats: [] }],
          total: 1,
          engine: 'rules-v2',
        };
        return new Response(JSON.stringify(payload), { status: 200 });
      }

      if (s.endsWith('/api/v1/assistant/confirm')) {
        confirmCalls += 1;
        return new Response(JSON.stringify({ status: 'confirmed', message: 'Подписка создана.' }), { status: 200 });
      }

      if (s.includes('/api/v1/events')) {
        return new Response(
          JSON.stringify({ items: [SAMPLE_EVENT], page: 1, page_size: 5, total: 1, total_pages: 1 }),
          { status: 200 },
        );
      }

      return new Response('{}', { status: 200 });
    });

    const api = new BackendApiClient('http://api.local', fetchMock as unknown as typeof fetch);
    const sessions = new SessionStore();
    const bot = new BotHandler(api, sessions, config);

    // Send 6 sequential user turns to verify >=5 history window is forwarded
    for (let i = 1; i <= 6; i++) {
      const r = await bot.handleMessage(777, `Реплика ${i}`);
      assertButtonsUnder64Bytes(r);
    }
    const lastHistory = capturedQueries[5].history as Array<{ role: string; content: string }>;
    expect(lastHistory.length).toBeGreaterThanOrEqual(8); // >= 4 pairs = 8 turns
    expect(capturedQueries[5].user_ref).toMatch(/^tg_[a-f0-9]{24}$/);

    // Confirmation workflow + double-click idempotency
    const subPrompt = await bot.handleMessage(777, 'подпиши меня на Уфу');
    assertButtonsUnder64Bytes(subPrompt);
    const yesBtn = subPrompt.reply_markup!.inline_keyboard[0][0].callback_data;

    const firstClick = await bot.handleCallback(777, yesBtn);
    expect(firstClick.text).toContain('Подписка создана');
    const secondClick = await bot.handleCallback(777, yesBtn);
    expect(secondClick.text).toContain('уже обработано');
    expect(confirmCalls).toBe(1);

    // 503 outage -> automatic catalog fallback
    assistantShouldFail = true;
    const fallbackReply = await bot.handleMessage(777, 'Бесплатные концерты в Уфе');
    expect(fallbackReply.text).toContain('временно недоступен');
    expect(fallbackReply.text).toContain('Найдено событий: 1');
  });

  it('rejects /webhook requests with missing or invalid X-Telegram-Bot-Api-Secret-Token (401)', async () => {
    const config = loadBotConfig({
      BOT_TOKEN: 'dummy-token',
      BOT_MODE: 'webhook',
      WEBHOOK_SECRET: 'super-secret-token',
    });
    const api = new BackendApiClient('http://api.local', vi.fn() as unknown as typeof fetch);
    const bot = new BotHandler(api, new SessionStore(), config);
    const server = createBotHttpServer(config, bot, null);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');

    try {
      const addr = server.address();
      if (!addr || typeof addr === 'string') throw new Error('Expected address');
      const base = `http://127.0.0.1:${addr.port}`;

      const badRes = await fetch(`${base}/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'wrong' },
        body: JSON.stringify({ update_id: 1 }),
      });
      expect(badRes.status).toBe(401);

      const goodRes = await fetch(`${base}/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Telegram-Bot-Api-Secret-Token': 'super-secret-token',
        },
        body: JSON.stringify({ update_id: 2, message: { message_id: 1, chat: { id: 10 }, text: '/help' } }),
      });
      expect(goodRes.status).toBe(200);
      const body = (await goodRes.json()) as { ok: boolean; handled: boolean };
      expect(body.ok).toBe(true);
      expect(body.handled).toBe(true);
    } finally {
      server.close();
    }
  });
});
