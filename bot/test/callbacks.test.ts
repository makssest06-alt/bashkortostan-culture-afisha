import { describe, expect, it } from 'vitest';

import { CallbackStore } from '../src/callback-store.js';
import type { Callback } from '../src/callbacks.js';

const ID = '11111111-1111-4111-8111-111111111111';

const ACTIONS: Callback[] = [
  { type: 'menu', target: 'home' },
  { type: 'menu', target: 'about' },
  { type: 'search', action: 'category', id: 'concert' },
  { type: 'search', action: 'city', id: 'ufa' },
  { type: 'search', action: 'reset' },
  { type: 'search', action: 'page', page: 999 },
  { type: 'filter', action: 'open' },
  { type: 'filter', action: 'dateMenu' },
  { type: 'filter', action: 'setDate', date: '2026-11-20' },
  { type: 'filter', action: 'setPrice', priceMax: 1000, freeOnly: false },
  { type: 'filter', action: 'setCity', city: 'sterlitamak' },
  { type: 'filter', action: 'setCategory', category: 'performance' },
  { type: 'filter', action: 'clear', field: 'all' },
  { type: 'event', id: ID, page: 2 },
  { type: 'subscribe', action: 'quick', city: 'ufa', category: 'concert' },
  { type: 'subscribe', action: 'add' },
  { type: 'subscribe', action: 'pick', field: 'period' },
  { type: 'subscribe', action: 'city', id: null },
  { type: 'subscribe', action: 'period', id: 'weekend' },
  { type: 'subscribe', action: 'save' },
  { type: 'subscriptions', action: 'delete', id: ID },
];

describe('CallbackStore', () => {
  it('выпускает короткий непрозрачный токен и возвращает действие', () => {
    const store = new CallbackStore();
    const action: Callback = { type: 'event', id: ID, page: 3 };
    const token = store.issue(7, action);

    expect(token).toMatch(/^v1_[A-Za-z0-9_-]{12}$/);
    expect(Buffer.byteLength(token, 'utf8')).toBeLessThanOrEqual(64);
    expect(token).not.toContain(ID);
    expect(store.resolve(7, token)).toEqual(action);
  });

  it('не раскрывает ID события или подписки в callback_data', () => {
    const store = new CallbackStore();
    const token = store.issue(7, { type: 'subscriptions', action: 'delete', id: ID });
    expect(token).not.toContain('11111111');
    expect(token).not.toContain('delete');
    expect(token.split(':')).toHaveLength(1);
  });

  it('привязан к пользователю', () => {
    const store = new CallbackStore();
    const token = store.issue(1, { type: 'menu', target: 'home' });
    expect(store.resolve(2, token)).toBeNull();
  });

  it('не принимает чужие, битые и просроченные токены', () => {
    let now = 1_000_000;
    const store = new CallbackStore({ ttlMs: 1000, now: () => now });
    const token = store.issue(1, { type: 'menu', target: 'home' });

    expect(store.resolve(1, 'ev:11111111-1111-4111-8111-111111111111')).toBeNull();
    expect(store.resolve(1, 'v1_AAAAAAAAAAAA')).toBeNull();
    expect(store.resolve(1, 'v1_short')).toBeNull();

    now += 1001;
    expect(store.resolve(1, token)).toBeNull();
  });

  it('переживает все типы действий и не выходит за 64 байта', () => {
    const store = new CallbackStore();
    for (const action of ACTIONS) {
      const token = store.issue(42, action);
      expect(Buffer.byteLength(token, 'utf8')).toBeLessThanOrEqual(64);
      expect(store.resolve(42, token)).toEqual(action);
    }
  });

  it('ограничивает размер хранилища', () => {
    const store = new CallbackStore({ maxEntries: 2, now: () => 1 });
    const first = store.issue(1, { type: 'menu', target: 'home' });
    store.issue(1, { type: 'menu', target: 'help' });
    store.issue(1, { type: 'menu', target: 'about' });

    expect(store.size).toBe(2);
    expect(store.resolve(1, first)).toBeNull();
  });
});
