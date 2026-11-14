export interface RateCheck {
  ok: boolean;
  retryAfter: number;
  remaining: number;
}

export class SlidingRateLimiter {
  private readonly hits = new Map<string, number[]>();

  checkAndConsume(key: string, maxRequests: number, windowMs: number, nowMs: number = Date.now()): RateCheck {
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

export function clientIpFromHeaders(headers: Headers, fallbackIp = '127.0.0.1'): string {
  const fwd = headers.get('x-forwarded-for');
  if (fwd) {
    const first = fwd.split(',')[0]?.trim();
    if (first) return first;
  }
  const realIp = headers.get('x-real-ip')?.trim();
  return realIp || fallbackIp;
}
