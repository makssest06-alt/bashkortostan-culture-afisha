import {
  isCategoryId,
  isCityId,
  isDatePreset,
  type CategoryId,
  type CityId,
  type DatePreset,
} from './dictionaries.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type MenuTarget = 'home' | 'search' | 'categories' | 'cities' | 'soon' | 'subs' | 'help';

export type Callback =
  | { type: 'menu'; target: MenuTarget }
  | { type: 'search'; action: 'category'; id: CategoryId }
  | { type: 'search'; action: 'city'; id: CityId }
  | { type: 'search'; action: 'reset' }
  | { type: 'search'; action: 'page'; page: number }
  | { type: 'event'; id: string; page: number | null }
  | { type: 'subscribe'; action: 'event'; id: string }
  | { type: 'subscribe'; action: 'quick'; city: CityId; category: CategoryId }
  | { type: 'subscribe'; action: 'add' }
  | { type: 'subscribe'; action: 'pick'; field: 'city' | 'category' | 'period' }
  | { type: 'subscribe'; action: 'summary' }
  | { type: 'subscribe'; action: 'city'; id: CityId | null }
  | { type: 'subscribe'; action: 'category'; id: CategoryId | null }
  | { type: 'subscribe'; action: 'period'; id: DatePreset | null }
  | { type: 'subscribe'; action: 'save' | 'cancel' }
  | { type: 'subscriptions'; action: 'delete'; id: string }
  | { type: 'noop' };

const MENU_TARGETS = new Set<MenuTarget>([
  'home',
  'search',
  'categories',
  'cities',
  'soon',
  'subs',
  'help',
]);

export const CB = {
  menu: (target: MenuTarget) => `menu:${target}`,
  searchCategory: (id: CategoryId) => `search:cat:${id}`,
  searchCity: (id: CityId) => `search:city:${id}`,
  searchReset: () => 'search:all',
  searchPage: (page: number) => `search:page:${page}`,
  event: (id: string, page?: number | null) => (page && page > 1 ? `ev:${id}:${page}` : `ev:${id}`),
  subscribeEvent: (id: string) => `sub:event:${id}`,
  subscribeQuick: (city: CityId, category: CategoryId) => `sub:quick:${city}:${category}`,
  subscribeAdd: () => 'sub:add',
  subscribePick: (field: 'city' | 'category' | 'period') => `sub:pick:${field}`,
  subscribeSummary: () => 'sub:summary',
  subscribeCity: (id: CityId | null) => `sub:city:${id ?? 'any'}`,
  subscribeCategory: (id: CategoryId | null) => `sub:cat:${id ?? 'any'}`,
  subscribePeriod: (id: DatePreset | null) => `sub:period:${id ?? 'any'}`,
  subscribeSave: () => 'sub:save',
  subscribeCancel: () => 'sub:cancel',
  deleteSubscription: (id: string) => `subs:del:${id}`,
  noop: () => 'noop',
} as const;

function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

function parsePage(raw: string): number | null {
  if (!/^\d{1,4}$/.test(raw)) return null;
  const page = Number(raw);
  return page >= 1 && page <= 1000 ? page : null;
}

/**
 * Разбирает callback_data из Telegram. Данные приходят от клиента, поэтому
 * проверяем и формат, и допустимые значения справочников.
 */
export function parseCallback(data: string): Callback | null {
  if (data.length === 0 || data.length > 64) return null;
  const parts = data.split(':');
  const [scope, action, ...rest] = parts;

  if (scope === 'menu' && action && rest.length === 0) {
    return MENU_TARGETS.has(action as MenuTarget)
      ? { type: 'menu', target: action as MenuTarget }
      : null;
  }

  if (scope === 'search' && action) {
    if (action === 'all' && rest.length === 0) return { type: 'search', action: 'reset' };
    if (action === 'page' && rest.length === 1) {
      const page = parsePage(rest[0] ?? '');
      return page ? { type: 'search', action: 'page', page } : null;
    }
    if (action === 'cat' && rest.length === 1) {
      const id = rest[0] ?? '';
      return isCategoryId(id) ? { type: 'search', action: 'category', id } : null;
    }
    if (action === 'city' && rest.length === 1) {
      const id = rest[0] ?? '';
      return isCityId(id) ? { type: 'search', action: 'city', id } : null;
    }
    return null;
  }

  if (scope === 'ev' && action && rest.length === 0) {
    return isUuid(action) ? { type: 'event', id: action.toLowerCase(), page: null } : null;
  }
  if (scope === 'ev' && action && rest.length === 1) {
    if (!isUuid(action)) return null;
    const page = parsePage(rest[0] ?? '');
    return page ? { type: 'event', id: action.toLowerCase(), page } : null;
  }

  if (scope === 'sub' && action) {
    if (action === 'add' && rest.length === 0) return { type: 'subscribe', action: 'add' };
    if (action === 'summary' && rest.length === 0) return { type: 'subscribe', action: 'summary' };
    if (action === 'pick' && rest.length === 1) {
      const field = rest[0] ?? '';
      return field === 'city' || field === 'category' || field === 'period'
        ? { type: 'subscribe', action: 'pick', field }
        : null;
    }
    if (action === 'quick' && rest.length === 2) {
      const city = rest[0] ?? '';
      const category = rest[1] ?? '';
      return isCityId(city) && isCategoryId(category)
        ? { type: 'subscribe', action: 'quick', city, category }
        : null;
    }
    if (action === 'save' && rest.length === 0) return { type: 'subscribe', action: 'save' };
    if (action === 'cancel' && rest.length === 0) return { type: 'subscribe', action: 'cancel' };
    if (action === 'event' && rest.length === 1) {
      const id = rest[0] ?? '';
      return isUuid(id) ? { type: 'subscribe', action: 'event', id: id.toLowerCase() } : null;
    }
    if (action === 'city' && rest.length === 1) {
      const raw = rest[0] ?? '';
      if (raw === 'any') return { type: 'subscribe', action: 'city', id: null };
      return isCityId(raw) ? { type: 'subscribe', action: 'city', id: raw } : null;
    }
    if (action === 'cat' && rest.length === 1) {
      const raw = rest[0] ?? '';
      if (raw === 'any') return { type: 'subscribe', action: 'category', id: null };
      return isCategoryId(raw) ? { type: 'subscribe', action: 'category', id: raw } : null;
    }
    if (action === 'period' && rest.length === 1) {
      const raw = rest[0] ?? '';
      if (raw === 'any') return { type: 'subscribe', action: 'period', id: null };
      return isDatePreset(raw) ? { type: 'subscribe', action: 'period', id: raw } : null;
    }
    return null;
  }

  if (scope === 'subs' && action === 'del' && rest.length === 1) {
    const id = rest[0] ?? '';
    return isUuid(id) ? { type: 'subscriptions', action: 'delete', id: id.toLowerCase() } : null;
  }

  if (scope === 'noop' && !action) return { type: 'noop' };

  return null;
}
