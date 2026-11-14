import { existsSync } from 'node:fs';

import { Bot, InputFile, type ApiClientOptions, type Context } from 'grammy';

import { buildEventIcs, calendarCaption, calendarFileName } from './calendar.js';
import { ApiError, type ApiClient } from './api/client.js';
import type { Event, Occurrence, Relaxation } from './api/types.js';
import { CallbackStore } from './callback-store.js';
import type { Callback, CallbackIssuer } from './callbacks.js';
import type { BotConfig } from './config.js';
import type { CategoryId, CityId, DirectoryResolver } from './directory-service.js';
import {
  escapeHtml,
  formatAssistantResponse,
  formatEventCard,
  formatNoResults,
  formatOffers,
  formatSearchResults,
  formatSessionsList,
  formatSimilarResults,
  formatSubscriptionCreated,
  formatSubscriptionDraft,
  formatSubscriptionsList,
  formatVenueSchedule,
  isEventUuid,
  pickOccurrence,
  telegramSafeHttpUrl,
} from './format.js';
import {
  aboutKeyboard,
  ageKeyboard,
  assistantKeyboard,
  backToMenuKeyboard,
  categoriesKeyboard,
  categoryChoiceKeyboard,
  citiesKeyboard,
  cityChoiceKeyboard,
  datePickerKeyboard,
  eventCardKeyboard,
  filtersKeyboard,
  helpKeyboard,
  languageKeyboard,
  mainMenuKeyboard,
  noResultsKeyboard,
  offersKeyboard,
  periodChoiceKeyboard,
  rangeEndKeyboard,
  rangeStartKeyboard,
  searchPromptKeyboard,
  searchResultsKeyboard,
  sessionsKeyboard,
  similarResultsKeyboard,
  sortKeyboard,
  subscriptionDraftKeyboard,
  subscriptionSavedKeyboard,
  subscriptionsKeyboard,
  venueScheduleKeyboard,
} from './keyboards.js';
import type { Logger } from './logger.js';
import { RateLimiter } from './rate-limit.js';
import {
  AGE_OPTIONS,
  RANGE_MAX_DAYS,
  addIsoDays,
  isAgeOption,
  isDatePreset,
  isIsoDate,
  isLanguageCode,
  isSearchSort,
  parseIsoRange,
  rangeDays,
  todayIsoDate,
} from './search-options.js';
import {
  createSearchState,
  createSubscriptionDraft,
  type SearchState,
  type SessionStore,
  type SubscriptionDraft,
} from './session.js';
import {
  ABOUT_TEXT,
  ASSISTANT_CONFIRMATION_DONE_TEXT,
  ASSISTANT_CONFIRMATION_REJECTED_TEXT,
  ASSISTANT_CONFIRMATION_STALE_TEXT,
  ASSISTANT_CONFIRMATIONS_OFF_TEXT,
  ASSISTANT_UNAVAILABLE_TEXT,
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
const MAX_QUERY_LENGTH = 100;
/** Контракт POST /assistant/query: message не длиннее 1000 знаков. */
const ASSISTANT_MAX_MESSAGE_LENGTH = 1000;

export interface BotDependencies {
  api: ApiClient;
  sessions: SessionStore;
  config: BotConfig;
  logger: Logger;
  /** Справочники городов и категорий: из API с fallback на встроенный список. */
  directories: DirectoryResolver;
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
  const { api, sessions, config, logger, directories } = deps;
  const callbackStore =
    deps.callbacks ??
    new CallbackStore({ ttlMs: config.callbackTtlMs ?? 12 * 60 * 60 * 1000 });
  const rateLimiter =
    deps.rateLimiter ??
    new RateLimiter({ limit: config.rateLimitPerMinute ?? 20 });
  const publicWebUrl = telegramSafeHttpUrl(config.publicWebUrl);
  const logHashSecret = config.logHashSecret ?? config.telegramBotToken;
  if ((config.userRefMode ?? 'hmac') === 'legacy') {
    logger.warn('user_ref_legacy_mode', {
      message: 'USER_REF_MODE=legacy делает user_ref предсказуемым; используйте только для отката',
    });
  }
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
    return telegramUserRef(userIdOf(ctx), {
      mode: config.userRefMode ?? 'hmac',
      secret: config.userRefSecret ?? logHashSecret,
    });
  }

  function currentBotUsername(): string | null {
    return bot.botInfo?.username ?? null;
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
      date_from: state.dateFrom,
      date_to: state.dateTo,
      price_max: state.priceMax,
      free: state.freeOnly ? true : null,
      age: state.age,
      venue_id: state.venueId,
      language: state.language,
      page: state.page,
      page_size: PAGE_SIZE,
      sort: state.sort,
    });

    const stored: SearchState = {
      ...state,
      // Не сохраняем пустую страницу: иначе «← К результатам» будет
      // перезапрашивать её по кругу, если выдача сократилась между запросами.
      page: response.items.length === 0 ? Math.max(1, state.page - 1) : response.page,
      totalPages: response.total_pages,
      facets: response.facets ?? null,
      relaxations: response.relaxations,
    };
    sessions.update(userId, (session) => {
      session.search = stored;
      session.awaitingQuery = false;
      session.draft = null;
      session.rangeDraftStart = null;
    });

    if (response.items.length === 0) {
      if (state.page > 1) {
        await sendLong(
          ctx,
          NO_MORE_RESULTS_TEXT,
          filtersKeyboard(stored, issueFor(ctx), directories, new Date(), stored.facets),
        );
        return;
      }
      await sendLong(
        ctx,
        formatNoResults(stored, directories, new Date(), response.relaxations),
        noResultsKeyboard(stored, issueFor(ctx), response.relaxations),
      );
      return;
    }

    const text = formatSearchResults(response, stored, directories, {
      queryWasTruncated: state.queryTruncated,
    });
    logger.info('search_done', {
      user: logUser(ctx),
      city: state.city,
      category: state.category,
      date: state.date,
      date_from: state.dateFrom,
      date_to: state.dateTo,
      price_max: state.priceMax,
      free: state.freeOnly,
      age: state.age,
      language: state.language,
      sort: state.sort,
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

  /**
   * Сервер присылает `relaxation.query` в формате GET /events. Преобразуем
   * его в состояние поиска, а неизвестные ключи игнорируем: старый бэкенд
   * и новая схема не должны ломать кнопку.
   */
  function relaxationPatch(
    relaxation: Relaxation,
  ): Partial<SearchState> {
    const patch: Partial<SearchState> = {};
    const codes =
      relaxation.codes.length > 0 ? relaxation.codes : [relaxation.code];
    for (const code of codes) {
      switch (code) {
        case 'date':
        case 'time':
          patch.date = null;
          patch.dateFrom = null;
          patch.dateTo = null;
          break;
        case 'budget':
          patch.priceMax = null;
          patch.freeOnly = false;
          break;
        case 'city':
          patch.city = null;
          break;
        case 'venue':
          patch.venueId = null;
          break;
        case 'category':
          patch.category = null;
          break;
        case 'age':
          patch.age = null;
          break;
        case 'query':
          patch.q = null;
          break;
        default:
          break;
      }
    }

    const query = relaxation.query ?? {};
    const text = (value: unknown): string | null =>
      typeof value === 'string' && value.trim() ? value : null;

    if ('q' in query) patch.q = text(query.q);
    if ('city' in query) {
      const city = text(query.city);
      patch.city = city && directories.isCityId(city) ? city : null;
    }
    if ('category' in query) {
      const category = text(query.category);
      patch.category = category && directories.isCategoryId(category) ? category : null;
    }
    if ('language' in query) {
      const language = text(query.language);
      patch.language = language && isLanguageCode(language) ? language : null;
    }
    if ('venue_id' in query) patch.venueId = text(query.venue_id);
    if ('date' in query) {
      const date = text(query.date);
      patch.date = date;
      patch.dateFrom = null;
      patch.dateTo = null;
    }
    if ('date_from' in query) patch.dateFrom = text(query.date_from);
    if ('date_to' in query) patch.dateTo = text(query.date_to);
    if ('price_max' in query) {
      const price = query.price_max;
      patch.priceMax =
        typeof price === 'number' && Number.isFinite(price) && price >= 0
          ? price
          : null;
    }
    if ('free' in query) patch.freeOnly = query.free === true || query.free === 'true';
    if ('free_only' in query) {
      patch.freeOnly = query.free_only === true || query.free_only === 'true';
    }
    if ('age' in query) {
      const age = query.age;
      patch.age =
        typeof age === 'number' && isAgeOption(age) ? age : null;
    }
    if ('sort' in query) {
      const sort = text(query.sort);
      patch.sort = sort && isSearchSort(sort) ? sort : 'date';
    }

    return patch;
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
      await sendLong(ctx, NO_MORE_RESULTS_TEXT, filtersKeyboard(current, issueFor(ctx), directories));
      return;
    }
    await loadAndSendPage(ctx, { ...current, page });
  }

  async function showEventCard(
    ctx: Context,
    id: string,
    page: number | null,
    occurrenceId: string | null = null,
  ): Promise<void> {
    const userId = userIdOf(ctx);
    await typing(ctx);
    let event: Event;
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
    const selectedOccurrence = occurrenceId
      ? (event.occurrences.find((item) => item.id === occurrenceId)?.id ?? null)
      : null;
    logger.info('event_opened', {
      user: logUser(ctx),
      event_id: event.id,
      occurrence: Boolean(selectedOccurrence),
    });
    await sendLong(
      ctx,
      formatEventCard(event, directories, new Date(), { occurrenceId: selectedOccurrence }),
      eventCardKeyboard(event, issueFor(ctx), directories, {
        publicWebUrl,
        backPage,
        botUsername: currentBotUsername(),
        occurrenceId: selectedOccurrence,
      }),
    );
  }

  async function loadEventOrExplain(ctx: Context, id: string): Promise<Event | null> {
    await typing(ctx);
    try {
      return await api.getEvent(id);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        logger.info('event_not_found', { event_id: id, user: logUser(ctx) });
        await sendLong(
          ctx,
          'Событие не найдено. Возможно, оно уже прошло или было отменено.',
          backToMenuKeyboard(issueFor(ctx)),
        );
        return null;
      }
      throw error;
    }
  }

  async function showSessions(ctx: Context, id: string): Promise<void> {
    const event = await loadEventOrExplain(ctx, id);
    if (!event) return;
    logger.info('event_sessions_opened', {
      user: logUser(ctx),
      event_id: event.id,
      count: event.occurrences.length,
    });
    await sendLong(
      ctx,
      formatSessionsList(event, new Date(), directories),
      sessionsKeyboard(event, issueFor(ctx)),
    );
  }

  async function showOffers(ctx: Context, id: string): Promise<void> {
    const event = await loadEventOrExplain(ctx, id);
    if (!event) return;
    logger.info('offers_opened', {
      user: logUser(ctx),
      event_id: event.id,
      count: event.offers.length,
    });
    await sendLong(ctx, formatOffers(event), offersKeyboard(event, issueFor(ctx)));
  }

  function fallbackOccurrence(event: Event): Occurrence | null {
    if (!event.date_start) return null;
    // У события без сеансов календарь строится по самой дате. Прошедшую
    // дату тоже надо распознать, иначе получится .ics в прошлом.
    const isPast =
      event.time_precision === 'date'
        ? (event.date_end ?? event.date_start).slice(0, 10) < todayIsoDate()
        : (() => {
            const end = Date.parse(event.date_end ?? event.date_start);
            return Number.isFinite(end) && end < Date.now();
          })();
    return {
      id: `${event.id}-main`,
      date_start: event.date_start,
      date_end: event.date_end,
      time_precision: event.time_precision ?? 'minute',
      status: event.status === 'cancelled' ? 'cancelled' : 'scheduled',
      availability: 'unknown',
      is_past: isPast,
    };
  }

  async function sendCalendar(
    ctx: Context,
    id: string,
    occurrenceId: string | null,
  ): Promise<void> {
    const event = await loadEventOrExplain(ctx, id);
    if (!event) return;
    const occurrence = pickOccurrence(event, occurrenceId) ?? fallbackOccurrence(event);
    if (!occurrence) {
      await sendLong(
        ctx,
        'У события пока нет даты, поэтому календарь недоступен.',
        backToMenuKeyboard(issueFor(ctx)),
      );
      return;
    }
    if (occurrence.is_past) {
      await sendLong(
        ctx,
        'Этот сеанс уже прошёл — добавлять его в календарь не нужно.',
        eventCardKeyboard(event, issueFor(ctx), directories, {
          publicWebUrl,
          botUsername: currentBotUsername(),
        }),
      );
      return;
    }
    if (occurrence.status === 'cancelled' || event.status === 'cancelled') {
      await sendLong(
        ctx,
        'Сеанс отменён, поэтому календарь не создаю.',
        eventCardKeyboard(event, issueFor(ctx), directories, {
          publicWebUrl,
          botUsername: currentBotUsername(),
        }),
      );
      return;
    }

    const ics = buildEventIcs(event, occurrence);
    logger.info('calendar_sent', {
      user: logUser(ctx),
      event_id: event.id,
      occurrence_id: occurrence.id,
    });
    await ctx.replyWithDocument(
      new InputFile(Buffer.from(ics, 'utf8'), calendarFileName(event)),
      {
        caption: escapeHtml(calendarCaption(event, occurrence)),
        parse_mode: 'HTML',
      },
    );
  }

  async function showVenueSchedule(
    ctx: Context,
    venueId: string,
    date: string | null = null,
  ): Promise<void> {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(venueId)) {
      await staleMenu(ctx);
      return;
    }
    const start = date && isIsoDate(date) ? date : todayIsoDate();
    const end = addIsoDays(start, 13);
    const days = rangeDays(start, end);
    if (days === null || days > RANGE_MAX_DAYS) {
      await sendLong(
        ctx,
        'Не удалось определить период расписания площадки.',
        backToMenuKeyboard(issueFor(ctx)),
      );
      return;
    }

    await typing(ctx);
    let schedule;
    try {
      schedule = await api.getVenueSchedule(venueId, {
        date_from: start,
        date_to: end,
      });
    } catch (error) {
      if (
        error instanceof ApiError &&
        (error.status === 404 || error.status === 400 || error.status === 503)
      ) {
        logger.info('venue_schedule_unavailable', {
          user: logUser(ctx),
          venue_id: venueId,
          status: error.status,
        });
        await sendLong(
          ctx,
          'Расписание площадки пока недоступно. Откройте карточку события или меню.',
          backToMenuKeyboard(issueFor(ctx)),
        );
        return;
      }
      throw error;
    }

    logger.info('venue_schedule_opened', {
      user: logUser(ctx),
      venue_id: venueId,
      total: schedule.items.length,
    });
    await sendLong(
      ctx,
      formatVenueSchedule(schedule, directories),
      venueScheduleKeyboard(venueId, issueFor(ctx)),
    );
  }

  async function showSimilar(ctx: Context, id: string, page: number): Promise<void> {
    await typing(ctx);
    let response;
    try {
      response = await api.getSimilarEvents(id, { page, page_size: PAGE_SIZE });
    } catch (error) {
      if (error instanceof ApiError && (error.status === 404 || error.status === 400)) {
        logger.info('similar_unavailable', {
          user: logUser(ctx),
          event_id: id,
          status: error.status,
        });
        await sendLong(
          ctx,
          'Похожие события сейчас недоступны. Вернитесь к карточке или в меню.',
          backToMenuKeyboard(issueFor(ctx)),
        );
        return;
      }
      throw error;
    }

    if (response.items.length === 0) {
      await sendLong(ctx, 'Похожих событий пока нет.', backToMenuKeyboard(issueFor(ctx)));
      return;
    }

    logger.info('similar_done', {
      user: logUser(ctx),
      event_id: id,
      page: response.page,
      total: response.total,
    });
    await sendLong(
      ctx,
      formatSimilarResults(response, directories),
      similarResultsKeyboard(
        response.items,
        id,
        response.page,
        response.total_pages,
        issueFor(ctx),
      ),
    );
  }

  async function showSubscriptions(ctx: Context): Promise<void> {
    await typing(ctx);
    const subscriptions = await api.listSubscriptions(userRefFor(ctx));
    await sendLong(
      ctx,
      formatSubscriptionsList(subscriptions, directories),
      subscriptionsKeyboard(subscriptions, issueFor(ctx), directories),
    );
  }

  async function showDraftSummary(
    ctx: Context,
    draft: SubscriptionDraft,
    prefix?: string,
  ): Promise<void> {
    const text = prefix
      ? `${prefix}\n\n${formatSubscriptionDraft(draft, directories)}`
      : formatSubscriptionDraft(draft, directories);
    await editOrSend(ctx, text, subscriptionDraftKeyboard(draft, issueFor(ctx), directories));
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
      `${formatSubscriptionDraft(draft, directories)}\n\nГород, категорию и период можно оставить любыми.`,
      subscriptionDraftKeyboard(draft, issueFor(ctx), directories),
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
        formatSubscriptionCreated(subscription, directories),
        subscriptionSavedKeyboard(issueFor(ctx)),
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        await sendLong(
          ctx,
          `${formatSubscriptionDraft(draft, directories)}\n\nТакая подписка уже оформлена. Измените настройки или откройте «Мои подписки».`,
          subscriptionDraftKeyboard(draft, issueFor(ctx), directories),
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
        formatSubscriptionCreated(subscription, directories),
        subscriptionSavedKeyboard(issueFor(ctx)),
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        await sendLong(
          ctx,
          `Подписка «${directories.categoryName(category) ?? category} · ${directories.cityName(city) ?? city}» уже есть.`,
          subscriptionSavedKeyboard(issueFor(ctx)),
        );
        return;
      }
      throw error;
    }
  }

  async function showSubscriptionEvents(ctx: Context, id: string): Promise<void> {
    await typing(ctx);
    const subscriptions = await api.listSubscriptions(userRefFor(ctx));
    const subscription = subscriptions.find((item) => item.id === id);
    if (!subscription) {
      await sendLong(ctx, SUBSCRIPTION_NOT_FOUND_TEXT, subscriptionSavedKeyboard(issueFor(ctx)));
      return;
    }
    const city =
      subscription.city && directories.isCityId(subscription.city) ? subscription.city : null;
    const category =
      subscription.category && directories.isCategoryId(subscription.category)
        ? subscription.category
        : null;
    logger.info('subscription_opened', {
      user: logUser(ctx),
      subscription_id: subscription.id,
    });
    await startSearch(ctx, {
      city,
      category,
      date: subscription.period,
    });
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
      `${SUBSCRIPTION_DELETED_TEXT}\n\n${formatSubscriptionsList(subscriptions, directories)}`,
      subscriptionsKeyboard(subscriptions, issueFor(ctx), directories),
    );
  }

  async function openPicker(
    ctx: Context,
    field: 'city' | 'category' | 'period',
    page = 1,
  ): Promise<void> {
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
        cityChoiceKeyboard(draft.city, issueFor(ctx), directories, page),
      );
    } else if (field === 'category') {
      await editOrSend(
        ctx,
        '🎭 Выберите категорию для подписки:',
        categoryChoiceKeyboard(draft.category, issueFor(ctx), directories, page),
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
      await editOrSend(ctx, FILTERS_TITLE, filtersKeyboard(state, issueFor(ctx), directories));
    } else {
      await sendLong(ctx, FILTERS_TITLE, filtersKeyboard(state, issueFor(ctx), directories));
    }
  }

  async function handleMenu(ctx: Context, target: string, page?: number): Promise<void> {
    const userId = userIdOf(ctx);
    const directoryPage = page ?? 1;
    const sendCatalog = async (
      title: string,
      keyboard: ReturnType<typeof mainMenuKeyboard>,
    ): Promise<void> => {
      // Перелистывание справочника редактирует текущее сообщение, чтобы
      // десяток нажатий «Ещё» не превращался в десяток новых сообщений.
      if (page === undefined) await sendLong(ctx, title, keyboard);
      else await editOrSend(ctx, title, keyboard);
    };
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
        await sendCatalog(
          CATEGORIES_TITLE,
          categoriesKeyboard(issueFor(ctx), directories, 'search', directoryPage),
        );
        return;
      case 'cities':
        sessions.update(userId, (session) => {
          session.awaitingQuery = false;
        });
        await sendCatalog(
          CITIES_TITLE,
          citiesKeyboard(issueFor(ctx), directories, 'search', directoryPage),
        );
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
      case 'rangeMenu':
        await editOrSend(
          ctx,
          '📆 Выберите начало периода. Потом — конец, не дальше 31 дня.',
          rangeStartKeyboard(state.dateFrom, issueFor(ctx)),
        );
        return;
      case 'rangeStart':
        if (!isIsoDate(callback.date)) {
          throw new Error('Некорректная дата начала периода в callback');
        }
        sessions.update(userId, (session) => {
          session.rangeDraftStart = callback.date;
        });
        await editOrSend(
          ctx,
          '📆 Теперь выберите конец периода.',
          rangeEndKeyboard(callback.date, issueFor(ctx)),
        );
        return;
      case 'rangeEnd': {
        if (!isIsoDate(callback.date)) {
          throw new Error('Некорректная дата конца периода в callback');
        }
        const start = sessions.get(userId).rangeDraftStart ?? state.dateFrom;
        if (!start) {
          await editOrSend(
            ctx,
            '📆 Сначала выберите начало периода.',
            rangeStartKeyboard(null, issueFor(ctx)),
          );
          return;
        }
        const days = rangeDays(start, callback.date);
        if (days === null || days > RANGE_MAX_DAYS) {
          await editOrSend(
            ctx,
            `Конец периода должен быть не раньше начала и не дальше ${RANGE_MAX_DAYS} дней.`,
            rangeEndKeyboard(start, issueFor(ctx)),
          );
          return;
        }
        await applyFilters(ctx, {
          date: null,
          dateFrom: start,
          dateTo: callback.date,
        });
        return;
      }
      case 'ageMenu':
        await editOrSend(
          ctx,
          '👶 Возраст посетителя:',
          ageKeyboard(state.age, issueFor(ctx), state.facets),
        );
        return;
      case 'sortMenu':
        await editOrSend(ctx, '🔀 Как отсортировать события:', sortKeyboard(state.sort, issueFor(ctx)));
        return;
      case 'languageMenu':
        await editOrSend(
          ctx,
          '🌐 Язык мероприятия:',
          languageKeyboard(state.language, issueFor(ctx)),
        );
        return;
      case 'cityMenu':
        await editOrSend(
          ctx,
          CITIES_TITLE,
          citiesKeyboard(issueFor(ctx), directories, 'filter', callback.page, state.facets),
        );
        return;
      case 'categoryMenu':
        await editOrSend(
          ctx,
          CATEGORIES_TITLE,
          categoriesKeyboard(issueFor(ctx), directories, 'filter', callback.page, state.facets),
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
        await applyFilters(ctx, { date: callback.date, dateFrom: null, dateTo: null });
        return;
      case 'setAge':
        if (callback.age !== null && !isAgeOption(callback.age)) {
          throw new Error('Некорректный возраст в callback');
        }
        await applyFilters(ctx, { age: callback.age });
        return;
      case 'setSort':
        if (!isSearchSort(callback.sort)) {
          throw new Error('Некорректная сортировка в callback');
        }
        await applyFilters(ctx, { sort: callback.sort });
        return;
      case 'setLanguage':
        if (callback.language !== null && !isLanguageCode(callback.language)) {
          throw new Error('Некорректный язык в callback');
        }
        await applyFilters(ctx, { language: callback.language });
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
        if (callback.city !== null && !directories.isCityId(callback.city)) {
          await staleMenu(ctx);
          return;
        }
        await applyFilters(ctx, { city: callback.city });
        return;
      case 'setCategory':
        if (callback.category !== null && !directories.isCategoryId(callback.category)) {
          await staleMenu(ctx);
          return;
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
        if (callback.field === 'date' || callback.field === 'all') {
          patch.date = null;
          patch.dateFrom = null;
          patch.dateTo = null;
        }
        if (callback.field === 'range' || callback.field === 'all') {
          patch.dateFrom = null;
          patch.dateTo = null;
        }
        if (callback.field === 'price' || callback.field === 'all') {
          patch.priceMax = null;
          patch.freeOnly = false;
        }
        if (callback.field === 'age' || callback.field === 'all') patch.age = null;
        if (callback.field === 'language' || callback.field === 'all') patch.language = null;
        if (callback.field === 'venue' || callback.field === 'all') patch.venueId = null;
        if (callback.field === 'all') patch.sort = 'date';
        const next = { ...state, ...patch, page: 1 };
        sessions.update(userId, (session) => {
          session.search = next;
        });
        await loadAndSendPage(ctx, next);
        return;
      }
      default:
        await staleMenu(ctx);
    }
  }

  async function staleMenu(ctx: Context): Promise<void> {
    await sendLong(ctx, STALE_BUTTON_TEXT, mainMenuKeyboard(issueFor(ctx), { publicWebUrl }));
  }

  async function handleCallback(ctx: Context, callback: Callback): Promise<void> {
    const userId = userIdOf(ctx);

    switch (callback.type) {
      case 'menu':
        await handleMenu(ctx, callback.target, callback.page);
        return;
      case 'search':
        if (callback.action === 'category') {
          if (!directories.isCategoryId(callback.id)) {
            await staleMenu(ctx);
            return;
          }
          sessions.update(userId, (session) => {
            session.search = null;
          });
          await startSearch(ctx, { category: callback.id });
        } else if (callback.action === 'city') {
          if (!directories.isCityId(callback.id)) {
            await staleMenu(ctx);
            return;
          }
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
        await showEventCard(ctx, callback.id, callback.page, callback.occurrenceId ?? null);
        return;
      case 'sessions':
        await showSessions(ctx, callback.id);
        return;
      case 'offers':
        await showOffers(ctx, callback.id);
        return;
      case 'calendar':
        await sendCalendar(ctx, callback.id, callback.occurrenceId ?? null);
        return;
      case 'venue':
        await showVenueSchedule(ctx, callback.venueId, callback.date ?? null);
        return;
      case 'relax': {
        const current = currentSearch(ctx);
        if (!current) {
          await staleMenu(ctx);
          return;
        }
        const relaxation = callback.relaxation;
        logger.info('relaxation_applied', {
          user: logUser(ctx),
          code: relaxation.code,
          count: relaxation.count,
        });
        await loadAndSendPage(ctx, {
          ...current,
          ...relaxationPatch(relaxation),
          page: 1,
        });
        return;
      }
      case 'assistant':
        if (callback.action === 'chip') {
          await runAssistant(ctx, { patch: { unset: callback.unset } });
        } else if (callback.action === 'reply') {
          await runAssistant(ctx, {
            message: callback.text,
            answering: callback.answering,
          });
        } else if (callback.action === 'relax') {
          const base = currentSearch(ctx) ?? createSearchState();
          await loadAndSendPage(ctx, {
            ...base,
            ...relaxationPatch(callback.relaxation),
            page: 1,
          });
        } else if (callback.action === 'confirm') {
          await confirmAssistantAction(ctx, callback.id, callback.decision);
        } else {
          const lastMessage = sessions.get(userId).assistant.lastMessage;
          if (lastMessage) {
            await startSearch(ctx, { q: lastMessage });
          } else {
            await sendLong(
              ctx,
              ASSISTANT_UNAVAILABLE_TEXT,
              mainMenuKeyboard(issueFor(ctx), { publicWebUrl }),
            );
          }
        }
        return;
      case 'similar':
        await showSimilar(ctx, callback.id, callback.page);
        return;
      case 'subscribe':
        await handleSubscribe(ctx, callback);
        return;
      case 'subscriptions':
        if (callback.action === 'show') {
          await showSubscriptionEvents(ctx, callback.id);
        } else {
          await deleteSubscription(ctx, callback.id);
        }
        return;
      default:
        await staleMenu(ctx);
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
      if (!directories.isCityId(callback.city) || !directories.isCategoryId(callback.category)) {
        await staleMenu(ctx);
        return;
      }
      await quickSubscribe(ctx, callback.city, callback.category);
      return;
    }
    if (callback.action === 'event') {
      await typing(ctx);
      let event;
      try {
        event = await api.getEvent(callback.id);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          logger.info('event_not_found', { event_id: callback.id, user: logUser(ctx) });
          await sendLong(
            ctx,
            'Событие не найдено. Возможно, оно уже прошло или было отменено.',
            backToMenuKeyboard(issueFor(ctx)),
          );
          return;
        }
        throw error;
      }
      if (directories.isCityId(event.city_id) && directories.isCategoryId(event.category)) {
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
      await openPicker(ctx, callback.field, callback.page);
      return;
    }

    if (callback.action === 'summary') {
      await showDraftSummary(ctx, draft);
      return;
    }

    if (callback.action === 'city' && callback.id !== null && !directories.isCityId(callback.id)) {
      await staleMenu(ctx);
      return;
    }
    if (
      callback.action === 'category' &&
      callback.id !== null &&
      !directories.isCategoryId(callback.id)
    ) {
      await staleMenu(ctx);
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

  function assistantConfirmationsEnabled(): boolean {
    return config.assistantConfirmations === true;
  }

  /**
   * Ошибки, при которых ассистенту нельзя доверять: метода нет, стенд старый,
   * контракт не совпал или сервис недоступен. 429 сюда не входит — это не
   * поломка, а просьба подождать, и обычный поиск её не обходит.
   */
  function isAssistantFallback(error: unknown): boolean {
    if (!(error instanceof ApiError)) return false;
    if (error.kind === 'network' || error.kind === 'timeout' || error.kind === 'contract') {
      return true;
    }
    return (
      error.status === 400 ||
      error.status === 404 ||
      error.status === 405 ||
      (error.status !== null && error.status >= 500 && error.status <= 599)
    );
  }

  async function runAssistant(
    ctx: Context,
    input: {
      message?: string;
      patch?: { reset?: boolean; set?: Record<string, unknown>; unset?: string[] };
      answering?: string | null;
    },
  ): Promise<void> {
    const userId = userIdOf(ctx);
    const assistant = sessions.get(userId).assistant;
    const startedAt = Date.now();
    await typing(ctx);

    let response;
    try {
      response = await api.queryAssistant({
        ...(input.message ? { message: input.message.slice(0, 1000) } : {}),
        previous: assistant.previous,
        patch: input.patch ?? null,
        answering: input.answering ?? null,
        history: assistant.history.slice(-12),
        limit: 6,
        user_ref: userRefFor(ctx),
        channel: 'telegram',
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 429) {
        logger.info('assistant_rate_limited', { user: logUser(ctx) });
        await sendLong(
          ctx,
          rateLimitedText(60),
          mainMenuKeyboard(issueFor(ctx), { publicWebUrl }),
        );
        return;
      }
      if (isAssistantFallback(error)) {
        logger.info('assistant_fallback', {
          user: logUser(ctx),
          status: error instanceof ApiError ? error.status : null,
          kind: error instanceof ApiError ? error.kind : 'unknown',
        });
        if (input.message) {
          await startSearch(ctx, { q: input.message.slice(0, MAX_QUERY_LENGTH) });
        } else {
          await sendLong(
            ctx,
            ASSISTANT_UNAVAILABLE_TEXT,
            mainMenuKeyboard(issueFor(ctx), { publicWebUrl }),
          );
        }
        return;
      }
      throw error;
    }

    sessions.update(userId, (session) => {
      session.assistant.previous = response.constraints;
      session.assistant.clarifyCode = response.clarify?.code ?? null;
      if (input.message) {
        session.assistant.lastMessage = input.message;
        session.assistant.history.push({ role: 'user', content: input.message.slice(0, 1000) });
        session.assistant.history.push({
          role: 'assistant',
          content: response.message.slice(0, 1000),
        });
        if (session.assistant.history.length > 12) {
          session.assistant.history.splice(0, session.assistant.history.length - 12);
        }
      }
    });

    logger.info('assistant_done', {
      user: logUser(ctx),
      action: response.action,
      engine: response.engine,
      trace_id: response.trace_id,
      latency_ms: Date.now() - startedAt,
      results: response.results.length,
      total: response.total,
    });

    let text = formatAssistantResponse(response, directories);
    if (response.action === 'confirmation_required' && !assistantConfirmationsEnabled()) {
      text += `\n\n${ASSISTANT_CONFIRMATIONS_OFF_TEXT}`;
    }
    await sendLong(
      ctx,
      text,
      assistantKeyboard(response, issueFor(ctx), {
        confirmationsEnabled: assistantConfirmationsEnabled(),
      }),
    );
  }

  async function confirmAssistantAction(
    ctx: Context,
    id: string,
    decision: 'approve' | 'reject',
  ): Promise<void> {
    if (!assistantConfirmationsEnabled()) {
      await sendLong(
        ctx,
        ASSISTANT_CONFIRMATIONS_OFF_TEXT,
        mainMenuKeyboard(issueFor(ctx), { publicWebUrl }),
      );
      return;
    }

    await typing(ctx);
    let result: { status?: string; message?: string } = {};
    try {
      result = await api.confirmAssistant(id, decision, userRefFor(ctx));
      logger.info('assistant_confirmed', {
        user: logUser(ctx),
        decision,
        status: result.status ?? null,
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 429) {
        logger.info('assistant_rate_limited', { user: logUser(ctx), stage: 'confirm' });
        await sendLong(
          ctx,
          rateLimitedText(60),
          mainMenuKeyboard(issueFor(ctx), { publicWebUrl }),
        );
        return;
      }
      if (
        error instanceof ApiError &&
        (error.status === 404 || error.status === 409 || error.status === 410)
      ) {
        logger.info('assistant_confirmation_stale', {
          user: logUser(ctx),
          status: error.status,
        });
        await sendLong(
          ctx,
          ASSISTANT_CONFIRMATION_STALE_TEXT,
          mainMenuKeyboard(issueFor(ctx), { publicWebUrl }),
        );
        return;
      }
      if (isAssistantFallback(error)) {
        logger.info('assistant_fallback', {
          user: logUser(ctx),
          status: error instanceof ApiError ? error.status : null,
          kind: error instanceof ApiError ? error.kind : 'unknown',
          stage: 'confirm',
        });
        await sendLong(
          ctx,
          ASSISTANT_UNAVAILABLE_TEXT,
          mainMenuKeyboard(issueFor(ctx), { publicWebUrl }),
        );
        return;
      }
      throw error;
    }

    await sendLong(
      ctx,
      decision === 'reject' || result.status === 'rejected'
        ? ASSISTANT_CONFIRMATION_REJECTED_TEXT
        : ASSISTANT_CONFIRMATION_DONE_TEXT,
      mainMenuKeyboard(issueFor(ctx), { publicWebUrl }),
    );
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

    if (config.assistantEnabled) {
      const message = text.slice(0, ASSISTANT_MAX_MESSAGE_LENGTH).trim();
      logger.info('text_query', {
        user: logUser(ctx),
        length: message.length,
        truncated: text.length > ASSISTANT_MAX_MESSAGE_LENGTH,
        assistant: true,
      });
      await runAssistant(ctx, {
        message,
        answering: session.assistant.clarifyCode,
      });
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
      await applyFilters(ctx, { date: null, dateFrom: null, dateTo: null });
      return;
    }
    const range = parseIsoRange(value);
    if (range) {
      await applyFilters(ctx, {
        date: null,
        dateFrom: range.from,
        dateTo: range.to,
      });
      return;
    }
    if (/\.\.|—|–/.test(value)) {
      await sendLong(
        ctx,
        `Не понял период. Укажите две даты через «..», например /date 2026-11-20..2026-11-25. Максимум — 31 день.`,
        backToMenuKeyboard(issueFor(ctx)),
      );
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
    await applyFilters(ctx, { date: value, dateFrom: null, dateTo: null });
  }

  async function applyAgeCommand(ctx: Context, value: string): Promise<void> {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      const state = currentSearch(ctx) ?? createSearchState();
      await sendLong(
        ctx,
        '👶 Возраст посетителя:',
        ageKeyboard(state.age, issueFor(ctx), state.facets),
      );
      return;
    }
    if (normalized === 'any' || normalized === 'любой' || normalized === 'сброс') {
      await applyFilters(ctx, { age: null });
      return;
    }
    if (!/^\d{1,3}$/.test(normalized) || !isAgeOption(Number(normalized))) {
      await sendLong(
        ctx,
        `Не понял возраст. Доступны: ${AGE_OPTIONS.join(', ')} или any.`,
        backToMenuKeyboard(issueFor(ctx)),
      );
      return;
    }
    await applyFilters(ctx, { age: Number(normalized) });
  }

  async function applySortCommand(ctx: Context, value: string): Promise<void> {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      const state = currentSearch(ctx) ?? createSearchState();
      await sendLong(ctx, '🔀 Как отсортировать события:', sortKeyboard(state.sort, issueFor(ctx)));
      return;
    }
    if (normalized === 'any' || normalized === 'сброс') {
      await applyFilters(ctx, { sort: 'date' });
      return;
    }
    if (!isSearchSort(normalized)) {
      await sendLong(
        ctx,
        'Не понял сортировку. Доступны: date (по дате), price (по цене), popularity (по популярности).',
        backToMenuKeyboard(issueFor(ctx)),
      );
      return;
    }
    await applyFilters(ctx, { sort: normalized });
  }

  async function applyLanguageCommand(ctx: Context, value: string): Promise<void> {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      const state = currentSearch(ctx) ?? createSearchState();
      await sendLong(
        ctx,
        '🌐 Язык мероприятия:',
        languageKeyboard(state.language, issueFor(ctx)),
      );
      return;
    }
    if (normalized === 'any' || normalized === 'любой' || normalized === 'сброс') {
      await applyFilters(ctx, { language: null });
      return;
    }
    if (!isLanguageCode(normalized)) {
      await sendLong(
        ctx,
        'Не понял язык. Доступны: ru (русский), ba (башкирский), tt (татарский) или any.',
        backToMenuKeyboard(issueFor(ctx)),
      );
      return;
    }
    await applyFilters(ctx, { language: normalized });
  }

  async function applyCityCommand(ctx: Context, value: string): Promise<void> {
    if (value === 'any' || value === 'все' || value === 'сброс') {
      await applyFilters(ctx, { city: null });
      return;
    }
    const city = directories.findCityId(value);
    if (!city) {
      await sendLong(
        ctx,
        `Не знаю город «${escapeHtml(value)}». Доступны: ${directories.cities.map((city) => city.name).join(', ')}.`,
        citiesKeyboard(issueFor(ctx), directories, 'filter'),
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
    const category = directories.findCategoryId(value);
    if (!category) {
      await sendLong(
        ctx,
        `Не знаю категорию «${escapeHtml(value)}». Доступны: ${directories.categories.map((category) => category.name.toLowerCase()).join(', ')}.`,
        categoriesKeyboard(issueFor(ctx), directories, 'filter'),
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
    const payload = (ctx.match ?? '').trim();
    sessions.reset(userIdOf(ctx));
    if (payload.startsWith('event_')) {
      const eventId = payload.slice('event_'.length);
      if (!isEventUuid(eventId)) {
        await safely(ctx, () => sendStart(ctx));
        return;
      }
      await safely(ctx, async () => {
        logger.info('deep_link_event', { user: logUser(ctx), event_id: eventId });
        await showEventCard(ctx, eventId, null);
      });
      return;
    }
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
      await safely(ctx, () =>
        applyFilters(ctx, { date: preset, dateFrom: null, dateTo: null }),
      );
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
          citiesKeyboard(issueFor(ctx), directories, currentSearch(ctx) ? 'filter' : 'search'),
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
          categoriesKeyboard(issueFor(ctx), directories, currentSearch(ctx) ? 'filter' : 'search'),
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

  bot.command('age', async (ctx) => {
    await safely(ctx, async () => {
      await applyAgeCommand(ctx, commandArgument(ctx));
    });
  });

  bot.command('sort', async (ctx) => {
    await safely(ctx, async () => {
      await applySortCommand(ctx, commandArgument(ctx));
    });
  });

  bot.command('language', async (ctx) => {
    await safely(ctx, async () => {
      await applyLanguageCommand(ctx, commandArgument(ctx));
    });
  });

  bot.command('categories', async (ctx) => {
    await safely(ctx, async () => {
      await sendLong(ctx, CATEGORIES_TITLE, categoriesKeyboard(issueFor(ctx), directories));
    });
  });

  bot.command('cities', async (ctx) => {
    await safely(ctx, async () => {
      await sendLong(ctx, CITIES_TITLE, citiesKeyboard(issueFor(ctx), directories));
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
        await staleMenu(ctx);
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
