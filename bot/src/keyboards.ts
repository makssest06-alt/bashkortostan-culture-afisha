import { InlineKeyboard } from 'grammy';

import type {
  AssistantResponse,
  Event,
  EventListItem,
  Facets,
  Occurrence,
  Relaxation,
  Subscription,
} from './api/types.js';
import type { Callback, CallbackIssuer } from './callbacks.js';
import type { CategoryId, CityId, DirectoryCatalog } from './directory-service.js';
import {
  AGE_OPTIONS,
  DATE_PRESETS,
  LANGUAGE_OPTIONS,
  PRICE_MAX_OPTIONS,
  SORT_OPTIONS,
  addIsoDays,
  ageLabel,
  datePresetLabel,
  languageLabel,
  sortLabel,
  todayIsoDate,
  type DatePreset,
  type LanguageCode,
  type SearchSort,
} from './search-options.js';
import {
  eventDeepLink,
  eventMapUrl,
  eventShareUrl,
  eventSiteUrl,
  eventSourcePageUrl,
  eventTicketsUrl,
  formatDateRange,
  formatDateShort,
  formatRelaxationLabel,
  formatRubles,
  isSoldOut,
  occurrenceStatusLine,
  searchDateLabel,
  sortOccurrences,
  truncate,
} from './format.js';
import type { SearchState, SubscriptionDraft } from './session.js';

function buttonLabel(value: string, max = 60): string {
  return truncate(value, max);
}

function mark(selected: boolean, label: string): string {
  return selected ? `✅ ${label}` : label;
}

/**
 * Справочники приходят из API и могут быть длиннее, чем удобно для одного
 * сообщения. Держим страницу небольшой, чтобы не упереться в лимит кнопок
 * Telegram и не превращать экран в полотно.
 */
const DIRECTORY_PAGE_SIZE = 24;

interface PageSlice<T> {
  items: T[];
  page: number;
  totalPages: number;
}

function pageSlice<T>(items: readonly T[], page: number): PageSlice<T> {
  const totalPages = Math.max(1, Math.ceil(items.length / DIRECTORY_PAGE_SIZE));
  const current = Math.min(Math.max(1, page), totalPages);
  return {
    items: items.slice((current - 1) * DIRECTORY_PAGE_SIZE, current * DIRECTORY_PAGE_SIZE),
    page: current,
    totalPages,
  };
}

function addPageRow<T>(
  keyboard: InlineKeyboard,
  slice: PageSlice<T>,
  issue: CallbackIssuer,
  callbackFor: (page: number) => Callback,
): void {
  if (slice.totalPages <= 1) return;
  if (slice.page > 1) keyboard.text('⬅️ Назад', issue(callbackFor(slice.page - 1)));
  if (slice.page < slice.totalPages) keyboard.text('Ещё ➡️', issue(callbackFor(slice.page + 1)));
  keyboard.row();
}

export function mainMenuKeyboard(
  issue: CallbackIssuer,
  options: { publicWebUrl?: string | null } = {},
): InlineKeyboard {
  const keyboard = new InlineKeyboard()
    .text('🔍 Найти событие', issue({ type: 'menu', target: 'search' }))
    .text('🗓 Ближайшие', issue({ type: 'menu', target: 'soon' }))
    .row()
    .text('🎭 Категории', issue({ type: 'menu', target: 'categories' }))
    .text('📍 Города', issue({ type: 'menu', target: 'cities' }))
    .row()
    .text('🎛 Фильтры', issue({ type: 'filter', action: 'open' }))
    .text('🔔 Мои подписки', issue({ type: 'menu', target: 'subs' }))
    .row()
    .text('❓ Помощь', issue({ type: 'menu', target: 'help' }))
    .text('ℹ️ О сервисе', issue({ type: 'menu', target: 'about' }));

  if (options.publicWebUrl) {
    keyboard.row().url('🌐 Открыть сайт', options.publicWebUrl);
  }
  return keyboard;
}

export function backToMenuKeyboard(issue: CallbackIssuer): InlineKeyboard {
  return new InlineKeyboard().text('🏠 В меню', issue({ type: 'menu', target: 'home' }));
}

