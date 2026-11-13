/**
 * Ограничение частоты запросов в памяти процесса: скользящее окно по ключу (IP и действие).
 * Для одного сервера этого достаточно; в боевом контуре ограничение переезжает в Redis или на прокси.
 */

type Bucket = number[];

const scope = globalThis as typeof globalThis & { __afishaRate?: Map<string, Bucket> };

function buckets(): Map<string, Bucket> {
  scope.__afishaRate ??= new Map();
  return scope.__afishaRate;
}

export interface RateResult {
  ok: boolean;
  /** Через сколько секунд можно повторить, если лимит исчерпан. */
  retryAfter: number;
  remaining: number;
}

/**
 * Учитывает попытку и говорит, укладывается ли она в лимит.
 * @param key например `feedback:203.0.113.5`
 * @param limit сколько попыток разрешено за окно
 * @param windowMs длина окна в миллисекундах
 */
export function hitRate(key: string, limit: number, windowMs: number, now: number = Date.now()): RateResult {
  const map = buckets();
  const bucket = (map.get(key) ?? []).filter((at) => at > now - windowMs);
  if (bucket.length >= limit) {
    map.set(key, bucket);
    return { ok: false, retryAfter: Math.max(1, Math.ceil((bucket[0] + windowMs - now) / 1000)), remaining: 0 };
  }
  bucket.push(now);
  map.set(key, bucket);
  if (map.size > 10_000) {
    for (const [name, list] of map) if (!list.some((at) => at > now - windowMs)) map.delete(name);
  }
  return { ok: true, retryAfter: 0, remaining: limit - bucket.length };
}

/** IP клиента за прокси: первый адрес X-Forwarded-For, иначе X-Real-IP. В журнал он не пишется. */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || request.headers.get('x-real-ip')?.trim() || 'local';
}

export function resetRateForTests(): void {
  scope.__afishaRate = new Map();
}
