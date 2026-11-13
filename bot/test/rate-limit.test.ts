import { describe, expect, it } from 'vitest';

import { RateLimiter } from '../src/rate-limit.js';

describe('RateLimiter', () => {
  it('пропускает до лимита и затем просит подождать', () => {
    let now = 1_000_000;
    const limiter = new RateLimiter({ limit: 2, windowMs: 60_000, now: () => now });

    expect(limiter.take(1).allowed).toBe(true);
    expect(limiter.take(1).allowed).toBe(true);
    const blocked = limiter.take(1);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBe(60);

    now += 60_001;
    expect(limiter.take(1).allowed).toBe(true);
  });

  it('считает пользователей раздельно', () => {
    const limiter = new RateLimiter({ limit: 1 });
    expect(limiter.take(1).allowed).toBe(true);
    expect(limiter.take(2).allowed).toBe(true);
  });

  it('лимит 0 выключает ограничение', () => {
    const limiter = new RateLimiter({ limit: 0 });
    for (let index = 0; index < 100; index += 1) {
      expect(limiter.take(1).allowed).toBe(true);
    }
  });

  it('не растёт бесконечно', () => {
    let now = 1_000_000;
    const limiter = new RateLimiter({ limit: 1, maxEntries: 2, now: () => now });
    limiter.take(1);
    limiter.take(2);
    limiter.take(3);
    expect(limiter.size).toBe(2);
  });

  it('вытесняет давно неактивного пользователя, а не активного', () => {
    const now = 1_000_000;
    const limiter = new RateLimiter({ limit: 5, maxEntries: 2, now: () => now });
    limiter.take(1);
    limiter.take(2);
    limiter.take(1); // пользователь 1 активен, должен переехать в конец
    limiter.take(3); // вытесняется пользователь 2

    expect(limiter.size).toBe(2);
    expect(limiter.take(1).remaining).toBe(2); // окно пользователя 1 не сброшено
  });
});