export function searchPromptKeyboard(issue: CallbackIssuer): InlineKeyboard {
  return new InlineKeyboard()
    .text('🎛 Фильтры', issue({ type: 'filter', action: 'open' }))
    .text('❌ Отмена', issue({ type: 'menu', target: 'home' }));
}

function facetLabel(name: string, count: number | undefined): string {
  return count === undefined ? name : `${name} · ${count}`;
}

function cityFacetCount(facets: Facets | null | undefined, id: string): number | undefined {
  return facets?.cities.find((entry) => entry.id === id)?.count;
}

function categoryFacetCount(facets: Facets | null | undefined, id: string): number | undefined {
  return facets?.categories.find((entry) => entry.id === id)?.count;
}

export function categoriesKeyboard(
  issue: CallbackIssuer,
  directories: DirectoryCatalog,
  mode: 'search' | 'filter' = 'search',
  page = 1,
  facets: Facets | null = null,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  if (mode === 'filter') {
    keyboard.text('Все категории', issue({ type: 'filter', action: 'setCategory', category: null })).row();
  }
  const slice = pageSlice(directories.categories, page);
  slice.items.forEach((category, index) => {
    const callback: Callback =
      mode === 'filter'
        ? { type: 'filter', action: 'setCategory', category: category.id }
        : { type: 'search', action: 'category', id: category.id };
    const count = mode === 'filter' ? categoryFacetCount(facets, category.id) : undefined;
    keyboard.text(facetLabel(category.name, count), issue(callback));
    if (index % 2 === 1) keyboard.row();
  });
  if (slice.items.length % 2 === 1) keyboard.row();
  addPageRow(keyboard, slice, issue, (next) =>
    mode === 'filter'
      ? { type: 'filter', action: 'categoryMenu', page: next }
      : { type: 'menu', target: 'categories', page: next },
  );
  keyboard.text(
    mode === 'filter' ? '← К фильтрам' : '🏠 В меню',
    issue(mode === 'filter' ? { type: 'filter', action: 'open' } : { type: 'menu', target: 'home' }),
  );
  return keyboard;
}

export function citiesKeyboard(
  issue: CallbackIssuer,
  directories: DirectoryCatalog,
  mode: 'search' | 'filter' = 'search',
  page = 1,
  facets: Facets | null = null,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  if (mode === 'filter') {
    keyboard.text('Все города', issue({ type: 'filter', action: 'setCity', city: null })).row();
  }
  const slice = pageSlice(directories.cities, page);
  slice.items.forEach((city, index) => {
    const callback: Callback =
      mode === 'filter'
        ? { type: 'filter', action: 'setCity', city: city.id }
        : { type: 'search', action: 'city', id: city.id };
    const count = mode === 'filter' ? cityFacetCount(facets, city.id) : undefined;
    keyboard.text(facetLabel(city.name, count), issue(callback));
    if (index % 2 === 1) keyboard.row();
  });
  if (slice.items.length % 2 === 1) keyboard.row();
  addPageRow(keyboard, slice, issue, (next) =>
    mode === 'filter'
      ? { type: 'filter', action: 'cityMenu', page: next }
      : { type: 'menu', target: 'cities', page: next },
  );
  keyboard.text(
    mode === 'filter' ? '← К фильтрам' : '🏠 В меню',
    issue(mode === 'filter' ? { type: 'filter', action: 'open' } : { type: 'menu', target: 'home' }),
  );
  return keyboard;
}

export function searchResultsKeyboard(
  items: EventListItem[],
  page: number,
  totalPages: number,
  issue: CallbackIssuer,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  items.forEach((event, index) => {
    const prefix = index + 1;
    keyboard
      .text(
        buttonLabel(`${prefix}. ${event.title}`),
        issue({ type: 'event', id: event.id, page }),
      )
      .row();
  });

  if (totalPages > 1) {
    if (page > 1) keyboard.text('⬅️ Назад', issue({ type: 'search', action: 'page', page: page - 1 }));
    if (page < totalPages) {
      keyboard.text('Показать ещё ➡️', issue({ type: 'search', action: 'page', page: page + 1 }));
    }
    keyboard.row();
  }

  keyboard
    .text('🎛 Фильтры', issue({ type: 'filter', action: 'open' }))
    .text('🏠 Меню', issue({ type: 'menu', target: 'home' }));
  if (page > 1) {
    keyboard.row().text('⬅️ В начало', issue({ type: 'search', action: 'page', page: 1 }));
  }
  return keyboard;
}

