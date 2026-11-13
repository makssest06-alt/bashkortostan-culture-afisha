import type { CategoryId, CityId, DatePreset } from './dictionaries.js';

export interface SearchState {
  q: string | null;
  city: CityId | null;
  category: CategoryId | null;
  date: DatePreset | null;
  page: number;
  totalPages: number;
  queryTruncated: boolean;
}

export interface SubscriptionDraft {
  city: CityId | null;
  category: CategoryId | null;
  period: DatePreset | null;
}

export interface SessionData {
  awaitingQuery: boolean;
  search: SearchState | null;
  draft: SubscriptionDraft | null;
}

export function createSessionData(): SessionData {
  return {
    awaitingQuery: false,
    search: null,
    draft: null,
  };
}

export function createSearchState(partial: Partial<SearchState> = {}): SearchState {
  return {
    q: partial.q ?? null,
    city: partial.city ?? null,
    category: partial.category ?? null,
    date: partial.date ?? null,
    page: partial.page ?? 1,
    totalPages: partial.totalPages ?? 0,
    queryTruncated: partial.queryTruncated ?? false,
  };
}

export function createSubscriptionDraft(partial: Partial<SubscriptionDraft> = {}): SubscriptionDraft {
  return {
    city: partial.city ?? null,
    category: partial.category ?? null,
    period: partial.period ?? null,
  };
}

interface Entry {
  data: SessionData;
  updatedAt: number;
}

export interface SessionStoreOptions {
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
}

/**
 * Состояние диалога в памяти процесса. При рестарте бота состояния сбрасываются:
 * для уровня 1 это осознанное ограничение, сами подписки живут в API.
 */
export class SessionStore {
  private readonly entries = new Map<number, Entry>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(options: SessionStoreOptions = {}) {
    this.ttlMs = options.ttlMs ?? 2 * 60 * 60 * 1000;
    this.maxEntries = options.maxEntries ?? 5000;
    this.now = options.now ?? Date.now;
  }

  get(userId: number): SessionData {
    this.prune();
    const existing = this.entries.get(userId);
    if (existing) return existing.data;

    const data = createSessionData();
    this.entries.set(userId, { data, updatedAt: this.now() });
    this.ensureCapacity();
    return data;
  }

  update(userId: number, mutate: (session: SessionData) => void): SessionData {
    const session = this.get(userId);
    mutate(session);
    const entry = this.entries.get(userId);
    if (entry) entry.updatedAt = this.now();
    return session;
  }

  reset(userId: number): SessionData {
    const data = createSessionData();
    this.entries.delete(userId);
    this.entries.set(userId, { data, updatedAt: this.now() });
    return data;
  }

  delete(userId: number): void {
    this.entries.delete(userId);
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  private prune(): void {
    const cutoff = this.now() - this.ttlMs;
    for (const [userId, entry] of this.entries) {
      if (entry.updatedAt < cutoff) this.entries.delete(userId);
    }
  }

  private ensureCapacity(): void {
    if (this.entries.size <= this.maxEntries) return;
    let oldestUserId: number | null = null;
    let oldestAt = Number.POSITIVE_INFINITY;
    for (const [userId, entry] of this.entries) {
      if (entry.updatedAt < oldestAt) {
        oldestAt = entry.updatedAt;
        oldestUserId = userId;
      }
    }
    if (oldestUserId !== null) this.entries.delete(oldestUserId);
  }
}
