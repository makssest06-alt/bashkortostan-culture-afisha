import { Bot, type ApiClientOptions, type Context } from 'grammy';

import { ApiError, type ApiClient } from './api/client.js';
import { parseCallback, type Callback } from './callbacks.js';
import type { BotConfig } from './config.js';
import {
  categoryName,
  cityName,
  isCategoryId,
  isCityId,
  type CategoryId,
  type CityId,
} from './dictionaries.js';
import {
  formatEventCard,
  formatNoResults,
  formatSearchResults,
  formatSubscriptionCreated,
  formatSubscriptionDraft,
  formatSubscriptionsList,
  telegramSafeHttpUrl,
} from './format.js';
import {
  backToMenuKeyboard,
  categoriesKeyboard,
  categoryChoiceKeyboard,
  citiesKeyboard,
  cityChoiceKeyboard,
  eventCardKeyboard,
  filtersKeyboard,
  helpKeyboard,
  mainMenuKeyboard,
  noResultsKeyboard,
  periodChoiceKeyboard,
  searchPromptKeyboard,
  searchResultsKeyboard,
  subscriptionDraftKeyboard,
  subscriptionSavedKeyboard,
  subscriptionsKeyboard,
} from './keyboards.js';
import type { Logger } from './logger.js';
import {
  createSearchState,
  createSubscriptionDraft,
  type SearchState,
  type SessionStore,
  type SubscriptionDraft,
} from './session.js';
import {
  CANCEL_TEXT,
  CATEGORIES_TITLE,
  CITIES_TITLE,
  DRAFT_ACTIVE_TEXT,
  HELP_TEXT,
  MENU_TITLE,
  NON_TEXT_TEXT,
  NO_MORE_RESULTS_TEXT,
  SEARCH_EMPTY_QUERY,
  SEARCH_NEED_CONTEXT_TEXT,
  SEARCH_PROMPT,
  START_TEXT,
  SUBSCRIPTION_DELETED_TEXT,
  SUBSCRIPTION_NOT_FOUND_TEXT,
  UNEXPECTED_ERROR_TEXT,
  UNKNOWN_COMMAND_TEXT,
} from './texts.js';
import { telegramUserRef } from './user-ref.js';

const PAGE_SIZE = 5;
const MAX_QUERY_LENGTH = 200;

export interface BotDependencies {
  api: ApiClient;
  sessions: SessionStore;
  config: BotConfig;
  logger: Logger;
}

function userIdOf(ctx: Context): number {
  const id = ctx.from?.id;
  if (!id) throw new Error('В обновлении нет пользователя');
  return id;
}

export function splitMessage(text: string, maxLength = 3900): string[] {
  if (text.length <= maxLength) return [text];
  const chunks: string[] = [];
  let current = '';

  for (const line of text.split('\n')) {
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length <= maxLength) {
      current = candidate;
      continue;
    }
    if (current) {
      chunks.push(current);
      current = '';
    }
    if (line.length <= maxLength) {
      current = line;
    } else {
      for (let start = 0; start < line.length; start += maxLength) {
        chunks.push(line.slice(start, start + maxLength));
      }
    }
  }
  if (current) chunks.push(current);
  return chunks.length > 0 ? chunks : [''];
}