export function noResultsKeyboard(
  state: SearchState,
  issue: CallbackIssuer,
  relaxations: readonly Relaxation[] = state.relaxations,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  if (relaxations.length > 0) {
    relaxations.slice(0, 5).forEach((relaxation) => {
      keyboard
        .text(
          buttonLabel(`${formatRelaxationLabel(relaxation)} · ${relaxation.count}`, 60),
          issue({ type: 'relax', relaxation }),
        )
        .row();
    });
  }
  if (state.freeOnly || state.priceMax !== null) {
    keyboard
      .text('💰 Снять цену', issue({ type: 'filter', action: 'clear', field: 'price' }))
      .row();
  }
  if (state.date || state.dateFrom || state.dateTo) {
    keyboard.text('📅 Любая дата', issue({ type: 'filter', action: 'clear', field: 'date' })).row();
  }
  if (state.age !== null) {
    keyboard.text('👶 Любой возраст', issue({ type: 'filter', action: 'clear', field: 'age' })).row();
  }
  if (state.language) {
    keyboard.text('🌐 Любой язык', issue({ type: 'filter', action: 'clear', field: 'language' })).row();
  }
  if (state.category) {
    keyboard
      .text('🎭 Все категории', issue({ type: 'filter', action: 'clear', field: 'category' }))
      .row();
  }
  if (state.city) {
    keyboard.text('📍 Все города', issue({ type: 'filter', action: 'clear', field: 'city' })).row();
  }
  if (state.q) {
    keyboard.text('🔤 Сбросить запрос', issue({ type: 'filter', action: 'clear', field: 'q' })).row();
  }

  keyboard
    .text('🎛 Все фильтры', issue({ type: 'filter', action: 'open' }))
    .text('🔄 Заново', issue({ type: 'search', action: 'reset' }))
    .row()
    .text('🏠 Меню', issue({ type: 'menu', target: 'home' }));
  return keyboard;
}

export function eventCardKeyboard(
  event: Event,
  issue: CallbackIssuer,
  directories: DirectoryCatalog,
  options: {
    publicWebUrl?: string | null;
    backPage?: number | null;
    botUsername?: string | null;
    occurrenceId?: string | null;
  } = {},
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const ticketsUrl = eventTicketsUrl(event);
  const sourceUrl = eventSourcePageUrl(event);
  const soldOut = isSoldOut(event, options.occurrenceId);

  if (ticketsUrl && sourceUrl && ticketsUrl === sourceUrl) {
    keyboard.url('🎟 Источник и билеты', ticketsUrl).row();
  } else {
    if (ticketsUrl) {
      keyboard.url(soldOut ? '🎟 Билеты (проданы)' : '🎟 Билеты', ticketsUrl).row();
    }
    if (sourceUrl) keyboard.url('🌐 Источник', sourceUrl).row();
  }

  const siteUrl = eventSiteUrl(options.publicWebUrl, event.id);
  if (siteUrl) keyboard.url('🌐 На сайте', siteUrl).row();

  if (event.occurrences.length > 1) {
    keyboard
      .text(
        buttonLabel(`📅 Все сеансы (${event.occurrences.length})`, 60),
        issue({ type: 'sessions', id: event.id }),
      )
      .row();
  }
  if (event.offers.length > 0) {
    keyboard
      .text('🎟 Тарифы', issue({ type: 'offers', id: event.id }))
      .row();
  }

  const occurrence = options.occurrenceId
    ? event.occurrences.find((item) => item.id === options.occurrenceId)
    : undefined;
  const canAddCalendar =
    Boolean(occurrence) ||
    event.occurrences.length > 0 ||
    Boolean(event.date_start);
  if (canAddCalendar) {
    keyboard
      .text(
        '📅 В календарь',
        issue({ type: 'calendar', id: event.id, occurrenceId: options.occurrenceId ?? null }),
      )
      .row();
  }

  const mapUrl = eventMapUrl(event);
  if (mapUrl) keyboard.url('🗺 На карте', mapUrl).row();

  if (event.venue_id) {
    keyboard
      .text(
        '🏛 Афиша площадки',
        issue({
          type: 'venue',
          venueId: event.venue_id,
          date: event.date_start?.slice(0, 10) ?? null,
        }),
      )
      .row();
  }

  const shareTarget = siteUrl ?? eventDeepLink(options.botUsername, event.id);
  const shareUrl = eventShareUrl(shareTarget, event.title);
  if (shareUrl) keyboard.url('📤 Поделиться', shareUrl).row();

  keyboard
    .text('🎯 Похожие', issue({ type: 'similar', id: event.id, page: 1 }))
    .row();

  const city = directories.cityName(event.city_id);
  const category = directories.categoryName(event.category);
  if (
    city &&
    category &&
    directories.isCityId(event.city_id) &&
    directories.isCategoryId(event.category)
  ) {
    keyboard
      .text(
        buttonLabel(`🔔 Подписаться: ${category} · ${city}`, 60),
        issue({
          type: 'subscribe',
          action: 'quick',
          city: event.city_id,
          category: event.category,
        }),
      )
      .row();
  }

  if (options.backPage != null) {
    keyboard.text(
      '← К результатам',
      issue({ type: 'search', action: 'page', page: options.backPage }),
    );
  }
  keyboard.text('🏠 Меню', issue({ type: 'menu', target: 'home' }));
  return keyboard;
}

