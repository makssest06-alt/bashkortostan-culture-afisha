import { afterEach, describe, expect, it, vi } from 'vitest';

import { backendUrlOf, forwardToBackend } from './forward';

type FetchCall = [string, RequestInit];

function stubFetch(response: () => Response) {
  const mock = vi.fn(async () => response());
  vi.stubGlobal('fetch', mock);
  return mock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('backendUrlOf', () => {
  it('сохраняет путь /api/v1/... и параметры запроса', () => {
    const request = new Request('http://site.local/api/v1/events?city=ufa&page=2');
    expect(backendUrlOf(request, 'https://api.example')).toBe('https://api.example/api/v1/events?city=ufa&page=2');
  });
});

describe('forwardToBackend', () => {
  it('не пересылает клиентский X-Forwarded-For, но передаёт демо-заголовок ассистента и тело, а cookie и чужой Authorization отбрасывает', async () => {
    const fetchMock = stubFetch(() => new Response('{"items":[]}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const request = new Request('http://site.local/api/v1/assistant/query', {
      method: 'POST',
      headers: {
        Cookie: 'afisha_admin=secret-session',
        Authorization: 'Bearer someone-elses',
        'X-Forwarded-For': '203.0.113.7',
        'X-Assistant-Demo': 'unavailable',
        'Content-Type': 'application/json',
      },
      body: '{"message":"концерт"}',
    });

    const response = await forwardToBackend(request, { requestId: 'req-pub-1' });

    const [url, init] = fetchMock.mock.calls[0] as unknown as FetchCall;
    const sent = new Headers(init.headers);
    expect(url).toMatch(/\/api\/v1\/assistant\/query$/);
    // Подделываемый клиентом адрес в бэк не уходит (P0-2).
    expect(sent.get('x-forwarded-for')).toBeNull();
    expect(sent.get('x-assistant-demo')).toBe('unavailable');
    expect(sent.get('x-request-id')).toBe('req-pub-1');
    expect(sent.get('cookie')).toBeNull();
    expect(sent.get('authorization')).toBeNull();
    expect(new TextDecoder().decode(init.body as ArrayBuffer)).toBe('{"message":"концерт"}');
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('за доверенным прокси (TRUST_PROXY_CLIENT_IP=1) ставит X-Forwarded-For из правого элемента цепочки', async () => {
    const previous = process.env.TRUST_PROXY_CLIENT_IP;
    process.env.TRUST_PROXY_CLIENT_IP = '1';
    try {
      const fetchMock = stubFetch(() => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
      const request = new Request('http://site.local/api/v1/feedback', {
        method: 'POST',
        headers: { 'X-Forwarded-For': '1.2.3.4, 203.0.113.7' },
        body: '{}',
      });
      await forwardToBackend(request, { requestId: 'req-pub-3' });
      const [, init] = fetchMock.mock.calls[0] as unknown as FetchCall;
      expect(new Headers(init.headers).get('x-forwarded-for')).toBe('203.0.113.7');
    } finally {
      if (previous === undefined) delete process.env.TRUST_PROXY_CLIENT_IP;
      else process.env.TRUST_PROXY_CLIENT_IP = previous;
    }
  });

  it('передаёт Authorization для подписок (user_ref в заголовке), но не на другие пути', async () => {
    const fetchMock = stubFetch(() => new Response('{"items":[]}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    await forwardToBackend(
      new Request('http://site.local/api/v1/subscriptions', {
        headers: { Authorization: 'Bearer u_9f2c4e7a1b3d5f60' },
      }),
      { requestId: 'req-pub-4' },
    );
    const [, init] = fetchMock.mock.calls[0] as unknown as FetchCall;
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer u_9f2c4e7a1b3d5f60');

    await forwardToBackend(
      new Request('http://site.local/api/v1/events', {
        headers: { Authorization: 'Bearer u_9f2c4e7a1b3d5f60' },
      }),
      { requestId: 'req-pub-5' },
    );
    const [, eventsInit] = fetchMock.mock.calls[1] as unknown as FetchCall;
    expect(new Headers(eventsInit.headers).get('authorization')).toBeNull();
  });

  it('не читает в память тело больше лимита и отвечает 413', async () => {
    const fetchMock = stubFetch(() => new Response('{}', { status: 200 }));
    const response = await forwardToBackend(
      new Request('http://site.local/api/v1/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'x'.repeat(2_000_000),
      }),
      { requestId: 'req-pub-body' },
    );
    expect(response.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({ code: 'payload_too_large' });
  });

  it('отдаёт 304 без тела и с ETag бэка', async () => {
    stubFetch(() => new Response(null, { status: 304, headers: { ETag: 'W/"abc"' } }));
    const response = await forwardToBackend(new Request('http://site.local/api/v1/events/1', { headers: { 'If-None-Match': 'W/"abc"' } }));
    expect(response.status).toBe(304);
    expect(response.headers.get('etag')).toBe('W/"abc"');
    expect(await response.text()).toBe('');
  });

  it('пропускает 429 с Retry-After: лимит частоты бэка доходит до формы', async () => {
    stubFetch(() => new Response('{"code":"rate_limited","message":"Слишком часто","details":[]}', { status: 429, headers: { 'Retry-After': '120' } }));
    const response = await forwardToBackend(new Request('http://site.local/api/v1/feedback', { method: 'POST', body: '{}' }));
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('120');
  });

  it('недоступный бэк превращается в 503 unavailable с понятным текстом', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('fetch failed');
    }));
    const response = await forwardToBackend(new Request('http://site.local/api/v1/events'), { requestId: 'req-pub-2' });
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toMatchObject({ code: 'unavailable', request_id: 'req-pub-2', details: [] });
    expect(body.message).toMatch(/Бэк афиши не отвечает/);
  });
});
