import { InlineKeyboard } from 'grammy';

import type { Event, EventListItem, Subscription } from './api/types.js';
import type { Callback, CallbackIssuer } from './callbacks.js';
import {
  CATEGORIES,
  CITIES,
  DATE_PRESETS,
  PRICE_MAX_OPTIONS,
  addIsoDays,
  categoryName,
  cityName,
  datePresetLabel,
  todayIsoDate,
  type CategoryId,
  type CityId,
  type DatePreset,
} from './dictionaries.js';
import {
  eventSiteUrl,
  eventSourcePageUrl,
  eventTicketsUrl,
  formatDateShort,
  formatRubles,
  isSoldOut,
  searchDateLabel,
  truncate,
} from './format.js';
import type { SearchState, SubscriptionDraft } from './session.js';

function buttonLabel(value: string, max = 60): string {
  return truncate(value, max);
}

function mark(selected: boolean, label: string): string {
  return selected ? `✅ ${label}` : label;
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

export function categoriesKeyboard(
  issue: CallbackIssuer,
  mode: 'search' | 'filter' = 'search',
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  if (mode === 'filter') {
    keyboard.text('Все категории', issue({ type: 'filter', action: 'setCategory', category: null })).row();
  }
  CATEGORIES.forEach((category, index) => {
    const callback: Callback =
      mode === 'filter'
        ? { type: 'filter', action: 'setCategory', category: category.id }
        : { type: 'search', action: 'category', id: category.id };
    keyboard.text(category.name, issue(callback));
    if (index % 2 === 1) keyboard.row();
  });
  if (CATEGORIES.length % 2 === 1) keyboard.row();
  keyboard.text(
    mode === 'filter' ? '← К фильтрам' : '🏠 В меню',
    issue(mode === 'filter' ? { type: 'filter', action: 'open' } : { type: 'menu', target: 'home' }),
  );
  return keyboard;
}

export function citiesKeyboard(
  issue: CallbackIssuer,
  mode: 'search' | 'filter' = 'search',
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  if (mode === 'filter') {
    keyboard.text('Все города', issue({ type: 'filter', action: 'setCity', city: null })).row();
  }
  CITIES.forEach((city, index) => {
    const callback: Callback =
      mode === 'filter'
        ? { type: 'filter', action: 'setCity', city: city.id }
        : { type: 'search', action: 'city', id: city.id };
    keyboard.text(city.name, issue(callback));
    if (index % 2 === 1) keyboard.row();
  });
  if (CITIES.length % 2 === 1) keyboard.row();
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

export function noResultsKeyboard(state: SearchState, issue: CallbackIssuer): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  if (state.freeOnly || state.priceMax !== null) {
    keyboard
      .text('💰 Снять цену', issue({ type: 'filter', action: 'clear', field: 'price' }))
      .row();
  }
  if (state.date) {
    keyboard.text('📅 Любая дата', issue({ type: 'filter', action: 'clear', field: 'date' })).row();
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
  options: { publicWebUrl?: string | null; backPage?: number | null } = {},
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const ticketsUrl = eventTicketsUrl(event);
  const sourceUrl = eventSourcePageUrl(event);
  const soldOut = isSoldOut(event);

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

  const city = cityName(event.city_id);
  const category = categoryName(event.category);
  const cityId = event.city_id as CityId;
  const categoryId = event.category as CategoryId;
  if (
    city &&
    category &&
    CITIES.some((item) => item.id === cityId) &&
    CATEGORIES.some((item) => item.id === categoryId)
  ) {
    keyboard
      .text(
        buttonLabel(`🔔 Подписаться: ${category} · ${city}`, 60),
        issue({ type: 'subscribe', action: 'quick', city: cityId, category: categoryId }),
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

export function filtersKeyboard(
  state: SearchState,
  issue: CallbackIssuer,
  now: Date = new Date(),
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const city = state.city ? (cityName(state.city) ?? state.city) : 'Все города';
  const category = state.category ? (categoryName(state.category) ?? state.category) : 'Все категории';

  keyboard
    .text(
      buttonLabel(`📅 ${searchDateLabel(state.date, now)}`, 60),
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

  keyboard
    .text('📅 Выбрать дату', issue({ type: 'filter', action: 'dateMenu' }))
    .row()
    .text(buttonLabel(`📍 ${city}`, 60), issue({ type: 'filter', action: 'cityMenu' }))
    .row()
    .text(
      buttonLabel(`🎭 ${category}`, 60),
      issue({ type: 'filter', action: 'categoryMenu' }),
    )
    .row();

  keyboard.text(
    mark(state.freeOnly, 'Бесплатно'),
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
): InlineKeyboard {
  const city = draft.city ? (cityName(draft.city) ?? draft.city) : 'Любой';
  const category = draft.category ? (categoryName(draft.category) ?? draft.category) : 'Любая';
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
): InlineKeyboard {
  const keyboard = new InlineKeyboard().text(
    mark(selected === null, 'Любой город'),
    issue({ type: 'subscribe', action: 'city', id: null }),
  );
  keyboard.row();
  CITIES.forEach((city, index) => {
    keyboard.text(
      mark(selected === city.id, city.name),
      issue({ type: 'subscribe', action: 'city', id: city.id }),
    );
    if (index % 2 === 1) keyboard.row();
  });
  if (CITIES.length % 2 === 1) keyboard.row();
  keyboard.text('← Назад', issue({ type: 'subscribe', action: 'summary' }));
  return keyboard;
}

export function categoryChoiceKeyboard(
  selected: CategoryId | null,
  issue: CallbackIssuer,
): InlineKeyboard {
  const keyboard = new InlineKeyboard().text(
    mark(selected === null, 'Все категории'),
    issue({ type: 'subscribe', action: 'category', id: null }),
  );
  keyboard.row();
  CATEGORIES.forEach((category, index) => {
    keyboard.text(
      mark(selected === category.id, category.name),
      issue({ type: 'subscribe', action: 'category', id: category.id }),
    );
    if (index % 2 === 1) keyboard.row();
  });
  if (CATEGORIES.length % 2 === 1) keyboard.row();
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
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  subscriptions.slice(0, 20).forEach((subscription) => {
    const city = subscription.city
      ? (cityName(subscription.city) ?? subscription.city)
      : 'любой город';
    const category = subscription.category
      ? (categoryName(subscription.category) ?? subscription.category)
      : 'все категории';
    const period = subscription.period
      ? ` · ${datePresetLabel(subscription.period) ?? subscription.period}`
      : '';
    keyboard
      .text(
        buttonLabel(`❌ ${category} · ${city}${period}`, 60),
        issue({ type: 'subscriptions', action: 'delete', id: subscription.id }),
      )
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
