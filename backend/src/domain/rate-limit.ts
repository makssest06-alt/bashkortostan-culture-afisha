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
    if (chain.length > 0) {
      // Каждый доверенный прокси добавляет адрес своего клиента в конец цепочки.
      // Берём адрес на N позиций справа, а не первый (его контролирует клиент).
      const hops = Math.max(1, trustedProxyHops);
      return chain[Math.max(0, chain.length - hops)] ?? fallbackIp;
    }
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
