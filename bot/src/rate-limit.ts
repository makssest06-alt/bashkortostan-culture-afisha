export interface RateLimitResult {
  allowed: boolean;
  retryAfterSec: number;
  remaining: number;
}

export interface RateLimiterOptions {
  limit?: number;
  windowMs?: number;
  maxEntries?: number;
  now?: () => number;
}

interface Window {
  count: number;
  resetAt: number;
}

/**
 * Простой лимитер на пользователя. Нужен, чтобы один чат не мог залить API
 * сотней запросов или случайно нажать «Показать ещё» в цикле.
 */
export class RateLimiter {
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;
  private readonly windows = new Map<number, Window>();

  constructor(options: RateLimiterOptions = {}) {
    this.limit = options.limit ?? 20;
    this.windowMs = options.windowMs ?? 60_000;
    this.maxEntries = options.maxEntries ?? 10_000;
    this.now = options.now ?? Date.now;
  }

  take(userId: number): RateLimitResult {
    if (this.limit <= 0) {
      return { allowed: true, retryAfterSec: 0, remaining: Number.POSITIVE_INFINITY };
    }

    const now = this.now();
    this.prune(now);
    const current = this.windows.get(userId);
    if (!current || current.resetAt <= now) {
      this.windows.set(userId, { count: 1, resetAt: now + this.windowMs });
      this.ensureCapacity();
      return { allowed: true, retryAfterSec: 0, remaining: this.limit - 1 };
    }

    if (current.count < this.limit) {
      current.count += 1;
      // Обновляем позицию в Map: при переполнении вытесняется самый давний
      // по активности пользователь, а не самый первый зарегистрированный.
      this.windows.delete(userId);
      this.windows.set(userId, current);
      return { allowed: true, retryAfterSec: 0, remaining: this.limit - current.count };
    }

    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
      remaining: 0,
    };
  }

  get size(): number {
    return this.windows.size;
  }

  clear(): void {
    this.windows.clear();
  }

  private prune(now: number): void {
    for (const [userId, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(userId);
    }
  }

  private ensureCapacity(): void {
    while (this.windows.size > this.maxEntries) {
      const oldest = this.windows.keys().next().value as number | undefined;
      if (oldest === undefined) return;
      this.windows.delete(oldest);
    }
  }
}
