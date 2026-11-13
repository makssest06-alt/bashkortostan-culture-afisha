/**
 * Хранилище выдачи каталога в браузере.
 *
 * Зачем оно отдельно от React: ответ по каждому набору условий живёт дольше компонента.
 * Пользователь открыл событие и вернулся назад: список с догруженными страницами
 * отрисовывается сразу, и браузер возвращает прокрутку на прежнее место.
 *
 * Записи неизменяемые: любое обновление кладёт в карту новый объект и будит подписчиков.
 */

import { KIDS_TAG } from '@/data/dictionaries';
import { ApiClientError, listEvents } from '@/lib/api/client';
import type { EventListItem, EventsListResponse, EventsQuery } from '@/lib/api/types';

import { PAGE_SIZE, queryKey } from './query';

/** Сколько живёт ответ: даты и признак «прошло» зависят от текущего времени. */
const FRESH_MS = 5 * 60_000;
const UNKNOWN_PAGE_SIZE = 50;
const UNKNOWN_MAX_PAGES = 4;

export type UnknownKind = 'price' | 'age';

export interface UnknownList {
  status: 'loading' | 'ready' | 'error';
  items: EventListItem[];
}

export interface CatalogEntry {
  status: 'loading' | 'ready' | 'error';
  /** Последний ответ сервера: счётчики, применённые условия, варианты ослабления. */
  response: EventsListResponse | null;
  /** События всех загруженных страниц. */
  items: EventListItem[];
  /** Сколько страниц уже загружено. */
  pages: number;
  loadingMore: boolean;
  /** Догрузка следующей страницы не удалась: кнопка предлагает повторить. */
  moreFailed: boolean;
  /** Сообщение сервера или сети для состояния ошибки. */
  error: string | null;
  /** События, скрытые из-за неуказанной цены или возраста: появляются по кнопке «Показать». */
  unknown: Partial<Record<UnknownKind, UnknownList>>;
  fetchedAt: number;
}

const entries = new Map<string, CatalogEntry>();
const controllers = new Map<string, AbortController>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function put(key: string, entry: CatalogEntry): void {
  entries.set(key, entry);
  emit();
}

function patch(key: string, change: Partial<CatalogEntry>): void {
  const current = entries.get(key);
  if (!current) return;
  put(key, { ...current, ...change });
}

