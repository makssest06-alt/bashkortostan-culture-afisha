import { InlineKeyboard } from 'grammy';

import type { Event, EventListItem, Subscription } from './api/types.js';
import {
  CATEGORIES,
  CITIES,
  DATE_PRESETS,
  categoryName,
  cityName,
  datePresetLabel,
  type CategoryId,
  type CityId,
  type DatePreset,
} from './dictionaries.js';
import { CB } from './callbacks.js';
import { eventSourceUrl, truncate } from './format.js';
import type { SearchState, SubscriptionDraft } from './session.js';

function buttonLabel(value: string, max = 55): string {
  return truncate(value, max);
}

export function mainMenuKeyboard(options: { publicWebUrl?: string | null } = {}): InlineKeyboard {
  const keyboard = new InlineKeyboard()
    .text('🔍 Найти событие', CB.menu('search'))
    .text('🗓 Ближайшие', CB.menu('soon'))
    .row()
    .text('🎭 Категории', CB.menu('categories'))
    .text('📍 Города', CB.menu('cities'))
    .row()
    .text('🔔 Мои подписки', CB.menu('subs'))
    .text('❓ Помощь', CB.menu('help'));

  if (options.publicWebUrl) {
    keyboard.row().url('🌐 Открыть сайт', options.publicWebUrl);
  }
  return keyboard;
}

export function backToMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text('🏠 В меню', CB.menu('home'));
}

export function searchPromptKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text('❌ Отмена', CB.menu('home'));
}

export function categoriesKeyboard(): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  CATEGORIES.forEach((category, index) => {
    keyboard.text(category.name, CB.searchCategory(category.id));
    if (index % 2 === 1) keyboard.row();
  });
  if (CATEGORIES.length % 2 === 1) keyboard.row();
  keyboard.text('🏠 В меню', CB.menu('home'));
  return keyboard;
}

export function citiesKeyboard(): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  CITIES.forEach((city, index) => {
    keyboard.text(city.name, CB.searchCity(city.id));
    if (index % 2 === 1) keyboard.row();
  });
  if (CITIES.length % 2 === 1) keyboard.row();
  keyboard.text('🏠 В меню', CB.menu('home'));
  return keyboard;
}

export function searchResultsKeyboard(
  items: EventListItem[],
  page: number,
  totalPages: number,
  hasSearchContext = true,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  items.forEach((event, index) => {
    const prefix = index + 1;
    keyboard.text(buttonLabel(`${prefix}. ${event.title}`), CB.event(event.id, page)).row();
  });

  if (totalPages > 1) {
    if (page > 1) keyboard.text('⬅️ Назад', CB.searchPage(page - 1));
    if (page < totalPages) keyboard.text('Показать ещё ➡️', CB.searchPage(page + 1));
    keyboard.row();
  }

  keyboard.text('🎛 Фильтры', CB.menu('categories')).text('🏠 Меню', CB.menu('home'));
  if (hasSearchContext && page > 1) {
    keyboard.row().text('⬅️ В начало', CB.searchPage(1));
  }
  return keyboard;
}

export function noResultsKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('🎭 Категории', CB.menu('categories'))
    .text('📍 Города', CB.menu('cities'))
    .row()
    .text('🔄 Сбросить фильтры', CB.searchReset())
    .text('🏠 Меню', CB.menu('home'));
}

export function eventCardKeyboard(
  event: Event,
  options: { publicWebUrl?: string | null; backPage?: number | null } = {},
): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const sourceUrl = eventSourceUrl(event);
  if (sourceUrl) {
    keyboard.url('🔗 Подробнее / билеты', sourceUrl).row();
  }
  if (options.publicWebUrl) {
    keyboard.url('🌐 Открыть на сайте', `${options.publicWebUrl}/events/${event.id}`).row();
  }

  const city = cityName(event.city_id);
  const category = categoryName(event.category);
  const cityId = event.city_id as CityId;
  const categoryId = event.category as CategoryId;
  if (city && category && CITIES.some((item) => item.id === cityId) && CATEGORIES.some((item) => item.id === categoryId)) {
    keyboard
      .text(
        buttonLabel(`🔔 Подписаться: ${category} · ${city}`, 60),
        CB.subscribeQuick(cityId, categoryId),
      )
      .row();
  }

  if (options.backPage != null) {
    keyboard.text('← К результатам', CB.searchPage(options.backPage));
  }
  keyboard.text('🏠 Меню', CB.menu('home'));
  return keyboard;
}

