import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EXAMPLE_ADMIN_TOKEN } from './auth';
import { forwardAdmin } from './forward';

type FetchCall = [string, RequestInit];

describe('forwardAdmin', () => {
  const savedToken = process.env.ADMIN_TOKEN;

  beforeEach(() => {
    process.env.ADMIN_TOKEN = 'test-moderator-token';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (savedToken === undefined) delete process.env.ADMIN_TOKEN;
    else process.env.ADMIN_TOKEN = savedToken;
  });

  it('добавляет Bearer-токен сайта, передаёт If-Match и тело, но не пересылает cookie сессии', async () => {
    const fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200, headers: { ETag: '"v2"', 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const request = new Request('http://site.local/api/v1/admin/events/evt-1', {
      method: 'PATCH',
      headers: { Cookie: 'afisha_admin=secret-session', 'If-Match': '"v1"', 'Content-Type': 'application/json' },
      body: '{"title":"Новое"}',
    });

    const response = await forwardAdmin(request, 'req-1');

    const [url, init] = fetchMock.mock.calls[0] as unknown as FetchCall;
    const sent = new Headers(init.headers);
    expect(url).toMatch(/\/api\/v1\/admin\/events\/evt-1$/);
    expect(sent.get('authorization')).toBe('Bearer test-moderator-token');
    expect(sent.get('if-match')).toBe('"v1"');
    expect(sent.get('cookie')).toBeNull();
    expect(new TextDecoder().decode(init.body as ArrayBuffer)).toBe('{"title":"Новое"}');
    expect(response.status).toBe(200);
    expect(response.headers.get('etag')).toBe('"v2"');
    expect(await response.json()).toEqual({ ok: true });
  });

  it('отдаёт ответ бэка с его кодом: 412 при устаревшем ETag доходит до страницы', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"code":"precondition_failed","message":"…","details":[]}', { status: 412 })));
    const response = await forwardAdmin(new Request('http://site.local/api/v1/admin/events/evt-1', { method: 'PATCH', body: '{}' }), 'req-2');
    expect(response.status).toBe(412);
    expect((await response.json()).code).toBe('precondition_failed');
  });

  it('с заглушкой из .env.example токен в бэк не уходит', async () => {
    process.env.ADMIN_TOKEN = EXAMPLE_ADMIN_TOKEN;
    const fetchMock = vi.fn(async () => new Response('{}', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    await forwardAdmin(new Request('http://site.local/api/v1/admin/audit'), 'req-3');
    const [, init] = fetchMock.mock.calls[0] as unknown as FetchCall;
    expect(new Headers(init.headers).get('authorization')).toBeNull();
  });
});
