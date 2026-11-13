import { describe, expect, it } from 'vitest';

import { ApiError, createApiClient } from '../src/api/client.js';
import { makeEvent, makeListResponse } from './fixtures.js';

interface Call {
  url: string;
  init?: RequestInit;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
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

function clientWith(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const fake = fakeFetch(handler);
  const client = createApiClient({
    baseUrl: 'http://api.test/api/v1/',
    timeoutMs: 1000,
    fetchImpl: fake.fetchImpl,
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
    expect(url.searchParams.get('page')).toBe('2');
    expect(url.searchParams.get('page_size')).toBe('5');
    expect(url.searchParams.get('sort')).toBe('date');
  });

  it('обрезает q до 200 знаков', async () => {
    const { client, calls } = clientWith(() => jsonResponse(makeListResponse()));
    await client.searchEvents({ q: 'я'.repeat(250) });
    const url = new URL(calls[0]?.url ?? '');
    expect(url.searchParams.get('q')).toHaveLength(200);
  });

  it('получает карточку события', async () => {
    const { client } = clientWith(() => jsonResponse(makeEvent()));
    const event = await client.getEvent('11111111-1111-4111-8111-111111111111');
    expect(event.title).toBe('Вечер башкирской музыки');
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
    }
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