/** Кнопки выбора сеанса. Каждый сеанс открывает карточку с этим сеансом. */
export function sessionsKeyboard(
  event: Event,
  issue: CallbackIssuer,
  now: Date = new Date(),
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  sortOccurrences(event.occurrences).forEach((occurrence) => {
    const status = occurrenceStatusLine(occurrence);
    const label = `${formatDateShort(occurrence.date_start.slice(0, 10), now)}${
      occurrence.time_precision === 'date'
        ? ''
        : `, ${occurrence.date_start.slice(11, 16)}`
    }${status ? ` · ${status}` : ''}`;
    keyboard
      .text(
        buttonLabel(label, 60),
        issue({ type: 'event', id: event.id, page: null, occurrenceId: occurrence.id }),
      )
      .row();
  });
  keyboard
    .text('← К событию', issue({ type: 'event', id: event.id, page: null }))
    .text('🏠 Меню', issue({ type: 'menu', target: 'home' }));
  return keyboard;
}

export function offersKeyboard(event: Event, issue: CallbackIssuer): InlineKeyboard {
  return new InlineKeyboard()
    .text('← К событию', issue({ type: 'event', id: event.id, page: null }))
    .text('🏠 Меню', issue({ type: 'menu', target: 'home' }));
}

export function venueScheduleKeyboard(
  venueId: string,
  issue: CallbackIssuer,
): InlineKeyboard {
  return new InlineKeyboard()
    .text('← Назад', issue({ type: 'venue', venueId }))
    .text('🏠 Меню', issue({ type: 'menu', target: 'home' }));
}

export function similarResultsKeyboard(
  items: EventListItem[],
  sourceId: string,
  page: number,
  totalPages: number,
  issue: CallbackIssuer,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  items.forEach((event, index) => {
    keyboard
      .text(
        buttonLabel(`${index + 1}. ${event.title}`),
        issue({ type: 'event', id: event.id, page: null }),
      )
      .row();
  });

  if (totalPages > 1) {
    if (page > 1) {
      keyboard.text('⬅️ Назад', issue({ type: 'similar', id: sourceId, page: page - 1 }));
    }
    if (page < totalPages) {
      keyboard.text('Показать ещё ➡️', issue({ type: 'similar', id: sourceId, page: page + 1 }));
    }
    keyboard.row();
  }

  keyboard
    .text('← К событию', issue({ type: 'event', id: sourceId, page: null }))
    .text('🏠 Меню', issue({ type: 'menu', target: 'home' }));
  return keyboard;
}