export function createBot(
  token: string,
  deps: BotDependencies,
  options: { client?: ApiClientOptions } = {},
): Bot {
  const { api, sessions, config, logger } = deps;
  const publicWebUrl = telegramSafeHttpUrl(config.publicWebUrl);
  const bot = options.client ? new Bot(token, { client: options.client }) : new Bot(token);

  async function sendLong(ctx: Context, text: string, keyboard?: ReturnType<typeof mainMenuKeyboard>): Promise<void> {
    const parts = splitMessage(text);
    for (let index = 0; index < parts.length; index += 1) {
      const isLast = index === parts.length - 1;
      const other: {
        link_preview_options: { is_disabled: boolean };
        reply_markup?: ReturnType<typeof mainMenuKeyboard>;
      } = { link_preview_options: { is_disabled: true } };
      if (isLast && keyboard) other.reply_markup = keyboard;
      await ctx.reply(parts[index] ?? '', other);
    }
    logger.info('message_sent', {
      user_id: ctx.from?.id,
      chars: text.length,
      parts: parts.length,
      has_keyboard: Boolean(keyboard),
    });
  }

  async function editOrSend(
    ctx: Context,
    text: string,
    keyboard: ReturnType<typeof mainMenuKeyboard>,
  ): Promise<void> {
    if (ctx.callbackQuery?.message) {
      try {
        await ctx.editMessageText(text, {
          reply_markup: keyboard,
          link_preview_options: { is_disabled: true },
        });
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/message is not modified/i.test(message)) {
          logger.debug('edit_message_failed', { error: message });
        } else {
          return;
        }
      }
    }
    await sendLong(ctx, text, keyboard);
  }

  async function safely(ctx: Context, action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error) {
      if (error instanceof ApiError) {
        logger.warn('api_failure', {
          kind: error.kind,
          status: error.status,
          code: error.code,
          error: error.message,
        });
        await sendLong(ctx, error.userMessage, backToMenuKeyboard());
        return;
      }
      logger.error('handler_failure', { error });
      await sendLong(ctx, UNEXPECTED_ERROR_TEXT, backToMenuKeyboard());
    }
  }

  function userRefFor(ctx: Context): string {
    return telegramUserRef(userIdOf(ctx));
  }

  async function sendHome(ctx: Context): Promise<void> {
    await sendLong(ctx, MENU_TITLE, mainMenuKeyboard({ publicWebUrl: publicWebUrl }));
  }

  async function loadAndSendPage(ctx: Context, state: SearchState): Promise<void> {
    const userId = userIdOf(ctx);
    const response = await api.searchEvents({
      q: state.q,
      city: state.city,
      category: state.category,
      date: state.date,
      page: state.page,
      page_size: PAGE_SIZE,
      sort: 'date',
    });

    const stored: SearchState = {
      ...state,
      page: response.page,
      totalPages: response.total_pages,
    };
    sessions.update(userId, (session) => {
      session.search = stored;
      session.awaitingQuery = false;
      session.draft = null;
    });

    if (response.items.length === 0) {
      if (state.page > 1) {
        await sendLong(ctx, NO_MORE_RESULTS_TEXT, filtersKeyboard(stored));
        return;
      }
      await sendLong(ctx, formatNoResults(stored), noResultsKeyboard());
      return;
    }

    const text = formatSearchResults(response, stored, {
      queryWasTruncated: state.queryTruncated,
    });
    logger.info('search_done', {
      user_id: userId,
      city: state.city,
      category: state.category,
      date: state.date,
      q_length: state.q?.length ?? 0,
      page: response.page,
      total: response.total,
    });
    await sendLong(
      ctx,
      text,
      searchResultsKeyboard(response.items, response.page, response.total_pages),
    );
  }

  async function startSearch(
    ctx: Context,
    filters: Partial<SearchState>,
    queryTruncated = false,
  ): Promise<void> {
    const state = createSearchState({
      ...filters,
      page: 1,
      queryTruncated,
    });
    await loadAndSendPage(ctx, state);
  }

  async function showPage(ctx: Context, page: number): Promise<void> {
    const userId = userIdOf(ctx);
    const current = sessions.get(userId).search;
    if (!current) {
      await sendLong(ctx, SEARCH_NEED_CONTEXT_TEXT, backToMenuKeyboard());
      return;
    }
    if (current.totalPages > 0 && page > current.totalPages) {
      await sendLong(ctx, NO_MORE_RESULTS_TEXT, filtersKeyboard(current));
      return;
    }
    await loadAndSendPage(ctx, { ...current, page });
  }

  async function showEventCard(ctx: Context, id: string, page: number | null): Promise<void> {
    const userId = userIdOf(ctx);
    let event;
    try {
      event = await api.getEvent(id);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        logger.info('event_not_found', { event_id: id });
        await sendLong(
          ctx,
          'Событие не найдено. Возможно, оно уже прошло или было отменено.',
          backToMenuKeyboard(),
        );
        return;
      }
      throw error;
    }

    const currentSearch = sessions.get(userId).search;
    const backPage = currentSearch ? (page ?? currentSearch.page) : null;
    logger.info('event_opened', { user_id: userId, event_id: event.id });
    await sendLong(
      ctx,
      formatEventCard(event),
      eventCardKeyboard(event, {
        publicWebUrl: publicWebUrl,
        backPage,
      }),
    );
  }

  async function showSubscriptions(ctx: Context): Promise<void> {
    const subscriptions = await api.listSubscriptions(userRefFor(ctx));
    await sendLong(ctx, formatSubscriptionsList(subscriptions), subscriptionsKeyboard(subscriptions));
  }

  async function showDraftSummary(
    ctx: Context,
    draft: SubscriptionDraft,
    prefix?: string,
  ): Promise<void> {
    const text = prefix ? `${prefix}\n\n${formatSubscriptionDraft(draft)}` : formatSubscriptionDraft(draft);
    await editOrSend(ctx, text, subscriptionDraftKeyboard(draft));
  }

  async function startSubscriptionDraft(ctx: Context): Promise<void> {
    const userId = userIdOf(ctx);
    const draft = createSubscriptionDraft();
    sessions.update(userId, (session) => {
      session.draft = draft;
      session.awaitingQuery = false;
    });
    await sendLong(
      ctx,
      `${formatSubscriptionDraft(draft)}\n\nГород, категорию и период можно оставить любыми.`,
      subscriptionDraftKeyboard(draft),
    );
  }

  async function saveDraft(ctx: Context): Promise<void> {
    const userId = userIdOf(ctx);
    const draft = sessions.get(userId).draft;
    if (!draft) {
      await startSubscriptionDraft(ctx);
      return;
    }

    try {
      const subscription = await api.createSubscription({
        channel: 'telegram',
        user_ref: userRefFor(ctx),
        city: draft.city,
        category: draft.category,
        period: draft.period,
      });
      sessions.update(userId, (session) => {
        session.draft = null;
      });
      logger.info('subscription_created', {
        user_id: userId,
        subscription_id: subscription.id,
        city: subscription.city,
        category: subscription.category,
      });
      await editOrSend(
        ctx,
        formatSubscriptionCreated(subscription),
        subscriptionSavedKeyboard(),
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        await sendLong(
          ctx,
          `${formatSubscriptionDraft(draft)}\n\nТакая подписка уже оформлена. Измените настройки или откройте «Мои подписки».`,
          subscriptionDraftKeyboard(draft),
        );
        return;
      }
      throw error;
    }
  }

  async function quickSubscribe(
    ctx: Context,
    city: CityId,
    category: CategoryId,
  ): Promise<void> {
    try {
      const subscription = await api.createSubscription({
        channel: 'telegram',
        user_ref: userRefFor(ctx),
        city,
        category,
        period: null,
      });
      logger.info('subscription_created', {
        user_id: userIdOf(ctx),
        subscription_id: subscription.id,
        city: subscription.city,
        category: subscription.category,
      });
      await sendLong(ctx, formatSubscriptionCreated(subscription), subscriptionSavedKeyboard());
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        await sendLong(
          ctx,
          `Подписка «${categoryName(category) ?? category} · ${cityName(city) ?? city}» уже есть.`,
          subscriptionSavedKeyboard(),
        );
        return;
      }
      throw error;
    }
  }

  async function deleteSubscription(ctx: Context, id: string): Promise<void> {
    try {
      await api.deleteSubscription(id, userRefFor(ctx));
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        await sendLong(ctx, SUBSCRIPTION_NOT_FOUND_TEXT, subscriptionSavedKeyboard());
        return;
      }
      throw error;
    }
    const subscriptions = await api.listSubscriptions(userRefFor(ctx));
    logger.info('subscription_deleted', { user_id: userIdOf(ctx), subscription_id: id });
    await sendLong(
      ctx,
      `${SUBSCRIPTION_DELETED_TEXT}\n\n${formatSubscriptionsList(subscriptions)}`,
      subscriptionsKeyboard(subscriptions),
    );
  }

  async function openPicker(ctx: Context, field: 'city' | 'category' | 'period'): Promise<void> {
    const userId = userIdOf(ctx);
    const draft = sessions.get(userId).draft;
    if (!draft) {
      await startSubscriptionDraft(ctx);
      return;
    }
    if (field === 'city') {
      await editOrSend(ctx, '📍 Выберите город для подписки:', cityChoiceKeyboard(draft.city));
    } else if (field === 'category') {
      await editOrSend(ctx, '🎭 Выберите категорию для подписки:', categoryChoiceKeyboard(draft.category));
    } else {
      await editOrSend(ctx, '🗓 Выберите период для подписки:', periodChoiceKeyboard(draft.period));
    }
  }

  async function handleMenu(ctx: Context, target: string): Promise<void> {
    const userId = userIdOf(ctx);
    switch (target) {
      case 'home':
        sessions.update(userId, (session) => {
          session.awaitingQuery = false;
          session.draft = null;
        });
        await sendHome(ctx);
        return;
      case 'search':
        sessions.update(userId, (session) => {
          session.awaitingQuery = true;
          session.draft = null;
        });
        await sendLong(ctx, SEARCH_PROMPT, searchPromptKeyboard());
        return;
      case 'categories':
        sessions.update(userId, (session) => {
          session.awaitingQuery = false;
        });
        await sendLong(ctx, CATEGORIES_TITLE, categoriesKeyboard());
        return;
      case 'cities':
        sessions.update(userId, (session) => {
          session.awaitingQuery = false;
        });
        await sendLong(ctx, CITIES_TITLE, citiesKeyboard());
        return;
      case 'soon':
        await startSearch(ctx, { date: 'week' });
        return;
      case 'subs':
        await showSubscriptions(ctx);
        return;
      case 'help':
        await sendLong(ctx, HELP_TEXT, helpKeyboard());
        return;
      default:
        await sendLong(ctx, 'Раздел не найден.', backToMenuKeyboard());
    }
  }

  async function handleCallback(ctx: Context, callback: Callback): Promise<void> {
    const userId = userIdOf(ctx);

    switch (callback.type) {
      case 'menu':
        await handleMenu(ctx, callback.target);
        return;
      case 'search':
        if (callback.action === 'category') {
          sessions.update(userId, (session) => {
            session.search = null;
          });
          await startSearch(ctx, { category: callback.id });
        } else if (callback.action === 'city') {
          sessions.update(userId, (session) => {
            session.search = null;
          });
          await startSearch(ctx, { city: callback.id });
        } else if (callback.action === 'reset') {
          await startSearch(ctx, {});
        } else {
          await showPage(ctx, callback.page);
        }
        return;
      case 'event':
        await showEventCard(ctx, callback.id, callback.page);
        return;
      case 'subscribe':
        await handleSubscribe(ctx, callback);
        return;
      case 'subscriptions':
        await deleteSubscription(ctx, callback.id);
        return;
      case 'noop':
        return;
      default:
        await sendLong(ctx, 'Неизвестное действие.', backToMenuKeyboard());
    }
  }

  async function handleSubscribe(
    ctx: Context,
    callback: Extract<Callback, { type: 'subscribe' }>,
  ): Promise<void> {
    const userId = userIdOf(ctx);
    if (callback.action === 'add') {
      await startSubscriptionDraft(ctx);
      return;
    }
    if (callback.action === 'quick') {
      await quickSubscribe(ctx, callback.city, callback.category);
      return;
    }
    if (callback.action === 'event') {
      const event = await api.getEvent(callback.id);
      if (isCityId(event.city_id) && isCategoryId(event.category)) {
        await quickSubscribe(ctx, event.city_id, event.category);
      } else {
        await sendLong(
          ctx,
          `Не удалось определить город или категорию события «${event.title}».`,
          backToMenuKeyboard(),
        );
      }
      return;
    }

    if (callback.action === 'cancel') {
      sessions.update(userId, (session) => {
        session.draft = null;
      });
      await editOrSend(ctx, CANCEL_TEXT, mainMenuKeyboard({ publicWebUrl: publicWebUrl }));
      return;
    }

    if (callback.action === 'save') {
      await saveDraft(ctx);
      return;
    }

    const draft = sessions.get(userId).draft;
    if (!draft) {
      await startSubscriptionDraft(ctx);
      return;
    }

    if (callback.action === 'pick') {
      await openPicker(ctx, callback.field);
      return;
    }

    if (callback.action === 'summary') {
      await showDraftSummary(ctx, draft);
      return;
    }

    sessions.update(userId, (session) => {
      if (!session.draft) return;
      if (callback.action === 'city') session.draft.city = callback.id;
      if (callback.action === 'category') session.draft.category = callback.id;
      if (callback.action === 'period') session.draft.period = callback.id;
    });
    await showDraftSummary(ctx, sessions.get(userId).draft ?? draft);
  }

  async function handleText(ctx: Context): Promise<void> {
    const text = ctx.message?.text?.trim() ?? '';
    if (!text) return;
    const userId = userIdOf(ctx);

    if (text.startsWith('/')) {
      await sendLong(ctx, UNKNOWN_COMMAND_TEXT, mainMenuKeyboard({ publicWebUrl: publicWebUrl }));
      return;
    }

    const session = sessions.get(userId);
    if (session.draft) {
      await showDraftSummary(ctx, session.draft, DRAFT_ACTIVE_TEXT);
      return;
    }

    if (text.length > MAX_QUERY_LENGTH) {
      logger.debug('query_truncated', { original_length: text.length });
    }
    const query = text.slice(0, MAX_QUERY_LENGTH).trim();
    if (!query) {
      await sendLong(ctx, SEARCH_EMPTY_QUERY, searchPromptKeyboard());
      return;
    }
    logger.info('text_query', {
      user_id: userId,
      length: query.length,
      truncated: text.length > MAX_QUERY_LENGTH,
    });
    await startSearch(ctx, { q: query }, text.length > MAX_QUERY_LENGTH);
  }

  bot.command('start', async (ctx) => {
    sessions.reset(userIdOf(ctx));
    await sendLong(ctx, START_TEXT, mainMenuKeyboard({ publicWebUrl: publicWebUrl }));
  });

  bot.command('help', async (ctx) => {
    await sendLong(ctx, HELP_TEXT, helpKeyboard());
  });

  bot.command('cancel', async (ctx) => {
    sessions.reset(userIdOf(ctx));
    await sendLong(ctx, CANCEL_TEXT, mainMenuKeyboard({ publicWebUrl: publicWebUrl }));
  });

  bot.command('menu', async (ctx) => {
    sessions.update(userIdOf(ctx), (session) => {
      session.awaitingQuery = false;
      session.draft = null;
    });
    await sendLong(ctx, MENU_TITLE, mainMenuKeyboard({ publicWebUrl: publicWebUrl }));
  });

  bot.on('callback_query:data', async (ctx) => {
    const callback = parseCallback(ctx.callbackQuery.data);
    if (!callback) {
      try {
        await ctx.answerCallbackQuery({ text: 'Кнопка устарела. Начните заново из меню.' });
      } catch {
        // callback query мог истечь — это не ошибка бота
      }
      return;
    }

    try {
      await ctx.answerCallbackQuery();
    } catch {
      // просроченный callback не должен ломать обработку
    }

    logger.info('callback_received', {
      user_id: ctx.from?.id,
      type: callback.type,
      action: 'action' in callback ? callback.action : undefined,
    });
    await safely(ctx, () => handleCallback(ctx, callback));
  });

  bot.on('message:text', async (ctx) => {
    await safely(ctx, () => handleText(ctx));
  });

  bot.on('message', async (ctx) => {
    if (ctx.message.text !== undefined) return;
    await safely(ctx, () => sendLong(ctx, NON_TEXT_TEXT, mainMenuKeyboard({ publicWebUrl: publicWebUrl })));
  });

  bot.catch(async (botError) => {
    const description = botError.error instanceof Error ? botError.error.message : String(botError.error);
    logger.error('unhandled_bot_error', {
      update_id: botError.ctx.update.update_id,
      error: description,
    });
    try {
      await botError.ctx.reply(UNEXPECTED_ERROR_TEXT);
    } catch {
      // если Telegram недоступен, ответить не получится
    }
  });

  return bot;
}
