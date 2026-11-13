import type { CategoryId, CityId, DatePreset, SearchDate } from './dictionaries.js';

export type MenuTarget =
  | 'home'
  | 'search'
  | 'categories'
  | 'cities'
  | 'soon'
  | 'subs'
  | 'help'
  | 'about';

export type ClearableField = 'q' | 'city' | 'category' | 'date' | 'price' | 'all';

/**
 * Действие кнопки. В callback_data попадает только случайный токен:
 * сам объект хранится в памяти бота и привязан к пользователю.
 */
export type Callback =
  | { type: 'menu'; target: MenuTarget }
  | { type: 'search'; action: 'category'; id: CategoryId }
  | { type: 'search'; action: 'city'; id: CityId }
  | { type: 'search'; action: 'reset' }
  | { type: 'search'; action: 'page'; page: number }
  | { type: 'filter'; action: 'open' }
  | { type: 'filter'; action: 'results' }
  | { type: 'filter'; action: 'dateMenu' }
  | { type: 'filter'; action: 'cityMenu' }
  | { type: 'filter'; action: 'categoryMenu' }
  | { type: 'filter'; action: 'setDate'; date: SearchDate | null }
  | { type: 'filter'; action: 'setPrice'; priceMax: number | null; freeOnly: boolean }
  | { type: 'filter'; action: 'setCity'; city: CityId | null }
  | { type: 'filter'; action: 'setCategory'; category: CategoryId | null }
  | { type: 'filter'; action: 'clear'; field: ClearableField }
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
  | { type: 'subscriptions'; action: 'delete'; id: string };

export type CallbackIssuer = (callback: Callback) => string;
