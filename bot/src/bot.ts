import { existsSync } from 'node:fs';

import { Bot, InputFile, type ApiClientOptions, type Context } from 'grammy';

import { ApiError, type ApiClient } from './api/client.js';
import { CallbackStore } from './callback-store.js';
import type { Callback, CallbackIssuer } from './callbacks.js';
import type { BotConfig } from './config.js';
import {
  CATEGORIES,
  CITIES,
  categoryName,
  cityName,
  findCategoryId,
  findCityId,
  isCategoryId,
  isCityId,
  isDatePreset,
  isIsoDate,
  type CategoryId,
  type CityId,
} from './dictionaries.js';
import {
  escapeHtml,
  formatEventCard,
  formatNoResults,
  formatSearchResults,
  formatSubscriptionCreated,
  formatSubscriptionDraft,
  formatSubscriptionsList,
  telegramSafeHttpUrl,
} from './format.js';
import {
  aboutKeyboard,
  backToMenuKeyboard,
  categoriesKeyboard,
  categoryChoiceKeyboard,
  citiesKeyboard,
  cityChoiceKeyboard,
  datePickerKeyboard,
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
import { RateLimiter } from './rate-limit.js';
import {
  createSearchState,
  createSubscriptionDraft,
  type SearchState,
  type SessionStore,
  type SubscriptionDraft,
} from './session.js';
import {
  ABOUT_TEXT,
  CANCEL_TEXT,
  CATEGORIES_TITLE,
  CITIES_TITLE,
  DATE_PICKER_TITLE,
  DRAFT_ACTIVE_TEXT,
  FILTERS_TITLE,
  HELP_TEXT,
  MENU_TITLE,
  NON_TEXT_TEXT,
  NO_MORE_RESULTS_TEXT,
  rateLimitedText,
  SEARCH_EMPTY_QUERY,
  SEARCH_NEED_CONTEXT_TEXT,
  SEARCH_PROMPT,
  STALE_BUTTON_TEXT,
  START_TEXT,
  SUBSCRIPTION_DELETED_TEXT,
  SUBSCRIPTION_NOT_FOUND_TEXT,
  UNEXPECTED_ERROR_TEXT,
  UNKNOWN_COMMAND_TEXT,
} from './texts.js';
import { hashTelegramUserId, telegramUserRef } from './user-ref.js';

const PAGE_SIZE = 5;
const MAX_QUERY_LENGTH = 200;

export interface BotDependencies {
  api: ApiClient;
  sessions: SessionStore;
  config: BotConfig;
  logger: Logger;
  /** Для тестов: подменить хранилище callback-токенов. */
  callbacks?: CallbackStore;
  /** Для тестов: подменить лимитер. */
  rateLimiter?: RateLimiter;
}

function userIdOf(ctx: Context): number {
  const id = ctx.from?.id;
  if (!id) throw new Error('В обновлении нет пользователя');
  return id;
}

function withRequestCode(message: string, requestId: string | null): string {
  if (!requestId) return message;
  const short = requestId.replace(/-/g, '').slice(0, 8);
  return `${message}\n\n<i>Код обращения: ${escapeHtml(short)}</i>`;
}

function commandArgument(ctx: Context): string {
  const text = ctx.message?.text ?? '';
  return text
    .replace(/^\/[A-Za-z0-9_]+(@[A-Za-z0-9_]+)?\s*/, '')
    .trim();
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
  const callbackStore =
    deps.callbacks ??
    new CallbackStore({ ttlMs: config.callbackTtlMs ?? 12 * 60 * 60 * 1000 });
  const rateLimiter =
    deps.rateLimiter ??
    new RateLimiter({ limit: config.rateLimitPerMinute ?? 20 });
  const publicWebUrl = telegramSafeHttpUrl(config.publicWebUrl);
  const logHashSecret = config.logHashSecret ?? config.telegramBotToken;
  const bot = options.client ? new Bot(token, { client: options.client }) : new Bot(token);

  /** В логи попадает только HMAC-псевдоним, не telegram id и не user_ref. */
  function logUser(ctx: Context): string {
    const id = ctx.from?.id;
    if (!id) return 'u_unknown';
    try {
      return hashTelegramUserId(id, logHashSecret);
    } catch {
      return 'u_invalid';
    }
  }

  function issueFor(ctx: Context): CallbackIssuer {
    const userId = userIdOf(ctx);
    return (callback: Callback) => callbackStore.issue(userId, callback);
  }

  async function sendLong(
    ctx: Context,
    text: string,
    keyboard?: ReturnType<typeof mainMenuKeyboard>,
  ): Promise<void> {
    const parts = splitMessage(text);
    for (let index = 0; index < parts.length; index += 1) {
      const isLast = index === parts.length - 1;
      const other: {
        parse_mode: 'HTML';
        link_preview_options: { is_disabled: boolean };
        reply_markup?: ReturnType<typeof mainMenuKeyboard>;
      } = { parse_mode: 'HTML', link_preview_options: { is_disabled: true } };
      if (isLast && keyboard) other.reply_markup = keyboard;
      await ctx.reply(parts[index] ?? '', other);
    }
    logger.info('message_sent', {
      user: logUser(ctx),
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
          parse_mode: 'HTML',
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

  async function typing(ctx: Context): Promise<void> {
    try {
      await ctx.replyWithChatAction('typing');
    } catch {
      // индикатор набора не критичен
    }
  }

  async function safely(ctx: Context, action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error) {
      if (error instanceof ApiError) {
        logger.warn('api_failure', {
          user: logUser(ctx),
          kind: error.kind,
          status: error.status,
          code: error.code,
          request_id: error.requestId,
        });
        await sendLong(
          ctx,
          withRequestCode(escapeHtml(error.userMessage), error.requestId),
          backToMenuKeyboard(issueFor(ctx)),
        );
        return;
      }
      logger.error('handler_failure', { user: logUser(ctx), error });
      await sendLong(ctx, UNEXPECTED_ERROR_TEXT, backToMenuKeyboard(issueFor(ctx)));
    }
  }

  function userRefFor(ctx: Context): string {
    return telegramUserRef(userIdOf(ctx));
  }

  async function sendHome(ctx: Context): Promise<void> {
    await sendLong(ctx, MENU_TITLE, mainMenuKeyboard(issueFor(ctx), { publicWebUrl }));
  }

  async function sendStart(ctx: Context): Promise<void> {
    const keyboard = mainMenuKeyboard(issueFor(ctx), { publicWebUrl });
    if (config.brandImagePath && existsSync(config.brandImagePath)) {
      try {
        await ctx.replyWithPhoto(new InputFile(config.brandImagePath), {
          caption: START_TEXT,
          parse_mode: 'HTML',
          reply_markup: keyboard,
        });
        logger.info('start_sent', { user: logUser(ctx), photo: true });
        return;
      } catch (error) {
        logger.warn('start_photo_failed', { user: logUser(ctx), error });
      }
    }
    await sendLong(ctx, START_TEXT, keyboard);
  }

  function currentSearch(ctx: Context): SearchState | null {
    return sessions.get(userIdOf(ctx)).search;
  }

  async function loadAndSendPage(ctx: Context, state: SearchState): Promise<void> {
    const userId = userIdOf(ctx);
    await typing(ctx);
    const response = await api.searchEvents({
      q: state.q,
      city: state.city,
      category: state.category,
      date: state.date,
      price_max: state.priceMax,
      free: state.freeOnly ? true : null,
      page: state.page,
      page_size: PAGE_SIZE,
      sort: 'date',
    });

    const stored: SearchState = {
      ...state,
      // Не сохраняем пустую страницу: иначе «← К результатам» будет
      // перезапрашивать её по кругу, если выдача сократилась между запросами.
      page: response.items.length === 0 ? Math.max(1, state.page - 1) : response.page,
      totalPages: response.total_pages,
    };
    sessions.update(userId, (session) => {
      session.search = stored;
      session.awaitingQuery = false;
      session.draft = null;
    });

    if (response.items.length === 0) {
      if (state.page > 1) {
        await sendLong(ctx, NO_MORE_RESULTS_TEXT, filtersKeyboard(stored, issueFor(ctx)));
        return;
      }
      await sendLong(
        ctx,
        formatNoResults(stored),
        noResultsKeyboard(stored, issueFor(ctx)),
      );
      return;
    }

    const text = formatSearchResults(response, stored, {
      queryWasTruncated: state.queryTruncated,
    });
    logger.info('search_done', {
      user: logUser(ctx),
      city: state.city,
      category: state.category,
      date: state.date,
      price_max: state.priceMax,
      free: state.freeOnly,
      q_length: state.q?.length ?? 0,
      page: response.page,
      total: response.total,
    });
    await sendLong(
      ctx,
      text,
      searchResultsKeyboard(response.items, response.page, response.total_pages, issueFor(ctx)),
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

  async function applyFilters(ctx: Context, patch: Partial<SearchState>): Promise<void> {
    const base = currentSearch(ctx) ?? createSearchState();
    await loadAndSendPage(ctx, { ...base, ...patch, page: 1 });
  }

  async function showPage(ctx: Context, page: number): Promise<void> {
    const current = currentSearch(ctx);
    if (!current) {
      await sendLong(
        ctx,
        SEARCH_NEED_CONTEXT_TEXT,
        backToMenuKeyboard(issueFor(ctx)),
      );
      return;
    }
    if (current.totalPages > 0 && page > current.totalPages) {
      await sendLong(ctx, NO_MORE_RESULTS_TEXT, filtersKeyboard(current, issueFor(ctx)));
      return;
    }
    await loadAndSendPage(ctx, { ...current, page });
  }

  async function showEventCard(ctx: Context, id: string, page: number | null): Promise<void> {
    const userId = userIdOf(ctx);
    await typing(ctx);
    let event;
    try {
      event = await api.getEvent(id);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        logger.info('event_not_found', { event_id: id, user: logUser(ctx) });
        await sendLong(
          ctx,
          'Событие не найдено. Возможно, оно уже прошло или было отменено.',
          backToMenuKeyboard(issueFor(ctx)),
        );
        return;
      }
      throw error;
    }

    const current = sessions.get(userId).search;
    const backPage = current ? (page ?? current.page) : null;
    logger.info('event_opened', { user: logUser(ctx), event_id: event.id });
    await sendLong(
      ctx,
      formatEventCard(event),
      eventCardKeyboard(event, issueFor(ctx), {
        publicWebUrl,
        backPage,
      }),
    );
  }

  async function showSubscriptions(ctx: Context): Promise<void> {
    await typing(ctx);
    const subscriptions = await api.listSubscriptions(userRefFor(ctx));
    await sendLong(
      ctx,
      formatSubscriptionsList(subscriptions),
      subscriptionsKeyboard(subscriptions, issueFor(ctx)),
    );
  }

  async function showDraftSummary(
    ctx: Context,
    draft: SubscriptionDraft,
    prefix?: string,
  ): Promise<void> {
    const text = prefix ? `${prefix}\n\n${formatSubscriptionDraft(draft)}` : formatSubscriptionDraft(draft);
    await editOrSend(ctx, text, subscriptionDraftKeyboard(draft, issueFor(ctx)));
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
      subscriptionDraftKeyboard(draft, issueFor(ctx)),
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
      await typing(ctx);
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
        user: logUser(ctx),
        subscription_id: subscription.id,
        city: subscription.city,
        category: subscription.category,
      });
      await editOrSend(
        ctx,
        formatSubscriptionCreated(subscription),
        subscriptionSavedKeyboard(issueFor(ctx)),
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        await sendLong(
          ctx,
          `${formatSubscriptionDraft(draft)}\n\nТакая подписка уже оформлена. Измените настройки или откройте «Мои подписки».`,
          subscriptionDraftKeyboard(draft, issueFor(ctx)),
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
      await typing(ctx);
      const subscription = await api.createSubscription({
        channel: 'telegram',
        user_ref: userRefFor(ctx),
        city,
        category,
        period: null,
      });
      logger.info('subscription_created', {
        user: logUser(ctx),
        subscription_id: subscription.id,
        city: subscription.city,
        category: subscription.category,
      });
      await sendLong(
        ctx,
        formatSubscriptionCreated(subscription),
        subscriptionSavedKeyboard(issueFor(ctx)),
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        await sendLong(
          ctx,
          `Подписка «${categoryName(category) ?? category} · ${cityName(city) ?? city}» уже есть.`,
          subscriptionSavedKeyboard(issueFor(ctx)),
        );
        return;
      }
      throw error;
    }
  }

  async function deleteSubscription(ctx: Context, id: string): Promise<void> {
    try {
      await typing(ctx);
      await api.deleteSubscription(id, userRefFor(ctx));
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        await sendLong(
          ctx,
          SUBSCRIPTION_NOT_FOUND_TEXT,
          subscriptionSavedKeyboard(issueFor(ctx)),
        );
        return;
      }
      throw error;
    }
    const subscriptions = await api.listSubscriptions(userRefFor(ctx));
    logger.info('subscription_deleted', { user: logUser(ctx), subscription_id: id });
    await sendLong(
      ctx,
      `${SUBSCRIPTION_DELETED_TEXT}\n\n${formatSubscriptionsList(subscriptions)}`,
      subscriptionsKeyboard(subscriptions, issueFor(ctx)),
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
      await editOrSend(
        ctx,
        '📍 Выберите город для подписки:',
        cityChoiceKeyboard(draft.city, issueFor(ctx)),
      );
    } else if (field === 'category') {
      await editOrSend(
        ctx,
        '🎭 Выберите категорию для подписки:',
        categoryChoiceKeyboard(draft.category, issueFor(ctx)),
      );
    } else {
      await editOrSend(
        ctx,
        '🗓 Выберите период для подписки:',
        periodChoiceKeyboard(draft.period, issueFor(ctx)),
      );
    }
  }

  async function showFilters(ctx: Context, edit: boolean): Promise<void> {
    const state = currentSearch(ctx) ?? createSearchState();
    if (edit) {
      await editOrSend(ctx, FILTERS_TITLE, filtersKeyboard(state, issueFor(ctx)));
    } else {
      await sendLong(ctx, FILTERS_TITLE, filtersKeyboard(state, issueFor(ctx)));
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
        await sendLong(ctx, SEARCH_PROMPT, searchPromptKeyboard(issueFor(ctx)));
        return;
      case 'categories':
        sessions.update(userId, (session) => {
          session.awaitingQuery = false;
        });
        await sendLong(ctx, CATEGORIES_TITLE, categoriesKeyboard(issueFor(ctx)));
        return;
      case 'cities':
        sessions.update(userId, (session) => {
          session.awaitingQuery = false;
        });
        await sendLong(ctx, CITIES_TITLE, citiesKeyboard(issueFor(ctx)));
        return;
      case 'soon':
        await startSearch(ctx, { date: 'week' });
        return;
      case 'subs':
        await showSubscriptions(ctx);
        return;
      case 'help':
        await sendLong(ctx, HELP_TEXT, helpKeyboard(issueFor(ctx)));
        return;
      case 'about':
        await sendLong(ctx, ABOUT_TEXT, aboutKeyboard(issueFor(ctx), { publicWebUrl }));
        return;
      default:
        await sendLong(ctx, 'Раздел не найден.', backToMenuKeyboard(issueFor(ctx)));
    }
  }

  async function handleFilter(
    ctx: Context,
    callback: Extract<Callback, { type: 'filter' }>,
  ): Promise<void> {
    const userId = userIdOf(ctx);
    const state = currentSearch(ctx) ?? createSearchState();

    switch (callback.action) {
      case 'open':
        await showFilters(ctx, true);
        return;
      case 'results':
        if (!currentSearch(ctx)) {
          await startSearch(ctx, {});
        } else {
          const maxPage = state.totalPages > 0 ? state.totalPages : 1;
          const page = Math.min(Math.max(1, state.page || 1), maxPage);
          await loadAndSendPage(ctx, { ...state, page });
        }
        return;
      case 'dateMenu':
        await editOrSend(
          ctx,
          DATE_PICKER_TITLE,
          datePickerKeyboard(state.date, issueFor(ctx)),
        );
        return;
      case 'cityMenu':
        await editOrSend(
          ctx,
          CITIES_TITLE,
          citiesKeyboard(issueFor(ctx), 'filter'),
        );
        return;
      case 'categoryMenu':
        await editOrSend(
          ctx,
          CATEGORIES_TITLE,
          categoriesKeyboard(issueFor(ctx), 'filter'),
        );
        return;
      case 'setDate':
        if (
          callback.date !== null &&
          !isDatePreset(callback.date) &&
          !isIsoDate(callback.date)
        ) {
          throw new Error('Некорректная дата в callback');
        }
        await applyFilters(ctx, { date: callback.date });
        return;
      case 'setPrice': {
        const { priceMax, freeOnly } = callback;
        if (
          priceMax !== null &&
          (!Number.isInteger(priceMax) || priceMax < 0 || priceMax > 1_000_000)
        ) {
          throw new Error('Некорректная цена в callback');
        }
        await applyFilters(ctx, { priceMax, freeOnly: Boolean(freeOnly) });
        return;
      }
      case 'setCity':
        if (callback.city !== null && !isCityId(callback.city)) {
          throw new Error('Некорректный город в callback');
        }
        await applyFilters(ctx, { city: callback.city });
        return;
      case 'setCategory':
        if (callback.category !== null && !isCategoryId(callback.category)) {
          throw new Error('Некорректная категория в callback');
        }
        await applyFilters(ctx, { category: callback.category });
        return;
      case 'clear': {
        const patch: Partial<SearchState> = {};
        // «Сбросить» убирает фильтры, но сохраняет текст запроса: иначе
        // пользователь теряет свой поиск и получает всю афишу подряд.
        if (callback.field === 'q') patch.q = null;
        if (callback.field === 'city' || callback.field === 'all') patch.city = null;
        if (callback.field === 'category' || callback.field === 'all') patch.category = null;
        if (callback.field === 'date' || callback.field === 'all') patch.date = null;
        if (callback.field === 'price' || callback.field === 'all') {
          patch.priceMax = null;
          patch.freeOnly = false;
        }
        const next = { ...state, ...patch, page: 1 };
        sessions.update(userId, (session) => {
          session.search = next;
        });
        await loadAndSendPage(ctx, next);
        return;
      }
      default:
        await sendLong(
          ctx,
          STALE_BUTTON_TEXT,
          mainMenuKeyboard(issueFor(ctx), { publicWebUrl }),
        );
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
          sessions.update(userId, (session) => {
            session.search = null;
          });
          await startSearch(ctx, {});
        } else {
          await showPage(ctx, callback.page);
        }
        return;
      case 'filter':
        await handleFilter(ctx, callback);
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
      default:
        await sendLong(
          ctx,
          STALE_BUTTON_TEXT,
          mainMenuKeyboard(issueFor(ctx), { publicWebUrl }),
        );
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
      await typing(ctx);
      const event = await api.getEvent(callback.id);
      if (isCityId(event.city_id) && isCategoryId(event.category)) {
        await quickSubscribe(ctx, event.city_id, event.category);
      } else {
        await sendLong(
          ctx,
          `Не удалось определить город или категорию события «${escapeHtml(event.title)}».`,
          backToMenuKeyboard(issueFor(ctx)),
        );
      }
      return;
    }

    if (callback.action === 'cancel') {
      sessions.update(userId, (session) => {
        session.draft = null;
      });
      await editOrSend(ctx, CANCEL_TEXT, mainMenuKeyboard(issueFor(ctx), { publicWebUrl }));
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
      await sendLong(
        ctx,
        UNKNOWN_COMMAND_TEXT,
        mainMenuKeyboard(issueFor(ctx), { publicWebUrl }),
      );
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
      await sendLong(ctx, SEARCH_EMPTY_QUERY, searchPromptKeyboard(issueFor(ctx)));
      return;
    }
    logger.info('text_query', {
      user: logUser(ctx),
      length: query.length,
      truncated: text.length > MAX_QUERY_LENGTH,
    });
    await startSearch(ctx, { q: query }, text.length > MAX_QUERY_LENGTH);
  }

  async function applyDateCommand(ctx: Context, value: string): Promise<void> {
    if (value === 'any' || value === 'любая' || value === 'сброс') {
      await applyFilters(ctx, { date: null });
      return;
    }
    if (!isDatePreset(value) && !isIsoDate(value)) {
      await sendLong(
        ctx,
        'Не понял дату. Укажите /today, /tomorrow, /weekend, /week или день в формате 2026-11-20.',
        backToMenuKeyboard(issueFor(ctx)),
      );
      return;
    }
    await applyFilters(ctx, { date: value });
  }

  async function applyCityCommand(ctx: Context, value: string): Promise<void> {
    if (value === 'any' || value === 'все' || value === 'сброс') {
      await applyFilters(ctx, { city: null });
      return;
    }
    const city = findCityId(value);
    if (!city) {
      await sendLong(
        ctx,
        `Не знаю город «${escapeHtml(value)}». Доступны: ${CITIES.map((city) => city.name).join(', ')}.`,
        citiesKeyboard(issueFor(ctx), 'filter'),
      );
      return;
    }
    await applyFilters(ctx, { city });
  }

  async function applyCategoryCommand(ctx: Context, value: string): Promise<void> {
    if (value === 'any' || value === 'все' || value === 'сброс') {
      await applyFilters(ctx, { category: null });
      return;
    }
    const category = findCategoryId(value);
    if (!category) {
      await sendLong(
        ctx,
        `Не знаю категорию «${escapeHtml(value)}». Доступны: ${CATEGORIES.map((category) => category.name.toLowerCase()).join(', ')}.`,
        categoriesKeyboard(issueFor(ctx), 'filter'),
      );
      return;
    }
    await applyFilters(ctx, { category });
  }

  async function applyPriceCommand(ctx: Context, value: string): Promise<void> {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      await showFilters(ctx, false);
      return;
    }
    if (normalized === 'free' || normalized === 'бесплатно' || normalized === '0') {
      await applyFilters(ctx, { freeOnly: true, priceMax: null });
      return;
    }
    if (normalized === 'any' || normalized === 'любая' || normalized === 'сброс') {
      await applyFilters(ctx, { freeOnly: false, priceMax: null });
      return;
    }
    if (!/^\d{1,7}$/.test(normalized)) {
      await sendLong(
        ctx,
        'Не понял цену. Укажите /price free или /price 1000 — это потолок цены за человека.',
        backToMenuKeyboard(issueFor(ctx)),
      );
      return;
    }
    const amount = Number(normalized);
    if (amount < 1 || amount > 1_000_000) {
      await sendLong(
        ctx,
        'Цена должна быть от 1 до 1 000 000 ₽. Например: /price 1000.',
        backToMenuKeyboard(issueFor(ctx)),
      );
      return;
    }
    await applyFilters(ctx, { freeOnly: false, priceMax: amount });
  }

  // Лимит частоты стоит до команд: один чат не должен заваливать API.
  bot.use(async (ctx, next) => {
    if (!ctx.from?.id) return next();
    const result = rateLimiter.take(ctx.from.id);
    if (result.allowed) return next();
    logger.warn('rate_limited', { user: logUser(ctx), retry_after: result.retryAfterSec });
    const text = rateLimitedText(result.retryAfterSec);
    try {
      if (ctx.callbackQuery) {
        await ctx.answerCallbackQuery({ text, show_alert: true });
      } else {
        await ctx.reply(text);
      }
    } catch {
      // ответ на лимит не должен ронять обработчик
    }
  });

  bot.command('start', async (ctx) => {
    sessions.reset(userIdOf(ctx));
    await safely(ctx, () => sendStart(ctx));
  });

  bot.command('help', async (ctx) => {
    await safely(ctx, async () => {
      await sendLong(ctx, HELP_TEXT, helpKeyboard(issueFor(ctx)));
    });
  });

  bot.command('cancel', async (ctx) => {
    await safely(ctx, async () => {
      sessions.reset(userIdOf(ctx));
      await sendLong(ctx, CANCEL_TEXT, mainMenuKeyboard(issueFor(ctx), { publicWebUrl }));
    });
  });

  bot.command('menu', async (ctx) => {
    await safely(ctx, async () => {
      sessions.update(userIdOf(ctx), (session) => {
        session.awaitingQuery = false;
        session.draft = null;
      });
      await sendLong(ctx, MENU_TITLE, mainMenuKeyboard(issueFor(ctx), { publicWebUrl }));
    });
  });

  bot.command('about', async (ctx) => {
    await safely(ctx, async () => {
      await sendLong(ctx, ABOUT_TEXT, aboutKeyboard(issueFor(ctx), { publicWebUrl }));
    });
  });

  bot.command('search', async (ctx) => {
    await safely(ctx, async () => {
      sessions.update(userIdOf(ctx), (session) => {
        session.awaitingQuery = true;
        session.draft = null;
      });
      await sendLong(ctx, SEARCH_PROMPT, searchPromptKeyboard(issueFor(ctx)));
    });
  });

  bot.command('filters', async (ctx) => {
    await safely(ctx, () => showFilters(ctx, false));
  });

  for (const [command, preset] of [
    ['today', 'today'],
    ['tomorrow', 'tomorrow'],
    ['weekend', 'weekend'],
    ['week', 'week'],
  ] as const) {
    bot.command(command, async (ctx) => {
      await safely(ctx, () => applyFilters(ctx, { date: preset }));
    });
  }

  bot.command('date', async (ctx) => {
    await safely(ctx, async () => {
      const value = commandArgument(ctx).toLowerCase();
      if (!value) {
        await sendLong(
          ctx,
          DATE_PICKER_TITLE,
          datePickerKeyboard(currentSearch(ctx)?.date ?? null, issueFor(ctx)),
        );
        return;
      }
      await applyDateCommand(ctx, value);
    });
  });

  bot.command('city', async (ctx) => {
    await safely(ctx, async () => {
      const value = commandArgument(ctx);
      if (!value) {
        await sendLong(
          ctx,
          CITIES_TITLE,
          citiesKeyboard(issueFor(ctx), currentSearch(ctx) ? 'filter' : 'search'),
        );
        return;
      }
      await applyCityCommand(ctx, value);
    });
  });

  bot.command('category', async (ctx) => {
    await safely(ctx, async () => {
      const value = commandArgument(ctx);
      if (!value) {
        await sendLong(
          ctx,
          CATEGORIES_TITLE,
          categoriesKeyboard(issueFor(ctx), currentSearch(ctx) ? 'filter' : 'search'),
        );
        return;
      }
      await applyCategoryCommand(ctx, value);
    });
  });

  bot.command('price', async (ctx) => {
    await safely(ctx, async () => {
      await applyPriceCommand(ctx, commandArgument(ctx));
    });
  });

  bot.command('categories', async (ctx) => {
    await safely(ctx, async () => {
      await sendLong(ctx, CATEGORIES_TITLE, categoriesKeyboard(issueFor(ctx)));
    });
  });

  bot.command('cities', async (ctx) => {
    await safely(ctx, async () => {
      await sendLong(ctx, CITIES_TITLE, citiesKeyboard(issueFor(ctx)));
    });
  });

  bot.command(['subscriptions', 'unsubscribe'], async (ctx) => {
    await safely(ctx, () => showSubscriptions(ctx));
  });

  bot.command('find', async (ctx) => {
    await safely(ctx, async () => {
      const query = commandArgument(ctx).slice(0, MAX_QUERY_LENGTH).trim();
      if (!query) {
        await sendLong(ctx, SEARCH_PROMPT, searchPromptKeyboard(issueFor(ctx)));
        return;
      }
      await startSearch(ctx, { q: query });
    });
  });

  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;
    const userId = userIdOf(ctx);
    const callback = callbackStore.resolve(userId, data);
    if (!callback) {
      try {
        await ctx.answerCallbackQuery({ text: STALE_BUTTON_TEXT });
      } catch {
        // callback query мог истечь — это не ошибка бота
      }
      await safely(ctx, async () => {
        await sendLong(
          ctx,
          STALE_BUTTON_TEXT,
          mainMenuKeyboard(issueFor(ctx), { publicWebUrl }),
        );
      });
      return;
    }

    try {
      await ctx.answerCallbackQuery();
    } catch {
      // просроченный callback не должен ломать обработку
    }

    logger.info('callback_received', {
      user: logUser(ctx),
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
    await safely(ctx, async () => {
      await sendLong(
        ctx,
        NON_TEXT_TEXT,
        mainMenuKeyboard(issueFor(ctx), { publicWebUrl }),
      );
    });
  });

  bot.catch(async (botError) => {
    const description = botError.error instanceof Error ? botError.error.message : String(botError.error);
    logger.error('unhandled_bot_error', {
      update_id: botError.ctx.update.update_id,
      user: botError.ctx.from ? logUser(botError.ctx) : undefined,
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
