import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { POST } from '../../app/api/v1/feedback/route';
import { readState, resetForTests } from '../admin/store';
import { loadCatalog } from './db';
import { FEEDBACK_RETENTION_DAYS, storeFeedback, validateFeedback } from './feedback';
import { resetRateForTests } from './rate-limit';

const valid = {
  kind: 'organizer_application',
  name: 'Анна',
  contact: 'anna@example.ru',
  organization: null,
  text: 'Концерт хора 20 декабря в 18:00, вход свободный, источник: https://example.ru',
  website: '',
};

function post(body: unknown, ip = '203.0.113.7'): Promise<Response> {
  return POST(
    new Request('http://afisha.test/api/v1/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
      body: JSON.stringify(body),
    }),
  );
}

describe('форма заявки организатора (п. 6.3)', () => {
  const previousTrust = process.env.TRUST_PROXY_CLIENT_IP;
  beforeEach(() => {
    // Тест эмулирует доверенный прокси, который сам выставляет X-Forwarded-For.
    process.env.TRUST_PROXY_CLIENT_IP = '1';
    resetForTests();
    resetRateForTests();
  });

  afterEach(() => {
    if (previousTrust === undefined) delete process.env.TRUST_PROXY_CLIENT_IP;
    else process.env.TRUST_PROXY_CLIENT_IP = previousTrust;
  });

  it('понятные ошибки по полям на русском', () => {
    const result = validateFeedback({ kind: 'spam', name: 'А', contact: '123', text: 'коротко', website: '' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const byField = Object.fromEntries(result.issues.map((issue) => [issue.field, issue.message]));
    expect(byField.kind).toMatch(/Выберите/);
    expect(byField.name).toMatch(/как к вам обращаться/);
    expect(byField.contact).toMatch(/e-mail|телефон/);
    expect(byField.text).toMatch(/подробнее/);
  });

  it('правильная заявка принимается: 202, id, запись для модератора без имени в журнале', async () => {
    const response = await post(valid);
    expect(response.status).toBe(202);
    const body = (await response.json()) as { id: string; status: string };
    expect(body).toMatchObject({ status: 'received' });
    const state = readState();
    expect(state.applications.map((item) => item.id)).toContain(body.id);
    expect(JSON.stringify(state.audit)).not.toContain('anna@example.ru');
    expect(JSON.stringify(state.audit)).not.toContain('Анна');
  });

  it('ловушка заполнена: ответ как обычно, но ничего не сохраняется', async () => {
    const response = await post({ ...valid, website: 'http://spam.example' });
    expect(response.status).toBe(202);
    expect(readState().applications).toHaveLength(0);
  });

  it('частые отправки с одного адреса получают 429 и Retry-After', async () => {
    for (let i = 0; i < 5; i += 1) expect((await post(valid)).status).toBe(202);
    const limited = await post(valid);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(((await limited.json()) as { message: string }).message).toMatch(/Слишком много обращений/);
    expect((await post(valid, '198.51.100.9')).status).toBe(202);
  });

  it('уточнение привязывается к событию, неизвестное событие отклоняется', async () => {
    const event = loadCatalog().events[0];
    const ok = validateFeedback({ ...valid, kind: 'correction', event_id: event.id });
    expect(ok.ok && ok.value.event_id).toBe(event.id);
    const bad = validateFeedback({ ...valid, kind: 'correction', event_id: 'net-takogo' });
    expect(bad.ok).toBe(false);
  });

  it('заявки старше срока хранения удаляются', () => {
    const parsed = validateFeedback(valid);
    if (!parsed.ok) throw new Error('валидная заявка не прошла');
    const old = new Date(Date.now() - (FEEDBACK_RETENTION_DAYS + 1) * 86_400_000);
    storeFeedback(parsed.value, old);
    storeFeedback(parsed.value, new Date());
    expect(readState().applications).toHaveLength(1);
  });
});