function errorMessage(error: unknown): string | null {
  return error instanceof ApiClientError ? error.message : null;
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function readyEntry(response: EventsListResponse, fetchedAt: number): CatalogEntry {
  return {
    status: 'ready',
    response,
    items: response.items,
    pages: response.page,
    loadingMore: false,
    moreFailed: false,
    error: null,
    unknown: {},
    fetchedAt,
  };
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getEntry(key: string): CatalogEntry | undefined {
  return entries.get(key);
}

/**
 * Ответ, пришедший с сервера вместе со страницей: кладётся без запроса,
 * если по ключу пусто или прежняя запись успела устареть.
 */
export function seed(key: string, entry: CatalogEntry): void {
  const current = entries.get(key);
  if (!current) {
    put(key, entry);
    return;
  }
  if (current === entry || current.status === 'loading') return;
  const stale = current.status === 'error' || Date.now() - current.fetchedAt >= FRESH_MS;
  if (stale && entry.fetchedAt > current.fetchedAt) put(key, entry);
}

/** Запросить выдачу, если её нет, она устарела или прошлый запрос упал. */
export function ensure(query: EventsQuery, options: { force?: boolean } = {}): void {
  const key = queryKey(query);
  const current = entries.get(key);
  if (current && !options.force) {
    if (current.status === 'loading') return;
    if (current.status === 'ready' && Date.now() - current.fetchedAt < FRESH_MS) return;
    if (current.status === 'error') return;
  }

  controllers.get(key)?.abort();
  const controller = new AbortController();
  controllers.set(key, controller);

  put(key, {
    status: 'loading',
    response: null,
    items: [],
    pages: 0,
    loadingMore: false,
    moreFailed: false,
    error: null,
    unknown: {},
    fetchedAt: 0,
  });

  listEvents({ ...query, page: 1, page_size: PAGE_SIZE }, { signal: controller.signal })
    .then((response) => {
      if (controller.signal.aborted) return;
      put(key, readyEntry(response, Date.now()));
    })
    .catch((error: unknown) => {
      if (isAbort(error) || controller.signal.aborted) return;
      patch(key, { status: 'error', error: errorMessage(error) });
    })
    .finally(() => {
      if (controllers.get(key) === controller) controllers.delete(key);
    });
}

/** Условия сменились раньше, чем пришёл ответ: незавершённый запрос больше не нужен. */
export function abandon(key: string): void {
  const current = entries.get(key);
  if (current?.status !== 'loading') return;
  controllers.get(key)?.abort();
  controllers.delete(key);
  entries.delete(key);
}

/** Следующая страница дописывается в конец списка. */
export function loadMore(query: EventsQuery): void {
  const key = queryKey(query);
  const current = entries.get(key);
  if (!current || current.status !== 'ready' || !current.response || current.loadingMore) return;
  if (current.pages >= current.response.total_pages) return;

  const nextPage = current.pages + 1;
  patch(key, { loadingMore: true, moreFailed: false });

  listEvents({ ...query, page: nextPage, page_size: PAGE_SIZE })
    .then((response) => {
      const latest = entries.get(key);
      if (!latest || latest.status !== 'ready' || latest.pages !== nextPage - 1) return;
      const known = new Set(latest.items.map((item) => item.id));
      put(key, {
        ...latest,
        response,
        items: [...latest.items, ...response.items.filter((item) => !known.has(item.id))],
        pages: nextPage,
        loadingMore: false,
        fetchedAt: Date.now(),
      });
    })
    .catch(() => {
      patch(key, { loadingMore: false, moreFailed: true });
    });
}

/**
 * События, которые подошли бы по остальным условиям, но не прошли из-за пустого поля.
 * Сервер их только считает (hidden_unknown_*). Чтобы показать, запрашиваем выдачу
 * без условия по цене или возрасту и оставляем записи с неуказанным полем.
 */
export function revealUnknown(query: EventsQuery, kind: UnknownKind): void {
  const key = queryKey(query);
  const current = entries.get(key);
  if (!current || current.status !== 'ready') return;
  if (current.unknown[kind]?.status === 'loading' || current.unknown[kind]?.status === 'ready') return;

  const setUnknown = (list: UnknownList) => {
    const latest = entries.get(key);
    if (!latest) return;
    put(key, { ...latest, unknown: { ...latest.unknown, [kind]: list } });
  };
  setUnknown({ status: 'loading', items: [] });

  const withoutPrice: EventsQuery = { ...query, price_max: undefined, free_only: undefined };
  const withoutAge: EventsQuery = { ...query, age: undefined, age_rating: undefined, audience: undefined };
  const hasPriceFilter = query.price_max !== undefined || Boolean(query.free_only);
  const hasAgeFilter = query.age !== undefined || Boolean(query.age_rating?.length) || Boolean(query.audience);
  // Раздел «Детям» проходит условие «с детьми» и без возрастной метки: такие события уже в выдаче.
  const kidsPassAnyway = query.audience === 'kids' && query.age === undefined && !query.age_rating?.length;
  const priceUnknown = (item: EventListItem) => item.price_summary.kind === 'unknown';
  const ageUnknown = (item: EventListItem) =>
    item.age_rating === null && !(kidsPassAnyway && item.tags.includes(KIDS_TAG));

  const fetchAll = async (relaxed: EventsQuery, keep: (item: EventListItem) => boolean) => {
    const found: EventListItem[] = [];
    for (let page = 1; page <= UNKNOWN_MAX_PAGES; page += 1) {
      const response = await listEvents({ ...relaxed, page, page_size: UNKNOWN_PAGE_SIZE });
      found.push(...response.items.filter(keep));
      if (page >= response.total_pages) break;
    }
    return found;
  };

  const collect = async (): Promise<EventListItem[]> => {
    const found = await fetchAll(kind === 'price' ? withoutPrice : withoutAge, kind === 'price' ? priceUnknown : ageUnknown);
    // Сервер считает событие в обоих счётчиках, если у него не указаны и цена, и возраст.
    if (hasPriceFilter && hasAgeFilter) {
      const both = await fetchAll(
        { ...withoutPrice, age: undefined, age_rating: undefined, audience: undefined },
        (item) => priceUnknown(item) && ageUnknown(item),
      );
      const known = new Set(found.map((item) => item.id));
      found.push(...both.filter((item) => !known.has(item.id)));
    }
    return found;
  };

  collect()
    .then((items) => setUnknown({ status: 'ready', items }))
    .catch(() => setUnknown({ status: 'error', items: [] }));
}

export function hideUnknown(query: EventsQuery, kind: UnknownKind): void {
  const key = queryKey(query);
  const current = entries.get(key);
  if (!current?.unknown[kind]) return;
  const unknown = { ...current.unknown };
  delete unknown[kind];
  put(key, { ...current, unknown });
}
