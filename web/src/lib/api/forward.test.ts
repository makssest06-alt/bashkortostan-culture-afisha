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
  it('передаёт адрес посетителя, демо-заголовок ассистента и тело, но не cookie и чужой Authorization', async () => {
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
    expect(sent.get('x-forwarded-for')).toBe('203.0.113.7');
    expect(sent.get('x-assistant-demo')).toBe('unavailable');
    expect(sent.get('x-request-id')).toBe('req-pub-1');
    expect(sent.get('cookie')).toBeNull();
    expect(sent.get('authorization')).toBeNull();
    expect(new TextDecoder().decode(init.body as ArrayBuffer)).toBe('{"message":"концерт"}');
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
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
