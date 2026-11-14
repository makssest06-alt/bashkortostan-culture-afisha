import type { Relaxation } from './api/types.js';
import type { CategoryId, CityId } from './directory-service.js';
import type {
  DatePreset,
  LanguageCode,
  SearchDate,
  SearchSort,
} from './search-options.js';

export type MenuTarget =
  | 'home'
  | 'search'
  | 'categories'
  | 'cities'
  | 'soon'
  | 'subs'
  | 'help'
  | 'about';

export type ClearableField =
  | 'q'
  | 'city'
  | 'category'
  | 'date'
  | 'range'
  | 'price'
  | 'age'
  | 'language'
  | 'venue'
  | 'all';

/**
 * Действие кнопки. В callback_data попадает только случайный токен:
 * сам объект хранится в памяти бота и привязан к пользователю.
 */
export type Callback =
  | { type: 'menu'; target: MenuTarget; page?: number }
  | { type: 'search'; action: 'category'; id: CategoryId }
  | { type: 'search'; action: 'city'; id: CityId }
  | { type: 'search'; action: 'reset' }
  | { type: 'search'; action: 'page'; page: number }
  | { type: 'filter'; action: 'open' }
  | { type: 'filter'; action: 'results' }
  | { type: 'filter'; action: 'dateMenu' }
  | { type: 'filter'; action: 'rangeMenu' }
  | { type: 'filter'; action: 'rangeStart'; date: string }
  | { type: 'filter'; action: 'rangeEnd'; date: string }
  | { type: 'filter'; action: 'cityMenu'; page?: number }
  | { type: 'filter'; action: 'categoryMenu'; page?: number }
  | { type: 'filter'; action: 'ageMenu' }
  | { type: 'filter'; action: 'sortMenu' }
  | { type: 'filter'; action: 'languageMenu' }
  | { type: 'filter'; action: 'setDate'; date: SearchDate | null }
  | { type: 'filter'; action: 'setPrice'; priceMax: number | null; freeOnly: boolean }
  | { type: 'filter'; action: 'setCity'; city: CityId | null }
  | { type: 'filter'; action: 'setCategory'; category: CategoryId | null }
  | { type: 'filter'; action: 'setAge'; age: number | null }
  | { type: 'filter'; action: 'setSort'; sort: SearchSort }
  | { type: 'filter'; action: 'setLanguage'; language: LanguageCode | null }
  | { type: 'filter'; action: 'clear'; field: ClearableField }
  | { type: 'event'; id: string; page: number | null; occurrenceId?: string | null }
  | { type: 'sessions'; id: string; page?: number }
  | { type: 'offers'; id: string }
  | { type: 'calendar'; id: string; occurrenceId?: string | null }
  | { type: 'venue'; venueId: string; date?: string | null }
  | { type: 'relax'; relaxation: Relaxation }
  | { type: 'assistant'; action: 'chip'; unset: string[] }
  | { type: 'assistant'; action: 'reply'; answering: string; text: string }
  | { type: 'assistant'; action: 'relax'; relaxation: Relaxation }
  | { type: 'assistant'; action: 'fallback' }
  | { type: 'assistant'; action: 'confirm'; id: string; decision: 'approve' | 'reject' }
  | { type: 'similar'; id: string; page: number }
  | { type: 'subscribe'; action: 'event'; id: string }
  | { type: 'subscribe'; action: 'quick'; city: CityId; category: CategoryId }
  | { type: 'subscribe'; action: 'add' }
  | { type: 'subscribe'; action: 'pick'; field: 'city' | 'category' | 'period'; page?: number }
  | { type: 'subscribe'; action: 'summary' }
  | { type: 'subscribe'; action: 'city'; id: CityId | null }
  | { type: 'subscribe'; action: 'category'; id: CategoryId | null }
  | { type: 'subscribe'; action: 'period'; id: DatePreset | null }
  | { type: 'subscribe'; action: 'save' | 'cancel' }
  | { type: 'subscriptions'; action: 'delete'; id: string }
  | { type: 'subscriptions'; action: 'show'; id: string };

export type CallbackIssuer = (callback: Callback) => string;
