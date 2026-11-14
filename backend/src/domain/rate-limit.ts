export interface RateCheck {
  ok: boolean;
  retryAfter: number;
  remaining: number;
}

export class SlidingRateLimiter {
  private readonly hits = new Map<string, number[]>();
  private lastSweepMs = 0;
  /** Все окна в приложении не длиннее суток: запись без обращений дольше — мусор. */
  private static readonly SWEEP_AFTER_MS = 24 * 60 * 60_000;
  private static readonly SWEEP_EVERY_MS = 60_000;
  private static readonly MAX_KEYS = 50_000;

  private sweep(nowMs: number): void {
    if (nowMs - this.lastSweepMs < SlidingRateLimiter.SWEEP_EVERY_MS) return;
    this.lastSweepMs = nowMs;
    const cutoff = nowMs - SlidingRateLimiter.SWEEP_AFTER_MS;
    for (const [key, timestamps] of this.hits) {
      const last = timestamps[timestamps.length - 1] ?? 0;
      if (last <= cutoff) this.hits.delete(key);
    }
    if (this.hits.size > SlidingRateLimiter.MAX_KEYS) {
      const excess = this.hits.size - SlidingRateLimiter.MAX_KEYS;
      let removed = 0;
      for (const key of this.hits.keys()) {
        this.hits.delete(key);
        removed += 1;
        if (removed >= excess) break;
      }
    }
  }

  checkAndConsume(key: string, maxRequests: number, windowMs: number, nowMs: number = Date.now()): RateCheck {
    this.sweep(nowMs);
    const cutoff = nowMs - windowMs;
    const recent = (this.hits.get(key) ?? []).filter((ts) => ts > cutoff);
    if (recent.length >= maxRequests) {
      const oldest = recent[0];
      const retryAfter = Math.max(1, Math.ceil((oldest + windowMs - nowMs) / 1000));
      this.hits.set(key, recent);
      return { ok: false, retryAfter, remaining: 0 };
    }
    recent.push(nowMs);
    this.hits.set(key, recent);
    return { ok: true, retryAfter: 0, remaining: Math.max(0, maxRequests - recent.length) };
  }

  /** Проверка сразу двух окон (например, 5 за 10 мин и 20 за 24 ч). */
  consumeMulti(
    keyBase: string,
    rules: readonly { suffix: string; max: number; windowMs: number }[],
    nowMs: number = Date.now(),
  ): RateCheck {
    this.sweep(nowMs);
    for (const rule of rules) {
      const key = `${keyBase}:${rule.suffix}`;
      const cutoff = nowMs - rule.windowMs;
      const recent = (this.hits.get(key) ?? []).filter((ts) => ts > cutoff);
      this.hits.set(key, recent);
      if (recent.length >= rule.max) {
        const retryAfter = Math.max(1, Math.ceil((recent[0] + rule.windowMs - nowMs) / 1000));
        return { ok: false, retryAfter, remaining: 0 };
      }
    }
    let minRemaining = Infinity;
    for (const rule of rules) {
      const key = `${keyBase}:${rule.suffix}`;
      const arr = this.hits.get(key) ?? [];
      arr.push(nowMs);
      this.hits.set(key, arr);
      minRemaining = Math.min(minRemaining, Math.max(0, rule.max - arr.length));
    }
    return { ok: true, retryAfter: 0, remaining: minRemaining };
  }

  clear(): void {
    this.hits.clear();
  }
}

export function clientIpFromHeaders(
  headers: Headers,
  trustedProxyHops = 1,
  fallbackIp = '127.0.0.1',
): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const chain = forwarded
      .split(',')
      .map((part) => normalizeClientIp(part.trim()))
      .filter(Boolean);
    const hops = Math.max(1, trustedProxyHops);
    // Если цепочка короче числа доверенных прокси — доверять ей нельзя,
    // иначе клиент подставит один адрес и станет «клиентом» сам.
    if (chain.length >= hops) {
      return chain[chain.length - hops] ?? fallbackIp;
    }
    return fallbackIp;
  }
  const realIp = normalizeClientIp(headers.get('x-real-ip')?.trim() ?? '');
  return realIp || fallbackIp;
}

/** Приводит IPv4-mapped IPv6 (`::ffff:127.0.0.1`) к обычному IPv4. */
export function normalizeClientIp(raw: string): string {
  const value = raw.trim();
  if (!value) return '';
  if (value.startsWith('::ffff:') && value.includes('.')) return value.slice('::ffff:'.length);
  return value;
}