export function filtersKeyboard(
  state: SearchState,
  issue: CallbackIssuer,
  directories: DirectoryCatalog,
  now: Date = new Date(),
  facets: Facets | null = state.facets,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const city = state.city ? (directories.cityName(state.city) ?? state.city) : 'Все города';
  const category = state.category
    ? (directories.categoryName(state.category) ?? state.category)
    : 'Все категории';

  const dateLabel = state.dateFrom && state.dateTo
    ? formatDateRange(state.dateFrom, state.dateTo, now)
    : searchDateLabel(state.date, now);
  keyboard
    .text(
      buttonLabel(`📅 ${dateLabel}`, 60),
      issue({ type: 'filter', action: 'dateMenu' }),
    )
    .row();

  const presets: DatePreset[] = ['today', 'tomorrow', 'weekend', 'week'];
  presets.forEach((preset, index) => {
    keyboard.text(
      mark(state.date === preset, datePresetLabel(preset) ?? preset),
      issue({ type: 'filter', action: 'setDate', date: preset }),
    );
    if (index % 2 === 1) keyboard.row();
  });

  const rangeLabel =
    state.dateFrom && state.dateTo
      ? formatDateRange(state.dateFrom, state.dateTo, now)
      : 'Выбрать период';
  const cityCount = state.city ? cityFacetCount(facets, state.city) : facets?.total;
  const categoryCount = state.category
    ? categoryFacetCount(facets, state.category)
    : facets?.total;

  keyboard
    .text(buttonLabel(`📆 ${rangeLabel}`, 60), issue({ type: 'filter', action: 'rangeMenu' }))
    .row()
    .text(buttonLabel(`📍 ${facetLabel(city, cityCount)}`, 60), issue({ type: 'filter', action: 'cityMenu' }))
    .text(
      buttonLabel(`🎭 ${facetLabel(category, categoryCount)}`, 60),
      issue({ type: 'filter', action: 'categoryMenu' }),
    )
    .row()
    .text(
      buttonLabel(`👶 Возраст: ${ageLabel(state.age)}`, 60),
      issue({ type: 'filter', action: 'ageMenu' }),
    )
    .row()
    .text(
      buttonLabel(`🌐 Язык: ${languageLabel(state.language)}`, 60),
      issue({ type: 'filter', action: 'languageMenu' }),
    )
    .row()
    .text(
      buttonLabel(`🔀 ${sortLabel(state.sort)}`, 60),
      issue({ type: 'filter', action: 'sortMenu' }),
    )
    .row();

  keyboard.text(
    mark(state.freeOnly, facetLabel('Бесплатно', facets?.price.free)),
    issue({ type: 'filter', action: 'setPrice', priceMax: null, freeOnly: true }),
  );
  PRICE_MAX_OPTIONS.forEach((amount, index) => {
    keyboard.text(
      mark(state.priceMax === amount, `до ${formatRubles(amount)}`),
      issue({ type: 'filter', action: 'setPrice', priceMax: amount, freeOnly: false }),
    );
    if (index % 2 === 1) keyboard.row();
  });
  if (PRICE_MAX_OPTIONS.length % 2 === 1) keyboard.row();

  keyboard
    .text(
      '🔄 Сбросить',
      issue({ type: 'filter', action: 'clear', field: 'all' }),
    )
    .text('← К результатам', issue({ type: 'filter', action: 'results' }))
    .row()
    .text('🏠 Меню', issue({ type: 'menu', target: 'home' }));
  return keyboard;
}

export function ageKeyboard(
  selected: number | null,
  issue: CallbackIssuer,
  facets: Facets | null = null,
): InlineKeyboard {
  const keyboard = new InlineKeyboard().text(
    mark(selected === null, 'Любой возраст'),
    issue({ type: 'filter', action: 'setAge', age: null }),
  );
  keyboard.row();
  AGE_OPTIONS.forEach((age, index) => {
    const count = facets
      ? facets.age_limits
          .filter((entry) => entry.value !== null && entry.value <= age)
          .reduce((sum, entry) => sum + entry.count, 0)
      : undefined;
    keyboard.text(
      mark(selected === age, `${ageLabel(age)}${count === undefined ? '' : ` · ${count}`}`),
      issue({ type: 'filter', action: 'setAge', age }),
    );
    if (index % 2 === 1) keyboard.row();
  });
  if (AGE_OPTIONS.length % 2 === 1) keyboard.row();
  keyboard
    .text('← К фильтрам', issue({ type: 'filter', action: 'open' }))
    .text('🏠 Меню', issue({ type: 'menu', target: 'home' }));
  return keyboard;
}