export function subscriptionDraftKeyboard(draft: SubscriptionDraft): InlineKeyboard {
  const city = draft.city ? (cityName(draft.city) ?? draft.city) : 'Любой';
  const category = draft.category ? (categoryName(draft.category) ?? draft.category) : 'Любая';
  const period = draft.period ? (datePresetLabel(draft.period) ?? draft.period) : 'Любой';

  return new InlineKeyboard()
    .text(buttonLabel(`📍 Город: ${city}`, 60), CB.subscribePick('city'))
    .row()
    .text(buttonLabel(`🎭 Категория: ${category}`, 60), CB.subscribePick('category'))
    .row()
    .text(buttonLabel(`🗓 Период: ${period}`, 60), CB.subscribePick('period'))
    .row()
    .text('✅ Сохранить', CB.subscribeSave())
    .text('❌ Отмена', CB.subscribeCancel());
}

export function cityChoiceKeyboard(selected: CityId | null): InlineKeyboard {
  const keyboard = new InlineKeyboard().text(
    selected === null ? '✅ Любой город' : 'Любой город',
    CB.subscribeCity(null),
  );
  keyboard.row();
  CITIES.forEach((city, index) => {
    const label = selected === city.id ? `✅ ${city.name}` : city.name;
    keyboard.text(label, CB.subscribeCity(city.id));
    if (index % 2 === 1) keyboard.row();
  });
  if (CITIES.length % 2 === 1) keyboard.row();
  keyboard.text('← Назад', CB.subscribeSummary());
  return keyboard;
}

export function categoryChoiceKeyboard(selected: CategoryId | null): InlineKeyboard {
  const keyboard = new InlineKeyboard().text(
    selected === null ? '✅ Все категории' : 'Все категории',
    CB.subscribeCategory(null),
  );
  keyboard.row();
  CATEGORIES.forEach((category, index) => {
    const label = selected === category.id ? `✅ ${category.name}` : category.name;
    keyboard.text(label, CB.subscribeCategory(category.id));
    if (index % 2 === 1) keyboard.row();
  });
  if (CATEGORIES.length % 2 === 1) keyboard.row();
  keyboard.text('← Назад', CB.subscribeSummary());
  return keyboard;
}

export function periodChoiceKeyboard(selected: DatePreset | null): InlineKeyboard {
  const keyboard = new InlineKeyboard().text(
    selected === null ? '✅ Любой период' : 'Любой период',
    CB.subscribePeriod(null),
  );
  keyboard.row();
  DATE_PRESETS.forEach((preset) => {
    const label = selected === preset.id ? `✅ ${preset.label}` : preset.label;
    keyboard.text(label, CB.subscribePeriod(preset.id)).row();
  });
  keyboard.text('← Назад', CB.subscribeSummary());
  return keyboard;
}

export function subscriptionsKeyboard(subscriptions: Subscription[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  subscriptions.slice(0, 20).forEach((subscription) => {
    const city = subscription.city ? (cityName(subscription.city) ?? subscription.city) : 'любой город';
    const category = subscription.category
      ? (categoryName(subscription.category) ?? subscription.category)
      : 'все категории';
    const period = subscription.period
      ? ` · ${datePresetLabel(subscription.period) ?? subscription.period}`
      : '';
    keyboard
      .text(
        buttonLabel(`❌ ${category} · ${city}${period}`, 60),
        CB.deleteSubscription(subscription.id),
      )
      .row();
  });
  keyboard.text('➕ Новая подписка', CB.subscribeAdd()).text('🏠 Меню', CB.menu('home'));
  return keyboard;
}

export function subscriptionSavedKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('🔔 Мои подписки', CB.menu('subs'))
    .text('🏠 Меню', CB.menu('home'));
}

export function helpKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('🔍 Найти событие', CB.menu('search'))
    .text('🏠 В меню', CB.menu('home'));
}

export function staleKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text('🏠 В меню', CB.menu('home'));
}

export function filtersKeyboard(state: SearchState): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const city = state.city ? (cityName(state.city) ?? state.city) : 'Все города';
  const category = state.category ? (categoryName(state.category) ?? state.category) : 'Все категории';
  keyboard
    .text(buttonLabel(`📍 ${city}`, 60), CB.menu('cities'))
    .row()
    .text(buttonLabel(`🎭 ${category}`, 60), CB.menu('categories'))
    .row()
    .text('🔄 Сбросить фильтры', CB.searchReset())
    .text('🏠 Меню', CB.menu('home'));
  return keyboard;
}
