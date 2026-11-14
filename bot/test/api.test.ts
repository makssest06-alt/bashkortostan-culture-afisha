import { describe, expect, it } from 'vitest';

import { ApiError, createApiClient } from '../src/api/client.js';
import { makeAssistantResponse, makeEvent, makeListResponse } from './fixtures.js';

interface Call {
  url: string;
  init?: RequestInit;
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function fakeFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): {
  fetchImpl: typeof fetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetchImpl = async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    return handler(url, init);
  };
  return { fetchImpl: fetchImpl as typeof fetch, calls };
}

function clientWith(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
  extra: { retryAttempts?: number } = {},
) {
  const fake = fakeFetch(handler);
  const client = createApiClient({
    baseUrl: 'http://api.test/api/v1/',
    timeoutMs: 1000,
    fetchImpl: fake.fetchImpl,
    ...extra,
  });
  return { client, calls: fake.calls };
}

const SUBSCRIPTION = {
  id: '44444444-4444-4444-8444-444444444444',
  channel: 'telegram',
  user_ref: 'telegram_00000123',
  city: 'ufa',
  category: 'concert',
  period: null,
  created_at: '2026-11-13T10:00:00+05:00',
};

describe('ApiClient', () => {
  it('собирает параметры поиска и разбирает ответ', async () => {
    const list = makeListResponse();
    const { client, calls } = clientWith(() => jsonResponse(list));

    const result = await client.searchEvents({
      q: '  музыка  ',
      city: 'ufa',
      category: 'concert',
      date: 'weekend',
      price_max: 1000,
      free: true,
      page: 2,
      page_size: 5,
      sort: 'date',
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.title).toBe('Вечер башкирской музыки');
    const url = new URL(calls[0]?.url ?? '');
    expect(url.origin).toBe('http://api.test');
    expect(url.pathname).toBe('/api/v1/events');
    expect(url.searchParams.get('q')).toBe('музыка');
    expect(url.searchParams.get('city')).toBe('ufa');
    expect(url.searchParams.get('category')).toBe('concert');
    expect(url.searchParams.get('date')).toBe('weekend');
    expect(url.searchParams.get('price_max')).toBe('1000');
    expect(url.searchParams.get('free')).toBe('true');
    expect(url.searchParams.get('page')).toBe('2');
    expect(url.searchParams.get('page_size')).toBe('5');
    expect(url.searchParams.get('sort')).toBe('date');
    expect(calls[0]?.init?.headers).toMatchObject({
      'x-request-id': expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
  });

  it('не отправляет free=false и price_max=null', async () => {
    const { client, calls } = clientWith(() => jsonResponse(makeListResponse()));
    await client.searchEvents({ free: false, price_max: null });
    const url = new URL(calls[0]?.url ?? '');
    expect(url.searchParams.has('free')).toBe(false);
    expect(url.searchParams.has('price_max')).toBe(false);
  });

  it('передаёт возраст, язык, площадку и сортировку', async () => {
    const { client, calls } = clientWith(() => jsonResponse(makeListResponse()));
    await client.searchEvents({
      age: 6,
      language: 'ba',
      venue_id: 'demo-hall-1',
      sort: 'price',
    });
    const url = new URL(calls[0]?.url ?? '');
    expect(url.searchParams.get('age')).toBe('6');
    expect(url.searchParams.get('language')).toBe('ba');
    expect(url.searchParams.get('venue_id')).toBe('demo-hall-1');
    expect(url.searchParams.get('sort')).toBe('price');
  });

  it('не смешивает конкретную дату и период: период важнее', async () => {
    const { client, calls } = clientWith(() => jsonResponse(makeListResponse()));
    await client.searchEvents({
      date: 'today',
      date_from: '2026-11-20',
      date_to: '2026-11-25',
    });
    const url = new URL(calls[0]?.url ?? '');
    expect(url.searchParams.has('date')).toBe(false);
    expect(url.searchParams.get('date_from')).toBe('2026-11-20');
    expect(url.searchParams.get('date_to')).toBe('2026-11-25');
  });

  it('передаёт период в похожие события', async () => {
    const { client, calls } = clientWith(() => jsonResponse(makeListResponse()));
    await client.getSimilarEvents('11111111-1111-4111-8111-111111111111', {
      date: 'weekend',
      date_from: '2026-11-20',
      date_to: '2026-11-22',
    });
    const url = new URL(calls[0]?.url ?? '');
    expect(url.searchParams.has('date')).toBe(false);
    expect(url.searchParams.get('date_from')).toBe('2026-11-20');
    expect(url.searchParams.get('date_to')).toBe('2026-11-22');
  });

  it('запрашивает расписание площадки', async () => {
    const schedule = {
      venue: { id: 'demo-hall-1', name: 'Зал', city_id: 'ufa', city: 'Уфа' },
      date_from: '2026-11-20',
      date_to: '2026-12-04',
      items: [makeEvent()],
    };
    const { client, calls } = clientWith(() => jsonResponse(schedule));
    const result = await client.getVenueSchedule('demo-hall-1', {
      date_from: '2026-11-20',
      date_to: '2026-12-04',
    });
    expect(result.venue.name).toBe('Зал');
    expect(result.items).toHaveLength(1);
    const url = new URL(calls[0]?.url ?? '');
    expect(url.pathname).toBe('/api/v1/venues/demo-hall-1/schedule');
    expect(url.searchParams.get('date_from')).toBe('2026-11-20');
    expect(url.searchParams.get('date_to')).toBe('2026-12-04');
  });

  it('повторяет GET после 5xx, но не повторяет POST', async () => {
    let attempts = 0;
    const { client } = clientWith(
      () => {
        attempts += 1;
        return attempts === 1
          ? jsonResponse({ code: 'unavailable', message: 'Временно', details: [] }, 503)
          : jsonResponse(makeListResponse());
      },
      { retryAttempts: 1 },
    );
    const result = await client.searchEvents({});
    expect(result.items).toHaveLength(1);
    expect(attempts).toBe(2);

    let posts = 0;
    const second = clientWith(
      () => {
        posts += 1;
        return jsonResponse({ code: 'unavailable', message: 'Временно', details: [] }, 503);
      },
      { retryAttempts: 2 },
    );
    await expect(
      second.client.createSubscription({
        channel: 'telegram',
        user_ref: 'telegram_00000123',
        city: 'ufa',
        category: 'concert',
        period: null,
      }),
    ).rejects.toMatchObject({ status: 503 });
    expect(posts).toBe(1);
  });

  it('не повторяет запрос, если 429 просит ждать слишком долго', async () => {
    let attempts = 0;
    const { client } = clientWith(
      () => {
        attempts += 1;
        return jsonResponse(
          { code: 'rate_limited', message: 'Слишком много запросов', details: [] },
          429,
          { 'retry-after': '60' },
        );
      },
      { retryAttempts: 2 },
    );

    await expect(client.searchEvents({})).rejects.toMatchObject({ status: 429 });
    expect(attempts).toBe(1);
  });

  it('обрезает q до 100 знаков', async () => {
    const { client, calls } = clientWith(() => jsonResponse(makeListResponse()));
    await client.searchEvents({ q: 'я'.repeat(250) });
    const url = new URL(calls[0]?.url ?? '');
    expect(url.searchParams.get('q')).toHaveLength(100);
  });

  it('получает карточку события', async () => {
    const { client } = clientWith(() => jsonResponse(makeEvent()));
    const event = await client.getEvent('11111111-1111-4111-8111-111111111111');
    expect(event.title).toBe('Вечер башкирской музыки');
  });

  it('запрашивает похожие события с городом, датой и пагинацией', async () => {
    const { client, calls } = clientWith(() => jsonResponse(makeListResponse()));
    const result = await client.getSimilarEvents('11111111-1111-4111-8111-111111111111', {
      city: 'ufa',
      date: 'weekend',
      page: 2,
      page_size: 5,
    });

    expect(result.items).toHaveLength(1);
    const url = new URL(calls[0]?.url ?? '');
    expect(url.pathname).toBe(
      '/api/v1/events/11111111-1111-4111-8111-111111111111/similar',
    );
    expect(url.searchParams.get('city')).toBe('ufa');
    expect(url.searchParams.get('date')).toBe('weekend');
    expect(url.searchParams.get('page')).toBe('2');
    expect(url.searchParams.get('page_size')).toBe('5');
  });

  it('разбирает ошибку API и не теряет сообщение бэкенда', async () => {
    const { client } = clientWith(() =>
      jsonResponse(
        {
          code: 'validation_error',
          message: 'Проверьте параметры поиска событий',
          details: [{ field: 'q', message: 'слишком длинный' }],
          request_id: 'req-1',
        },
        400,
      ),
    );

    await expect(client.searchEvents({})).rejects.toMatchObject({
      kind: 'http',
      status: 400,
      code: 'validation_error',
      userMessage: 'Проверьте параметры поиска событий',
    });
    try {
      await client.searchEvents({});
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).details).toEqual([{ field: 'q', message: 'слишком длинный' }]);
      expect((error as ApiError).requestId).toBe('req-1');
    }
  });

  it('берёт request_id из заголовка ответа', async () => {
    const { client } = clientWith(
      () =>
        new Response(JSON.stringify({ code: 'unavailable', message: 'Нет данных', details: [] }), {
          status: 503,
          headers: { 'content-type': 'application/json', 'x-request-id': 'header-req-2' },
        }),
    );
    await expect(client.searchEvents({})).rejects.toMatchObject({
      status: 503,
      requestId: 'header-req-2',
    });
  });

  it('распознаёт 409 как уже существующую подписку', async () => {
    const { client } = clientWith(() =>
      jsonResponse({ code: 'conflict', message: 'Такая подписка уже оформлена', details: [] }, 409),
    );
    await expect(
      client.createSubscription({
        channel: 'telegram',
        user_ref: 'telegram_00000123',
        city: 'ufa',
        category: 'concert',
        period: null,
      }),
    ).rejects.toMatchObject({ status: 409, userMessage: 'Такая подписка уже оформлена.' });
  });

  it('для 404 подписки показывает сообщение бэкенда', async () => {
    const { client } = clientWith(() =>
      jsonResponse({ code: 'not_found', message: 'Подписка не найдена', details: [] }, 404),
    );
    await expect(
      client.deleteSubscription('44444444-4444-4444-8444-444444444444', 'telegram_00000123'),
    ).rejects.toMatchObject({ status: 404, userMessage: 'Подписка не найдена' });
  });

  it('создаёт подписку и передаёт JSON', async () => {
    const { client, calls } = clientWith(() => jsonResponse(SUBSCRIPTION, 201));
    const subscription = await client.createSubscription({
      channel: 'telegram',
      user_ref: 'telegram_00000123',
      city: 'ufa',
      category: 'concert',
      period: null,
    });
    expect(subscription.id).toBe(SUBSCRIPTION.id);
    expect(calls[0]?.init?.method).toBe('POST');
    expect(calls[0]?.init?.headers).toMatchObject({ 'content-type': 'application/json' });
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      channel: 'telegram',
      user_ref: 'telegram_00000123',
      city: 'ufa',
      category: 'concert',
      period: null,
    });
  });

  it('кодирует user_ref при удалении и принимает 204', async () => {
    const { client, calls } = clientWith(() => new Response(null, { status: 204 }));
    await client.deleteSubscription('44444444-4444-4444-8444-444444444444', 'telegram_00000123');
    const url = new URL(calls[0]?.url ?? '');
    expect(url.searchParams.get('user_ref')).toBe('telegram_00000123');
    expect(calls[0]?.init?.method).toBe('DELETE');
  });

  it('перечисляет подписки', async () => {
    const { client, calls } = clientWith(() => jsonResponse({ items: [SUBSCRIPTION] }));
    const items = await client.listSubscriptions('telegram_00000123');
    expect(items).toHaveLength(1);
    expect(new URL(calls[0]?.url ?? '').searchParams.get('user_ref')).toBe('telegram_00000123');
  });

  it('разбирает справочники и health', async () => {
    const { client } = clientWith((url) => {
      if (url.includes('/health')) return jsonResponse({ status: 'ok', timezone: 'Asia/Yekaterinburg' });
      if (url.includes('/cities')) return jsonResponse({ items: [{ id: 'ufa', name: 'Уфа' }] });
      return jsonResponse({ items: [{ id: 'concert', name: 'Концерты' }] });
    });
    expect((await client.health()).status).toBe('ok');
    expect((await client.getCities())[0]?.name).toBe('Уфа');
    expect((await client.getCategories())[0]?.id).toBe('concert');
  });

  it('отклоняет ответ, не соответствующий контракту', async () => {
    const { client } = clientWith(() => jsonResponse({ items: [{ id: 'broken' }] }));
    await expect(client.searchEvents({})).rejects.toMatchObject({ kind: 'contract' });
  });

  it('отклоняет не-JSON успешный ответ', async () => {
    const { client } = clientWith(() => new Response('<html>oops</html>', { status: 200 }));
    await expect(client.searchEvents({})).rejects.toMatchObject({ kind: 'contract' });
  });

  it('отправляет запрос ассистенту и разбирает ответ', async () => {
    const response = makeAssistantResponse({
      results: [],
      total: 0,
      chips: [
        {
          key: 'hard.cities',
          kind: 'city',
          label: 'Город',
          value: 'Уфа',
          removable: true,
          unset: ['hard.cities'],
        },
      ],
    });
    const { client, calls } = clientWith(() => jsonResponse(response));

    const result = await client.queryAssistant({
      message: 'концерт в Уфе',
      previous: { hard: { cities: ['ufa'] } },
      answering: 'city',
      history: [{ role: 'user', content: 'концерт' }],
      user_ref: 'telegram_test',
    });

    expect(result.action).toBe('search');
    expect(result.chips[0]?.unset).toEqual(['hard.cities']);
    expect(calls[0]?.url).toBe('http://api.test/api/v1/assistant/query');
    expect(calls[0]?.init?.method).toBe('POST');
    const body = JSON.parse(String(calls[0]?.init?.body));
    expect(body).toMatchObject({
      message: 'концерт в Уфе',
      previous: { hard: { cities: ['ufa'] } },
      answering: 'city',
      user_ref: 'telegram_test',
      channel: 'telegram',
      limit: 6,
    });
    expect(body.history).toHaveLength(1);
  });

  it('не падает на неполном ответе ассистента', async () => {
    const { client } = clientWith(() =>
      jsonResponse({
        action: 'clarify',
        message: 'Уточните город',
        constraints: {},
        chips: [],
        assumptions: [],
        reference_date: '2026-11-14',
        timezone: 'Asia/Yekaterinburg',
        engine: 'rules-v2',
      }),
    );
    const result = await client.queryAssistant({ message: 'куда сходить' });
    expect(result.action).toBe('clarify');
    expect(result.results).toEqual([]);
    expect(result.relaxations).toEqual([]);
  });

  it('отправляет подтверждение ассистента без повторов', async () => {
    const { client, calls } = clientWith(() => jsonResponse({ status: 'ok' }));
    await client.confirmAssistant('cnf_123456', 'approve');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('http://api.test/api/v1/assistant/confirm');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      confirmation_id: 'cnf_123456',
      decision: 'approve',
    });
  });

  it('оборачивает сетевую ошибку', async () => {
    const { client } = clientWith(() => {
      throw new TypeError('fetch failed');
    });
    await expect(client.searchEvents({})).rejects.toMatchObject({
      kind: 'network',
      userMessage: expect.stringContaining('недоступен'),
    });
  });

  it('оборачивает таймаут', async () => {
    const { client } = clientWith(() => {
      const error = new Error('timed out');
      error.name = 'TimeoutError';
      throw error;
    });
    await expect(client.searchEvents({})).rejects.toMatchObject({ kind: 'timeout' });
  });
});