export function sortKeyboard(
  selected: SearchSort,
  issue: CallbackIssuer,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  SORT_OPTIONS.forEach((option) => {
    keyboard
      .text(
        mark(selected === option.id, option.label),
        issue({ type: 'filter', action: 'setSort', sort: option.id }),
      )
      .row();
  });
  keyboard
    .text('← К фильтрам', issue({ type: 'filter', action: 'open' }))
    .text('🏠 Меню', issue({ type: 'menu', target: 'home' }));
  return keyboard;
}

export function languageKeyboard(
  selected: string | null,
  issue: CallbackIssuer,
): InlineKeyboard {
  const keyboard = new InlineKeyboard().text(
    mark(selected === null, 'Любой язык'),
    issue({ type: 'filter', action: 'setLanguage', language: null }),
  );
  keyboard.row();
  LANGUAGE_OPTIONS.forEach((option) => {
    keyboard
      .text(
        mark(selected === option.id, option.label),
        issue({ type: 'filter', action: 'setLanguage', language: option.id }),
      )
      .row();
  });
  keyboard
    .text('← К фильтрам', issue({ type: 'filter', action: 'open' }))
    .text('🏠 Меню', issue({ type: 'menu', target: 'home' }));
  return keyboard;
}

/** Первый шаг периода: выбираем начало из ближайших 14 дней. */
export function rangeStartKeyboard(
  selected: string | null,
  issue: CallbackIssuer,
  now: Date = new Date(),
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  if (selected) {
    keyboard
      .text('❌ Сбросить период', issue({ type: 'filter', action: 'clear', field: 'range' }))
      .row();
  }
  const today = todayIsoDate(now);
  for (let offset = 0; offset < 14; offset += 1) {
    const date = addIsoDays(today, offset);
    keyboard.text(
      mark(selected === date, formatDateShort(date, now)),
      issue({ type: 'filter', action: 'rangeStart', date }),
    );
    if (offset % 2 === 1) keyboard.row();
  }
  keyboard
    .text('← К фильтрам', issue({ type: 'filter', action: 'open' }))
    .text('🏠 Меню', issue({ type: 'menu', target: 'home' }));
  return keyboard;
}

/** Второй шаг периода: конец не раньше начала и не дальше 31 дня. */
export function rangeEndKeyboard(
  start: string,
  issue: CallbackIssuer,
  now: Date = new Date(),
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (let offset = 0; offset < 31; offset += 1) {
    const date = addIsoDays(start, offset);
    keyboard.text(
      mark(false, formatDateShort(date, now)),
      issue({ type: 'filter', action: 'rangeEnd', date }),
    );
    if (offset % 2 === 1) keyboard.row();
  }
  keyboard
    .text('← К фильтрам', issue({ type: 'filter', action: 'open' }))
    .text('🏠 Меню', issue({ type: 'menu', target: 'home' }));
  return keyboard;
}

export function datePickerKeyboard(
  selected: string | null,
  issue: CallbackIssuer,
  now: Date = new Date(),
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  keyboard
    .text(mark(selected === null, 'Любая дата'), issue({ type: 'filter', action: 'setDate', date: null }))
    .row();

  const today = todayIsoDate(now);
  for (let offset = 0; offset < 10; offset += 1) {
    const date = addIsoDays(today, offset);
    const label = formatDateShort(date, now);
    keyboard.text(mark(selected === date, label), issue({ type: 'filter', action: 'setDate', date }));
    if (offset % 2 === 1) keyboard.row();
  }
  keyboard
    .text('← К фильтрам', issue({ type: 'filter', action: 'open' }))
    .text('🏠 Меню', issue({ type: 'menu', target: 'home' }));
  return keyboard;
}

