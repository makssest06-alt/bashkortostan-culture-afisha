import { randomBytes } from 'node:crypto';

import type { Callback } from './callbacks.js';

const TOKEN_RE = /^v1_([A-Za-z0-9_-]{12})$/;

interface Entry {
  userId: number;
  action: Callback;
  expiresAt: number;
}

export interface CallbackStoreOptions {
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
}

/**
 * Хранит действия inline-кнопок в памяти процесса и отдаёт наружу только
 * случайный токен. Telegram не должен быть источником доверия: даже если
 * callback_data подменят, без записи в этом хранилище действие не выполнится.
 *
 * Привязан к user_id, поэтому чужая кнопка (пересланное сообщение, подделка)
 * не сработает. После рестарта старые кнопки становятся stale — это штатно.
 */
export class CallbackStore {
  private readonly entries = new Map<string, Entry>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(options: CallbackStoreOptions = {}) {
    this.ttlMs = options.ttlMs ?? 12 * 60 * 60 * 1000;
    this.maxEntries = options.maxEntries ?? 20_000;
    this.now = options.now ?? Date.now;
  }

  issue(userId: number, action: Callback): string {
    this.prune();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const token = `v1_${randomBytes(9).toString('base64url')}`;
      if (!this.entries.has(token)) {
        this.entries.set(token, {
          userId,
          action,
          expiresAt: this.now() + this.ttlMs,
        });
        this.ensureCapacity();
        return token;
      }
    }
    throw new Error('Не удалось выпустить уникальный callback-токен');
  }

  resolve(userId: number, data: string): Callback | null {
    const match = TOKEN_RE.exec(data);
    if (!match) return null;
    const token = match[0] ?? '';
    const entry = this.entries.get(token);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(token);
      return null;
    }
    if (entry.userId !== userId) return null;
    return entry.action;
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  private prune(): void {
    const now = this.now();
    for (const [token, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(token);
    }
  }

  private ensureCapacity(): void {
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) return;
      this.entries.delete(oldest);
    }
  }
}
