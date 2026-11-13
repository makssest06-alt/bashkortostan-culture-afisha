import { describe, expect, it } from 'vitest';

import { createSearchState, createSubscriptionDraft, SessionStore } from '../src/session.js';

describe('SessionStore', () => {
  it('создаёт пустую сессию', () => {
    const store = new SessionStore();
    expect(store.get(1)).toEqual({
      awaitingQuery: false,
      search: null,
      draft: null,
    });
  });

  it('сохраняет изменения', () => {
    const store = new SessionStore();
    store.update(1, (session) => {
      session.awaitingQuery = true;
      session.search = createSearchState({
        q: 'балет',
        page: 2,
        date: '2026-11-20',
        priceMax: 1000,
        freeOnly: false,
      });
      session.draft = createSubscriptionDraft({ city: 'ufa' });
    });
    const session = store.get(1);
    expect(session.awaitingQuery).toBe(true);
    expect(session.search?.q).toBe('балет');
    expect(session.search?.date).toBe('2026-11-20');
    expect(session.search?.priceMax).toBe(1000);
    expect(session.draft?.city).toBe('ufa');
  });

  it('сбрасывает сессию', () => {
    const store = new SessionStore();
    store.update(1, (session) => {
      session.awaitingQuery = true;
      session.search = createSearchState({ q: 'x' });
    });
    const reset = store.reset(1);
    expect(reset.awaitingQuery).toBe(false);
    expect(reset.search).toBeNull();
  });

  it('удаляет старые сессии по TTL', () => {
    let now = 1_000_000;
    const store = new SessionStore({ ttlMs: 1000, now: () => now });
    store.update(1, (session) => {
      session.awaitingQuery = true;
    });
    now += 500;
    expect(store.get(1).awaitingQuery).toBe(true);
    now += 1001;
    expect(store.get(1).awaitingQuery).toBe(false);
  });

  it('ограничивает размер хранилища', () => {
    const store = new SessionStore({ maxEntries: 2, now: () => 1 });
    store.update(1, (session) => {
      session.awaitingQuery = true;
    });
    store.update(2, (session) => {
      session.awaitingQuery = true;
    });
    store.update(3, (session) => {
      session.awaitingQuery = true;
    });
    expect(store.size).toBe(2);
    expect(store.get(1).awaitingQuery).toBe(false);
  });
});