export function subscriptionDraftKeyboard(
  draft: SubscriptionDraft,
  issue: CallbackIssuer,
  directories: DirectoryCatalog,
): InlineKeyboard {
  const city = draft.city ? (directories.cityName(draft.city) ?? draft.city) : 'Любой';
  const category = draft.category
    ? (directories.categoryName(draft.category) ?? draft.category)
    : 'Любая';
  const period = draft.period ? (datePresetLabel(draft.period) ?? draft.period) : 'Любой';

  return new InlineKeyboard()
    .text(
      buttonLabel(`📍 Город: ${city}`, 60),
      issue({ type: 'subscribe', action: 'pick', field: 'city' }),
    )
    .row()
    .text(
      buttonLabel(`🎭 Категория: ${category}`, 60),
      issue({ type: 'subscribe', action: 'pick', field: 'category' }),
    )
    .row()
    .text(
      buttonLabel(`🗓 Период: ${period}`, 60),
      issue({ type: 'subscribe', action: 'pick', field: 'period' }),
    )
    .row()
    .text('✅ Сохранить', issue({ type: 'subscribe', action: 'save' }))
    .text('❌ Отмена', issue({ type: 'subscribe', action: 'cancel' }));
}

export function cityChoiceKeyboard(
  selected: CityId | null,
  issue: CallbackIssuer,
  directories: DirectoryCatalog,
  page = 1,
): InlineKeyboard {
  const keyboard = new InlineKeyboard().text(
    mark(selected === null, 'Любой город'),
    issue({ type: 'subscribe', action: 'city', id: null }),
  );
  keyboard.row();
  const slice = pageSlice(directories.cities, page);
  slice.items.forEach((city, index) => {
    keyboard.text(
      mark(selected === city.id, city.name),
      issue({ type: 'subscribe', action: 'city', id: city.id }),
    );
    if (index % 2 === 1) keyboard.row();
  });
  if (slice.items.length % 2 === 1) keyboard.row();
  addPageRow(keyboard, slice, issue, (next) => ({
    type: 'subscribe',
    action: 'pick',
    field: 'city',
    page: next,
  }));
  keyboard.text('← Назад', issue({ type: 'subscribe', action: 'summary' }));
  return keyboard;
}

export function categoryChoiceKeyboard(
  selected: CategoryId | null,
  issue: CallbackIssuer,
  directories: DirectoryCatalog,
  page = 1,
): InlineKeyboard {
  const keyboard = new InlineKeyboard().text(
    mark(selected === null, 'Все категории'),
    issue({ type: 'subscribe', action: 'category', id: null }),
  );
  keyboard.row();
  const slice = pageSlice(directories.categories, page);
  slice.items.forEach((category, index) => {
    keyboard.text(
      mark(selected === category.id, category.name),
      issue({ type: 'subscribe', action: 'category', id: category.id }),
    );
    if (index % 2 === 1) keyboard.row();
  });
  if (slice.items.length % 2 === 1) keyboard.row();
  addPageRow(keyboard, slice, issue, (next) => ({
    type: 'subscribe',
    action: 'pick',
    field: 'category',
    page: next,
  }));
  keyboard.text('← Назад', issue({ type: 'subscribe', action: 'summary' }));
  return keyboard;
}

export function periodChoiceKeyboard(
  selected: DatePreset | null,
  issue: CallbackIssuer,
): InlineKeyboard {
  const keyboard = new InlineKeyboard().text(
    mark(selected === null, 'Любой период'),
    issue({ type: 'subscribe', action: 'period', id: null }),
  );
  keyboard.row();
  DATE_PRESETS.forEach((preset) => {
    keyboard
      .text(
        mark(selected === preset.id, preset.label),
        issue({ type: 'subscribe', action: 'period', id: preset.id }),
      )
      .row();
  });
  keyboard.text('← Назад', issue({ type: 'subscribe', action: 'summary' }));
  return keyboard;
}

export function subscriptionsKeyboard(
  subscriptions: Subscription[],
  issue: CallbackIssuer,
  directories: DirectoryCatalog,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  subscriptions.slice(0, 20).forEach((subscription) => {
    const city = subscription.city
      ? (directories.cityName(subscription.city) ?? subscription.city)
      : 'любой город';
    const category = subscription.category
      ? (directories.categoryName(subscription.category) ?? subscription.category)
      : 'все категории';
    const period = subscription.period
      ? ` · ${datePresetLabel(subscription.period) ?? subscription.period}`
      : '';
    keyboard
      .text(
        buttonLabel(`▶️ ${category} · ${city}${period}`, 60),
        issue({ type: 'subscriptions', action: 'show', id: subscription.id }),
      )
      .text('❌', issue({ type: 'subscriptions', action: 'delete', id: subscription.id }))
      .row();
  });
  keyboard
    .text('➕ Новая подписка', issue({ type: 'subscribe', action: 'add' }))
    .text('🏠 Меню', issue({ type: 'menu', target: 'home' }));
  return keyboard;
}

export function subscriptionSavedKeyboard(issue: CallbackIssuer): InlineKeyboard {
  return new InlineKeyboard()
    .text('🔔 Мои подписки', issue({ type: 'menu', target: 'subs' }))
    .text('🏠 Меню', issue({ type: 'menu', target: 'home' }));
}

export function helpKeyboard(issue: CallbackIssuer): InlineKeyboard {
  return new InlineKeyboard()
    .text('🔍 Найти событие', issue({ type: 'menu', target: 'search' }))
    .text('🏠 В меню', issue({ type: 'menu', target: 'home' }));
}

export function aboutKeyboard(
  issue: CallbackIssuer,
  options: { publicWebUrl?: string | null } = {},
): InlineKeyboard {
  const keyboard = new InlineKeyboard().text('🔍 Найти событие', issue({ type: 'menu', target: 'search' }));
  if (options.publicWebUrl) keyboard.url('🌐 Сайт', options.publicWebUrl);
  keyboard.text('🏠 В меню', issue({ type: 'menu', target: 'home' }));
  return keyboard;
}

/**
 * Кнопки ответа ассистента. Подтверждения включаются только явным флагом:
 * до исправления P0-4 в бэкенде токен не привязан к пользователю.
 */
export function assistantKeyboard(
  response: AssistantResponse,
  issue: CallbackIssuer,
  options: { confirmationsEnabled?: boolean } = {},
): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  if (response.action === 'search') {
    response.results.slice(0, 8).forEach((item, index) => {
      keyboard
        .text(
          buttonLabel(`${index + 1}. ${item.event.title}`),
          issue({
            type: 'event',
            id: item.event.id,
            page: null,
            occurrenceId: item.occurrence_id ?? null,
          }),
        )
        .row();
    });
    response.relaxations.slice(0, 5).forEach((relaxation) => {
      keyboard
        .text(
          buttonLabel(`${formatRelaxationLabel(relaxation)} · ${relaxation.count}`, 60),
          issue({ type: 'assistant', action: 'relax', relaxation }),
        )
        .row();
    });
  }

  const clarify = response.clarify;
  if (response.action === 'clarify' && clarify) {
    clarify.quick_replies.slice(0, 8).forEach((reply) => {
      keyboard
        .text(
          buttonLabel(reply, 60),
          issue({ type: 'assistant', action: 'reply', answering: clarify.code, text: reply }),
        )
        .row();
    });
  }

  if (
    response.action === 'confirmation_required' &&
    response.confirmation &&
    options.confirmationsEnabled === true
  ) {
    keyboard
      .text(
        '✅ Подтвердить',
        issue({
          type: 'assistant',
          action: 'confirm',
          id: response.confirmation.confirmation_id,
          decision: 'approve',
        }),
      )
      .row()
      .text(
        '❌ Отменить',
        issue({
          type: 'assistant',
          action: 'confirm',
          id: response.confirmation.confirmation_id,
          decision: 'reject',
        }),
      )
      .row();
  }

  for (const chip of response.chips.slice(0, 6)) {
    if (chip.removable === false) continue;
    const unset = chip.unset.length > 0 ? chip.unset : [chip.key];
    if (unset.length === 0) continue;
    const label = chip.value ? `${chip.label}: ${chip.value}` : chip.label;
    keyboard
      .text(buttonLabel(`✖️ ${label}`, 60), issue({ type: 'assistant', action: 'chip', unset }))
      .row();
  }

  keyboard
    .text('🔎 Обычный поиск', issue({ type: 'assistant', action: 'fallback' }))
    .text('🏠 Меню', issue({ type: 'menu', target: 'home' }));
  return keyboard;
}
