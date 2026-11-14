import { describe, expect, it, vi } from 'vitest';
import type { Update } from 'grammy/types';

import { ApiError, type ApiClient, type AssistantQueryInput, type CreateSubscriptionInput, type SearchEventsParams } from '../src/api/client.js';
import type { AssistantResponse, EventListResponse, Subscription } from '../src/api/types.js';
import { CallbackStore } from '../src/callback-store.js';
import type { Callback } from '../src/callbacks.js';
import { createBot } from '../src/bot.js';
import type { BotConfig } from '../src/config.js';
import { DirectoryService } from '../src/directory-service.js';
import { createLogger, type LogSink } from '../src/logger.js';
import { SessionStore } from '../src/session.js';
import { BOT_COMMANDS } from '../src/texts.js';
import { telegramUserRef } from '../src/user-ref.js';
import { EVENT_ID, EVENT_ID_2, makeAssistantResponse, makeEvent, makeListItem, makeListResponse, makeOccurrence } from './fixtures.js';

const TOKEN = '12345:AAHfake_token_for_tests_1234567890';
const USER = {
  id: 123,
  is_bot: false,
  first_name: 'Тест',
  username: 'tester',
} as const;
const CHAT = { id: USER.id, type: 'private' } as const;
const BOT_INFO = {
  id: 999,
  is_bot: true,
  first_name: 'Afisha',
  username: 'afisha_test_bot',
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
};

const CONFIG: BotConfig = {
  telegramBotToken: TOKEN,
  apiBaseUrl: 'http://api.test',
  apiTimeoutMs: 1000,
  logLevel: 'error',
  publicWebUrl: 'https://afisha-rb.ru',
  sessionTtlMs: 60_000,
  callbackTtlMs: 60_000,
  rateLimitPerMinute: 1000,
  brandImagePath: null,
};

const USER_REF = telegramUserRef(USER.id, { mode: 'hmac', secret: TOKEN });

interface ApiCall {
  method: string;
  payload: Record<string, unknown>;
}

interface KeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

function messageUpdate(text: string, updateId = 1): Update {
  const commandLength = text.startsWith('/') ? (text.split(/\s/, 1)[0]?.length ?? 0) : 0;
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: 1_760_000_000,
      chat: CHAT,
      from: USER,
      text,
      ...(commandLength > 0
        ? { entities: [{ type: 'bot_command', offset: 0, length: commandLength }] }
        : {}),
    },
  } as unknown as Update;
}

function callbackUpdate(data: string, updateId = 10): Update {
  return {
    update_id: updateId,
    callback_query: {
      id: `callback-${updateId}`,
      from: USER,
      chat_instance: 'test-instance',
      data,
      message: {
        message_id: updateId,
        date: 1_760_000_000,
        chat: CHAT,
        from: BOT_INFO,
        text: 'предыдущее сообщение',
      },
    },
  } as unknown as Update;
}

function makeStubApi() {
  let subscriptions: Subscription[] = [];
  let createdCount = 0;

  const searchEvents = vi.fn(async (params: SearchEventsParams = {}): Promise<EventListResponse> => {
    const page = params.page ?? 1;
    const items =
      page === 1
        ? [makeListItem()]
        : [makeListItem({ id: EVENT_ID_2, title: 'Второе событие', category: 'performance' })];
    return makeListResponse(items, {
      page,
      page_size: 5,
      total: 2,
      total_pages: 2,
    });
  });

  const getEvent = vi.fn(async (id: string) =>
    id === EVENT_ID_2
      ? makeEvent({ id: EVENT_ID_2, title: 'Второе событие', category: 'performance' })
      : makeEvent(),
  );

  const getSimilarEvents = vi.fn(async (): Promise<EventListResponse> =>
    makeListResponse(
      [makeListItem({ id: EVENT_ID_2, title: 'Второе событие', category: 'performance' })],
      { page: 1, page_size: 5, total: 1, total_pages: 1 },
    ),
  );

  const createSubscription = vi.fn(async (input: CreateSubscriptionInput): Promise<Subscription> => {
    createdCount += 1;
    const subscription: Subscription = {
      id: `44444444-4444-4444-8444-44444444444${createdCount}`,
      channel: 'telegram',
      user_ref: input.user_ref,
      city: input.city,
      category: input.category,
      period: input.period,
      created_at: '2026-11-13T10:00:00+05:00',
    };
    subscriptions = [subscription, ...subscriptions];
    return subscription;
  });

  const listSubscriptions = vi.fn(async () => subscriptions);
  const deleteSubscription = vi.fn(async (id: string) => {
    subscriptions = subscriptions.filter((item) => item.id !== id);
  });
  const health = vi.fn(async () => ({ status: 'ok' }));
  const getCities = vi.fn(async () => [{ id: 'ufa', name: 'Уфа' }]);
  const getCategories = vi.fn(async () => [{ id: 'concert', name: 'Концерт' }]);
  const getVenueSchedule = vi.fn(async () => ({
    venue: {
      id: 'demo-hall-1',
      name: 'Демо-площадка «Зал № 1»',
      city_id: 'ufa',
      city: 'Уфа',
      address: 'ул. Примерная, 1',
    },
    date_from: '2026-11-20',
    date_to: '2026-12-04',
    items: [],
  }));

  const queryAssistant = vi.fn(
    async (_input: AssistantQueryInput): Promise<AssistantResponse> => makeAssistantResponse(),
  );
  const confirmAssistant = vi.fn(async () => ({ status: 'ok' }));

  const api: ApiClient = {
    health,
    searchEvents,
    getEvent,
    getSimilarEvents,
    getVenueSchedule,
    getCities,
    getCategories,
    listSubscriptions,
    createSubscription,
    deleteSubscription,
    queryAssistant,
    confirmAssistant,
  };

  return {
    api,
    searchEvents,
    getEvent,
    getSimilarEvents,
    getVenueSchedule,
    createSubscription,
    listSubscriptions,
    deleteSubscription,
    queryAssistant,
    confirmAssistant,
    setSubscriptions: (items: Subscription[]) => {
      subscriptions = items;
    },
  };
}

interface HarnessOptions {
  config?: Partial<BotConfig>;
  logSink?: LogSink;
  failPhoto?: boolean;
  directories?: DirectoryService;
}

async function makeHarness(options: HarnessOptions = {}) {
  const stub = makeStubApi();
  const calls: ApiCall[] = [];
  const sessions = new SessionStore();
  const callbacks = new CallbackStore({ ttlMs: 60_000 });
  const sink = options.logSink ?? { log: () => {}, error: () => {} };
  const logger = createLogger('debug', sink);
  const config: BotConfig = { ...CONFIG, ...options.config };
  const directories = options.directories ?? new DirectoryService();
  const bot = createBot(TOKEN, {
    api: stub.api,
    sessions,
    config,
    logger,
    callbacks,
    directories,
  });

  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    if (method === 'getMe') return { ok: true, result: BOT_INFO } as never;
    if (method === 'sendPhoto' && options.failPhoto) {
      throw new Error('photo upload failed');
    }
    if (method === 'sendMessage' || method === 'editMessageText' || method === 'sendPhoto') {
      return {
        ok: true,
        result: {
          message_id: calls.length,
          date: 1_760_000_000,
          chat: CHAT,
          text: String(
            (payload as Record<string, unknown>).text ??
              (payload as Record<string, unknown>).caption ??
              '',
          ),
        },
      } as never;
    }
    return { ok: true, result: true } as never;
  });

  await bot.init();

  async function run(update: Update): Promise<void> {
    await bot.handleUpdate(update);
  }

  async function press(callback: Callback, updateId = 10): Promise<void> {
    const data = callbacks.issue(USER.id, callback);
    await run(callbackUpdate(data, updateId));
  }

  function lastKeyboard(): KeyboardButton[] {
    for (let index = calls.length - 1; index >= 0; index -= 1) {
      const markup = calls[index]?.payload.reply_markup as
        | { inline_keyboard?: KeyboardButton[][] }
        | undefined;
      if (markup?.inline_keyboard) return markup.inline_keyboard.flat();
    }
    return [];
  }

  async function pressButton(label: string, updateId = 10): Promise<void> {
    const button = lastKeyboard().find((item) => item.text === label);
    if (!button?.callback_data) throw new Error(`Кнопка не найдена: ${label}`);
    await run(callbackUpdate(button.callback_data, updateId));
  }

  function sentTexts(): string[] {
    return calls
      .filter((call) => call.method === 'sendMessage')
      .map((call) => String(call.payload.text ?? ''));
  }

  function captions(): string[] {
    return calls
      .filter((call) => call.method === 'sendPhoto')
      .map((call) => String(call.payload.caption ?? ''));
  }

  function editedTexts(): string[] {
    return calls
      .filter((call) => call.method === 'editMessageText')
      .map((call) => String(call.payload.text ?? ''));
  }

  function lastText(): string {
    const sent = calls.filter(
      (call) => call.method === 'sendMessage' || call.method === 'sendPhoto',
    );
    const last = sent[sent.length - 1];
    return String(last?.payload.text ?? last?.payload.caption ?? '');
  }

  function keyboardButtons(): string[] {
    return lastKeyboard().map((button) => button.text);
  }

  function answerTexts(): string[] {
    return calls
      .filter((call) => call.method === 'answerCallbackQuery')
      .map((call) => String(call.payload.text ?? ''));
  }

  return {
    ...stub,
    bot,
    sessions,
    callbacks,
    calls,
    run,
    press,
    pressButton,
    sentTexts,
    captions,
    editedTexts,
    lastText,
    keyboardButtons,
    lastKeyboard,
    answerTexts,
  };
}

describe('сценарии бота', () => {
  it('/start показывает короткое приветствие, дисклеймер и меню', async () => {
    const harness = await makeHarness();
    harness.sessions.update(USER.id, (session) => {
      session.awaitingQuery = true;
    });

    await harness.run(messageUpdate('/start'));

    const text = harness.lastText();
    expect(text).toContain('бот афиши культуры Башкортостана');
    expect(text).toContain('Сервис неофициальный');
    expect(text).toContain('уточняйте у организатора');
    expect(harness.keyboardButtons()).toEqual(
      expect.arrayContaining([
        '🔍 Найти событие',
        '🎭 Категории',
        '🎛 Фильтры',
        '🔔 Мои подписки',
        'ℹ️ О сервисе',
      ]),
    );
    expect(harness.sessions.get(USER.id).awaitingQuery).toBe(false);
  });

  it('/start отправляет брендовый жетон, если картинка доступна', async () => {
    const harness = await makeHarness({ config: { brandImagePath: 'assets/token-height.png' } });
    await harness.run(messageUpdate('/start'));

    expect(harness.calls.some((call) => call.method === 'sendPhoto')).toBe(true);
    expect(harness.captions().at(-1)).toContain('бот афиши культуры Башкортостана');
    expect(harness.keyboardButtons()).toContain('🔍 Найти событие');
  });

  it('/start откатывается на текст, если картинку не удалось отправить', async () => {
    const harness = await makeHarness({
      config: { brandImagePath: 'assets/token-height.png' },
      failPhoto: true,
    });
    await harness.run(messageUpdate('/start'));

    expect(harness.calls.some((call) => call.method === 'sendPhoto')).toBe(true);
    expect(harness.calls.at(-1)?.method).toBe('sendMessage');
    expect(harness.lastText()).toContain('бот афиши культуры Башкортостана');
    expect(harness.keyboardButtons()).toContain('🔍 Найти событие');
  });

  it('/help перечисляет команды и текстовые эквиваленты', async () => {
    const harness = await makeHarness();
    await harness.run(messageUpdate('/help'));
    const text = harness.lastText();
    expect(text).toContain('/start');
    expect(text).toContain('/cancel');
    expect(text).toContain('/today');
    expect(text).toContain('/price');
    expect(text).toContain('/about');
    expect(text).toContain('Подписки');
  });

  it('свободный текст запускает поиск и показывает «Показать ещё»', async () => {
    const harness = await makeHarness();
    await harness.run(messageUpdate('музыка'));

    expect(harness.searchEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        q: 'музыка',
        page: 1,
        page_size: 5,
        date: null,
        price_max: null,
        free: null,
      }),
    );
    const text = harness.lastText();
    expect(text).toContain('Поиск <b>«музыка»</b>');
    expect(text).toContain('Страница 1 из 2');
    expect(text).toContain('Вечер башкирской музыки');
    expect(harness.keyboardButtons()).toContain('Показать ещё ➡️');
  });

  it('«Показать ещё» открывает следующую страницу', async () => {
    const harness = await makeHarness();
    await harness.run(messageUpdate('музыка'));
    await harness.press({ type: 'search', action: 'page', page: 2 });

    expect(harness.searchEvents).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
    const text = harness.lastText();
    expect(text).toContain('Страница 2 из 2');
    expect(text).toContain('Второе событие');
    expect(harness.keyboardButtons()).toContain('⬅️ Назад');
    expect(harness.keyboardButtons()).not.toContain('Показать ещё ➡️');
    expect(harness.calls.some((call) => call.method === 'answerCallbackQuery')).toBe(true);
  });

  it('карточка события показывает данные, источник и билеты отдельно', async () => {
    const harness = await makeHarness();
    await harness.run(messageUpdate('музыка'));
    await harness.press({ type: 'event', id: EVENT_ID, page: 1 });

    expect(harness.getEvent).toHaveBeenCalledWith(EVENT_ID);
    const text = harness.lastText();
    expect(text).toContain('Вечер башкирской музыки');
    expect(text).toContain('500\u00A0₽–1\u00A0200\u00A0₽');
    expect(text).toContain('источник: afisha-rb.ru');
    expect(harness.keyboardButtons()).toContain('🎟 Билеты');
    expect(harness.keyboardButtons()).toContain('🌐 Источник');
    expect(harness.keyboardButtons()).toContain('🌐 На сайте');
    expect(harness.keyboardButtons()).toContain('🔔 Подписаться: Концерт · Уфа');
    expect(harness.keyboardButtons()).toContain('🎯 Похожие');
    expect(harness.keyboardButtons()).toContain('← К результатам');
  });

  it('кнопка «Похожие» открывает список и позволяет перейти к событию', async () => {
    const harness = await makeHarness();
    await harness.press({ type: 'similar', id: EVENT_ID, page: 1 });

    expect(harness.getSimilarEvents).toHaveBeenCalledWith(EVENT_ID, { page: 1, page_size: 5 });
    const text = harness.lastText();
    expect(text).toContain('🎯 <b>Похожие события</b> · найдено 1');
    expect(text).toContain('Второе событие');
    expect(harness.keyboardButtons()).toContain('1. Второе событие');
    expect(harness.keyboardButtons()).toContain('← К событию');
    expect(harness.keyboardButtons()).toContain('🏠 Меню');
  });

  it('если метода похожих нет в API, бот не падает и предлагает меню', async () => {
    const harness = await makeHarness();
    harness.getSimilarEvents.mockRejectedValueOnce(
      new ApiError('API 404 not_found', {
        kind: 'http',
        status: 404,
        code: 'not_found',
        userMessage: 'Не найдено',
      }),
    );
    await harness.press({ type: 'similar', id: EVENT_ID, page: 1 });

    const text = harness.lastText();
    expect(text).toContain('Похожие события сейчас недоступны');
    expect(harness.keyboardButtons()).toContain('🏠 В меню');
  });

  it('если событие исчезло, быстрая подписка из карточки не падает', async () => {
    const harness = await makeHarness();
    harness.getEvent.mockRejectedValueOnce(
      new ApiError('API 404 not_found', {
        kind: 'http',
        status: 404,
        code: 'not_found',
        userMessage: 'Не найдено',
      }),
    );
    await harness.press({ type: 'subscribe', action: 'event', id: EVENT_ID });

    expect(harness.lastText()).toContain('Событие не найдено');
    expect(harness.createSubscription).not.toHaveBeenCalled();
  });

  it('не показывает ссылки на битые demo-адреса', async () => {
    const harness = await makeHarness();
    harness.getEvent.mockResolvedValueOnce(
      makeEvent({
        org_link: 'https://example.com/tickets/1',
        source_url: 'http://localhost:3210/events/1',
      }),
    );
    await harness.press({ type: 'event', id: EVENT_ID, page: null });

    expect(harness.keyboardButtons()).not.toContain('🎟 Билеты');
    expect(harness.keyboardButtons()).not.toContain('🌐 Источник');
  });

  it('быстрая подписка из карточки создаёт подписку с telegram user_ref', async () => {
    const harness = await makeHarness();
    await harness.press({
      type: 'subscribe',
      action: 'quick',
      city: 'ufa',
      category: 'concert',
    });

    expect(harness.createSubscription).toHaveBeenCalledWith({
      channel: 'telegram',
      user_ref: USER_REF,
      city: 'ufa',
      category: 'concert',
      period: null,
    });
    const text = harness.lastText();
    expect(text).toContain('Подписка сохранена');
    expect(text).toContain('Концерт · Уфа');
  });

  it('повторная подписка объясняет конфликт', async () => {
    const harness = await makeHarness();
    await harness.press({ type: 'subscribe', action: 'quick', city: 'ufa', category: 'concert' });
    harness.createSubscription.mockRejectedValueOnce(
      new ApiError('API 409 conflict', {
        kind: 'http',
        status: 409,
        code: 'conflict',
        userMessage: 'Такая подписка уже оформлена.',
      }),
    );
    await harness.press(
      { type: 'subscribe', action: 'quick', city: 'ufa', category: 'concert' },
      11,
    );

    expect(harness.lastText()).toContain('уже есть');
  });

  it('меню подписок показывает список и удаляет по кнопке', async () => {
    const harness = await makeHarness();
    await harness.press({ type: 'subscribe', action: 'quick', city: 'ufa', category: 'concert' });
    const created = harness.createSubscription.mock.results[0]?.value;
    const id = (await created)?.id;
    expect(id).toBeTruthy();

    await harness.press({ type: 'menu', target: 'subs' }, 12);
    expect(harness.listSubscriptions).toHaveBeenCalled();
    expect(harness.lastText()).toContain('Ваши подписки (1)');
    expect(harness.lastText()).toContain('Концерт · Уфа');

    await harness.press({ type: 'subscriptions', action: 'delete', id: id as string }, 13);
    expect(harness.deleteSubscription).toHaveBeenCalledWith(id, USER_REF);
    expect(harness.lastText()).toContain('Подписка удалена');
    expect(harness.lastText()).toContain('Подписок пока нет');
  });

  it('конструктор подписки проходит шаги и сохраняет выбранный город', async () => {
    const harness = await makeHarness();
    await harness.press({ type: 'subscribe', action: 'add' }, 20);

    expect(harness.lastText()).toContain('Новая подписка');
    expect(harness.keyboardButtons()).toContain('✅ Сохранить');

    await harness.press({ type: 'subscribe', action: 'pick', field: 'city' }, 21);
    expect(harness.editedTexts().at(-1)).toContain('Выберите город');

    await harness.press({ type: 'subscribe', action: 'city', id: 'sibay' }, 22);
    expect(harness.editedTexts().at(-1)).toContain('Город: Сибай');

    await harness.press({ type: 'subscribe', action: 'save' }, 23);
    expect(harness.createSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ city: 'sibay', category: null, period: null }),
    );
    expect(harness.editedTexts().at(-1) ?? harness.lastText()).toContain('Подписка сохранена');
    expect(harness.sessions.get(USER.id).draft).toBeNull();
  });

  it('во время настройки подписки свободный текст не запускает поиск', async () => {
    const harness = await makeHarness();
    await harness.press({ type: 'subscribe', action: 'add' }, 30);
    await harness.run(messageUpdate('концерт', 31));

    expect(harness.searchEvents).not.toHaveBeenCalled();
    expect(harness.lastText()).toContain('настраиваете подписку');
  });

  it('/cancel очищает состояние', async () => {
    const harness = await makeHarness();
    await harness.run(messageUpdate('музыка'));
    await harness.run(messageUpdate('/cancel', 2));

    expect(harness.lastText()).toContain('Отменил');
    expect(harness.sessions.get(USER.id).search).toBeNull();
  });

  it('фильтры сохраняют запрос и применяют цену, дату и город', async () => {
    const harness = await makeHarness();
    await harness.run(messageUpdate('музыка'));

    await harness.press({ type: 'filter', action: 'open' }, 40);
    expect(harness.editedTexts().at(-1)).toContain('Фильтры поиска');

    await harness.press(
      { type: 'filter', action: 'setPrice', priceMax: 1000, freeOnly: false },
      41,
    );
    expect(harness.searchEvents).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: 'музыка', price_max: 1000, date: null }),
    );

    await harness.press({ type: 'filter', action: 'setDate', date: 'tomorrow' }, 42);
    expect(harness.searchEvents).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: 'музыка', date: 'tomorrow', price_max: 1000 }),
    );

    await harness.press({ type: 'filter', action: 'setCity', city: 'sibay' }, 43);
    expect(harness.searchEvents).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: 'музыка', city: 'sibay', date: 'tomorrow' }),
    );

    await harness.press({ type: 'filter', action: 'clear', field: 'all' }, 44);
    expect(harness.searchEvents).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: 'музыка', city: null, date: null, price_max: null, free: null }),
    );
  });

  it('дата-пикер применяет конкретный день', async () => {
    const harness = await makeHarness();
    await harness.run(messageUpdate('музыка'));
    await harness.press({ type: 'filter', action: 'dateMenu' }, 50);

    expect(harness.editedTexts().at(-1)).toContain('Выберите день');
    expect(harness.keyboardButtons()).toContain('✅ Любая дата');

    await harness.press({ type: 'filter', action: 'setDate', date: '2026-11-20' }, 51);
    expect(harness.searchEvents).toHaveBeenLastCalledWith(
      expect.objectContaining({ date: '2026-11-20' }),
    );
  });

  it('возраст, язык и сортировка уходят в API', async () => {
    const harness = await makeHarness();
    await harness.run(messageUpdate('музыка'));

    await harness.press({ type: 'filter', action: 'setAge', age: 6 }, 52);
    expect(harness.searchEvents).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: 'музыка', age: 6 }),
    );

    await harness.press({ type: 'filter', action: 'setLanguage', language: 'ba' }, 53);
    expect(harness.searchEvents).toHaveBeenLastCalledWith(
      expect.objectContaining({ age: 6, language: 'ba' }),
    );

    await harness.press({ type: 'filter', action: 'setSort', sort: 'price' }, 54);
    expect(harness.searchEvents).toHaveBeenLastCalledWith(
      expect.objectContaining({ language: 'ba', sort: 'price' }),
    );

    await harness.press({ type: 'filter', action: 'clear', field: 'all' }, 55);
    expect(harness.searchEvents).toHaveBeenLastCalledWith(
      expect.objectContaining({ age: null, language: null, sort: 'date' }),
    );
  });

  it('период дат собирается из двух шагов и заменяет пресет', async () => {
    const harness = await makeHarness();
    await harness.run(messageUpdate('музыка'));
    await harness.press({ type: 'filter', action: 'setDate', date: 'today' }, 56);

    await harness.press({ type: 'filter', action: 'rangeStart', date: '2026-11-20' }, 57);
    expect(harness.sessions.get(USER.id).rangeDraftStart).toBe('2026-11-20');
    expect(harness.editedTexts().at(-1)).toContain('Теперь выберите конец периода');

    await harness.press({ type: 'filter', action: 'rangeEnd', date: '2026-11-25' }, 58);
    expect(harness.searchEvents).toHaveBeenLastCalledWith(
      expect.objectContaining({
        date: null,
        date_from: '2026-11-20',
        date_to: '2026-11-25',
      }),
    );
    expect(harness.sessions.get(USER.id).rangeDraftStart).toBeNull();
  });

  it('не принимает конец периода раньше начала', async () => {
    const harness = await makeHarness();
    await harness.run(messageUpdate('музыка'));
    await harness.press({ type: 'filter', action: 'rangeStart', date: '2026-11-20' }, 59);
    await harness.press({ type: 'filter', action: 'rangeEnd', date: '2026-11-19' }, 60);

    expect(harness.editedTexts().at(-1)).toContain('не раньше начала');
    expect(harness.searchEvents).toHaveBeenCalledTimes(1);
  });

  it('серверное ослабление пустой выдачи запускает новый поиск', async () => {
    const harness = await makeHarness();
    await harness.run(messageUpdate('музыка'));
    harness.searchEvents.mockResolvedValueOnce(
      makeListResponse([], {
        page: 1,
        page_size: 5,
        total: 0,
        total_pages: 0,
        relaxations: [
          {
            code: 'date',
            codes: ['date'],
            label: 'Без даты',
            query: { date_from: '2026-11-20', date_to: '2026-11-25' },
            count: 7,
          },
        ],
      }),
    );

    await harness.press({ type: 'filter', action: 'setPrice', priceMax: 1000, freeOnly: false }, 61);
    expect(harness.lastText()).toContain('Без даты — 7');
    expect(harness.keyboardButtons()).toContain('Без даты · 7');

    await harness.pressButton('Без даты · 7', 62);
    expect(harness.searchEvents).toHaveBeenLastCalledWith(
      expect.objectContaining({
        q: 'музыка',
        date: null,
        date_from: '2026-11-20',
        date_to: '2026-11-25',
        price_max: 1000,
      }),
    );
  });

  it('deep link /start event_<uuid> открывает карточку события', async () => {
    const harness = await makeHarness();
    await harness.run(messageUpdate(`/start event_${EVENT_ID}`));

    expect(harness.getEvent).toHaveBeenCalledWith(EVENT_ID);
    expect(harness.lastText()).toContain('Вечер башкирской музыки');
    expect(harness.keyboardButtons()).toContain('📅 В календарь');
    expect(harness.keyboardButtons()).toContain('🎯 Похожие');
  });

  it('битый deep link показывает обычный /start', async () => {
    const harness = await makeHarness();
    await harness.run(messageUpdate('/start event_not-a-uuid'));

    expect(harness.getEvent).not.toHaveBeenCalled();
    expect(harness.lastText()).toContain('бот афиши культуры Башкортостана');
  });

  it('показывает все сеансы, тарифы и выбранный сеанс', async () => {
    const harness = await makeHarness();
    const detailed = makeEvent({
      occurrences: [
        makeOccurrence({ id: 'a', date_start: '2026-11-20T19:00:00+05:00' }),
        makeOccurrence({ id: 'b', date_start: '2026-11-21T21:00:00+05:00' }),
      ],
      offers: [{ name: 'Взрослый', price: 800, audience: 'adult', is_free: false }],
    });
    harness.getEvent.mockResolvedValue(detailed);

    await harness.press({ type: 'event', id: EVENT_ID, page: null }, 63);
    expect(harness.keyboardButtons()).toContain('📅 Все сеансы (2)');
    expect(harness.keyboardButtons()).toContain('🎟 Тарифы');

    await harness.press({ type: 'sessions', id: EVENT_ID }, 64);
    expect(harness.lastText()).toContain('Все сеансы');
    expect(harness.lastText()).toContain('20 ноября, пт, 19:00');
    expect(harness.lastText()).toContain('21 ноября, сб, 21:00');

    await harness.press({ type: 'offers', id: EVENT_ID }, 65);
    expect(harness.lastText()).toContain('Тарифы');
    expect(harness.lastText()).toContain('Взрослый — 800');

    await harness.press(
      { type: 'event', id: EVENT_ID, page: null, occurrenceId: 'b' },
      66,
    );
    expect(harness.lastText()).toContain('21 ноября, сб, 21:00');
    expect(harness.lastText()).toContain('сеанс 2 из 2');
  });

  it('отправляет .ics выбранного сеанса', async () => {
    const harness = await makeHarness();
    const detailed = makeEvent({
      occurrences: [
        makeOccurrence({ id: 'a', date_start: '2026-11-20T19:00:00+05:00' }),
        makeOccurrence({ id: 'b', date_start: '2026-11-21T21:00:00+05:00' }),
      ],
    });
    harness.getEvent.mockResolvedValue(detailed);

    await harness.press(
      { type: 'calendar', id: EVENT_ID, occurrenceId: 'b' },
      67,
    );

    const call = harness.calls.find((item) => item.method === 'sendDocument');
    expect(call).toBeTruthy();
    expect(String(call?.payload.caption)).toContain('Вечер башкирской музыки');
    expect(call?.payload.document).toBeTruthy();
  });

  it('не отправляет календарь для прошедшего или отменённого сеанса', async () => {
    const harness = await makeHarness();
    harness.getEvent.mockResolvedValue(
      makeEvent({
        occurrences: [makeOccurrence({ id: 'past', is_past: true })],
      }),
    );
    await harness.press({ type: 'calendar', id: EVENT_ID, occurrenceId: 'past' }, 68);
    expect(harness.lastText()).toContain('уже прошёл');
    expect(harness.calls.some((item) => item.method === 'sendDocument')).toBe(false);

    harness.getEvent.mockResolvedValue(
      makeEvent({ occurrences: [makeOccurrence({ id: 'cancelled', status: 'cancelled' })] }),
    );
    await harness.press({ type: 'calendar', id: EVENT_ID, occurrenceId: 'cancelled' }, 69);
    expect(harness.lastText()).toContain('отменён');
    expect(harness.calls.some((item) => item.method === 'sendDocument')).toBe(false);
  });

  it('не отправляет календарь для прошедшей даты без сеансов', async () => {
    const harness = await makeHarness();
    harness.getEvent.mockResolvedValue(
      makeEvent({
        occurrences: [],
        date_start: '2020-01-01T10:00:00+05:00',
        date_end: null,
      }),
    );

    await harness.press({ type: 'calendar', id: EVENT_ID, occurrenceId: null }, 72);

    expect(harness.lastText()).toContain('уже прошёл');
    expect(harness.calls.some((item) => item.method === 'sendDocument')).toBe(false);
  });

  it('открывает афишу площадки и мягко обрабатывает отсутствие метода', async () => {
    const harness = await makeHarness();
    await harness.press(
      { type: 'venue', venueId: 'demo-hall-1', date: '2026-11-20' },
      70,
    );
    expect(harness.getVenueSchedule).toHaveBeenCalledWith('demo-hall-1', {
      date_from: '2026-11-20',
      date_to: '2026-12-03',
    });
    expect(harness.lastText()).toContain('Демо-площадка');

    harness.getVenueSchedule.mockRejectedValueOnce(
      new ApiError('API 404 not_found', {
        kind: 'http',
        status: 404,
        code: 'not_found',
        userMessage: 'Не найдено',
      }),
    );
    await harness.press(
      { type: 'venue', venueId: 'demo-hall-1', date: '2026-11-20' },
      71,
    );
    expect(harness.lastText()).toContain('Расписание площадки пока недоступно');
  });

  it('переход из подписки открывает её события', async () => {
    const harness = await makeHarness();
    await harness.press(
      { type: 'subscribe', action: 'quick', city: 'ufa', category: 'concert' },
      72,
    );
    const created = await harness.createSubscription.mock.results[0]?.value;
    const id = created.id as string;
    harness.searchEvents.mockClear();

    await harness.press({ type: 'subscriptions', action: 'show', id }, 73);
    expect(harness.searchEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        city: 'ufa',
        category: 'concert',
        date: null,
        page: 1,
      }),
    );
  });

  it('USER_REF_MODE=legacy возвращает старый user_ref для отката', async () => {
    const harness = await makeHarness({ config: { userRefMode: 'legacy' } });
    await harness.press(
      { type: 'subscribe', action: 'quick', city: 'ufa', category: 'concert' },
      74,
    );
    expect(harness.createSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ user_ref: 'telegram_00000123' }),
    );
  });

  it('пустая выдача предлагает ослабить фильтры', async () => {
    const harness = await makeHarness();
    await harness.run(messageUpdate('музыка'));
    harness.searchEvents.mockResolvedValueOnce(
      makeListResponse([], { page: 1, page_size: 5, total: 0, total_pages: 0 }),
    );

    await harness.press(
      { type: 'filter', action: 'setPrice', priceMax: 1000, freeOnly: false },
      60,
    );
    expect(harness.lastText()).toContain('Ничего не нашлось');
    expect(harness.keyboardButtons()).toContain('💰 Снять цену');
    expect(harness.keyboardButtons()).toContain('🎛 Все фильтры');

    await harness.press({ type: 'filter', action: 'clear', field: 'price' }, 61);
    expect(harness.searchEvents).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: 'музыка', price_max: null }),
    );
  });

  it('ошибка API показывается с кодом обращения и без внутренних деталей', async () => {
    const harness = await makeHarness();
    harness.searchEvents.mockRejectedValueOnce(
      new ApiError('fetch failed', {
        kind: 'network',
        userMessage: 'Сервис афиши сейчас недоступен. Попробуйте позже.',
        requestId: 'abcdef12-3456-7890-abcd-ef1234567890',
      }),
    );

    await harness.run(messageUpdate('музыка'));
    const text = harness.lastText();
    expect(text).toContain('Сервис афиши сейчас недоступен');
    expect(text).toContain('Код обращения: abcdef12');
    expect(text).not.toContain('fetch failed');
  });

  it('устаревшая кнопка получает ack, объяснение и свежее меню', async () => {
    const harness = await makeHarness();
    await harness.run(callbackUpdate('v1_AAAAAAAAAAAA', 70));

    expect(harness.answerTexts().at(-1)).toContain('устарела');
    expect(harness.lastText()).toContain('устарела');
    expect(harness.keyboardButtons()).toContain('🔍 Найти событие');
  });

  it('текстовые команды дублируют кнопки фильтров', async () => {
    const harness = await makeHarness();
    await harness.run(messageUpdate('/today', 80));
    expect(harness.searchEvents).toHaveBeenLastCalledWith(
      expect.objectContaining({ date: 'today' }),
    );

    await harness.run(messageUpdate('/price 1000', 81));
    expect(harness.searchEvents).toHaveBeenLastCalledWith(
      expect.objectContaining({ date: 'today', price_max: 1000 }),
    );

    await harness.run(messageUpdate('/city Уфа', 82));
    expect(harness.searchEvents).toHaveBeenLastCalledWith(
      expect.objectContaining({ city: 'ufa', date: 'today', price_max: 1000 }),
    );

    await harness.run(messageUpdate('/category концерты', 83));
    expect(harness.searchEvents).toHaveBeenLastCalledWith(
      expect.objectContaining({ category: 'concert', city: 'ufa' }),
    );

    await harness.run(messageUpdate('/about', 84));
    expect(harness.lastText()).toContain('неофициальный информационный сервис');
  });

  it('текстовые команды возраста, сортировки, языка и периода', async () => {
    const harness = await makeHarness();
    await harness.run(messageUpdate('/date 2026-11-20..2026-11-25', 85));
    expect(harness.searchEvents).toHaveBeenLastCalledWith(
      expect.objectContaining({
        date: null,
        date_from: '2026-11-20',
        date_to: '2026-11-25',
      }),
    );

    await harness.run(messageUpdate('/age 6', 86));
    expect(harness.searchEvents).toHaveBeenLastCalledWith(
      expect.objectContaining({ age: 6 }),
    );

    await harness.run(messageUpdate('/sort price', 87));
    expect(harness.searchEvents).toHaveBeenLastCalledWith(
      expect.objectContaining({ age: 6, sort: 'price' }),
    );

    await harness.run(messageUpdate('/language ba', 88));
    expect(harness.searchEvents).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort: 'price', language: 'ba' }),
    );

    await harness.run(messageUpdate('/age any', 89));
    expect(harness.searchEvents).toHaveBeenLastCalledWith(
      expect.objectContaining({ age: null, language: 'ba' }),
    );
  });

  it('некорректные команды фильтров не ходят в API', async () => {
    const harness = await makeHarness();
    await harness.run(messageUpdate('/age 7', 90));
    expect(harness.searchEvents).not.toHaveBeenCalled();
    expect(harness.lastText()).toContain('Доступны');

    await harness.run(messageUpdate('/date 2026-11-01..2026-12-31', 91));
    expect(harness.searchEvents).not.toHaveBeenCalled();
    expect(harness.lastText()).toContain('31 день');
  });

  it('лимит частоты не пускает бесконечные запросы', async () => {
    const harness = await makeHarness({ config: { rateLimitPerMinute: 1 } });
    await harness.run(messageUpdate('музыка', 90));
    await harness.run(messageUpdate('балет', 91));

    expect(harness.searchEvents).toHaveBeenCalledTimes(1);
    expect(harness.lastText()).toContain('Слишком много запросов');
  });

  it('логи не содержат сырой telegram id и user_ref', async () => {
    const lines: string[] = [];
    const sink: LogSink = {
      log: (line) => lines.push(line),
      error: (line) => lines.push(line),
    };
    const harness = await makeHarness({ logSink: sink });
    await harness.run(messageUpdate('музыка'));

    const joined = lines.join('\n');
    expect(joined).not.toContain('telegram_00000123');
    expect(joined).not.toContain('"user_id"');
    expect(joined).toContain('"user":"u_');
  });

  it('HTML в данных события экранируется', async () => {
    const harness = await makeHarness();
    harness.getEvent.mockResolvedValueOnce(
      makeEvent({ title: '<script>alert(1)</script>', description: 'A & B' }),
    );
    await harness.press({ type: 'event', id: EVENT_ID, page: null });

    expect(harness.lastText()).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(harness.lastText()).toContain('A &amp; B');
    expect(harness.lastText()).not.toContain('<script>');
  });

  it('пустая следующая страница не запирает возврат к результатам', async () => {
    const harness = await makeHarness();
    await harness.run(messageUpdate('музыка'));
    harness.searchEvents.mockResolvedValueOnce(
      makeListResponse([], { page: 2, page_size: 5, total: 2, total_pages: 2 }),
    );

    await harness.press({ type: 'search', action: 'page', page: 2 }, 100);
    expect(harness.lastText()).toContain('Больше событий');

    await harness.press({ type: 'filter', action: 'results' }, 101);
    expect(harness.searchEvents).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 1 }),
    );
  });

  it('снятие запроса сохраняет остальные фильтры', async () => {
    const harness = await makeHarness();
    await harness.run(messageUpdate('музыка'));
    await harness.press({ type: 'filter', action: 'setCity', city: 'ufa' }, 110);
    await harness.press({ type: 'filter', action: 'clear', field: 'q' }, 111);

    expect(harness.searchEvents).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: null, city: 'ufa' }),
    );
  });

  it('команды с некорректным аргументом не ходят в API', async () => {
    const harness = await makeHarness();

    await harness.run(messageUpdate('/date вчера', 120));
    expect(harness.lastText()).toContain('Не понял дату');

    await harness.run(messageUpdate('/price abc', 121));
    expect(harness.lastText()).toContain('Не понял цену');

    await harness.run(messageUpdate('/city Марс', 122));
    expect(harness.lastText()).toContain('Не знаю город');

    await harness.run(messageUpdate('/category Марс', 123));
    expect(harness.lastText()).toContain('Не знаю категорию');

    expect(harness.searchEvents).not.toHaveBeenCalled();
  });

  it('берёт города и категории из DirectoryService, а не из встроенного списка', async () => {
    const directories = new DirectoryService({
      cities: [{ id: 'novy', name: 'Новый город' }],
      categories: [{ id: 'opera', name: 'Опера' }],
    });
    const harness = await makeHarness({ directories });

    await harness.run(messageUpdate('/city Новый город', 130));
    expect(harness.searchEvents).toHaveBeenLastCalledWith(
      expect.objectContaining({ city: 'novy' }),
    );

    await harness.run(messageUpdate('/category Опера', 131));
    expect(harness.searchEvents).toHaveBeenLastCalledWith(
      expect.objectContaining({ category: 'opera' }),
    );

    await harness.press({ type: 'menu', target: 'cities' }, 132);
    expect(harness.keyboardButtons()).toContain('Новый город');
    expect(harness.keyboardButtons()).not.toContain('Уфа');
  });

  it('листает длинные справочники и принимает выбор со второй страницы', async () => {
    const directories = new DirectoryService({
      cities: Array.from({ length: 30 }, (_, index) => ({
        id: `city-${index + 1}`,
        name: `Город ${index + 1}`,
      })),
    });
    const harness = await makeHarness({ directories });

    await harness.press({ type: 'menu', target: 'cities' }, 140);
    expect(harness.keyboardButtons()).toContain('Город 24');
    expect(harness.keyboardButtons()).not.toContain('Город 25');
    expect(harness.keyboardButtons()).toContain('Ещё ➡️');

    await harness.pressButton('Ещё ➡️', 141);
    expect(harness.keyboardButtons()).toContain('Город 30');
    expect(harness.keyboardButtons()).toContain('⬅️ Назад');

    await harness.press({ type: 'filter', action: 'open' }, 142);
    await harness.pressButton('📍 Все города', 143);
    await harness.pressButton('Ещё ➡️', 144);
    await harness.pressButton('Город 25', 145);
    expect(harness.searchEvents).toHaveBeenLastCalledWith(
      expect.objectContaining({ city: 'city-25' }),
    );

    await harness.press({ type: 'subscribe', action: 'add' }, 146);
    await harness.press({ type: 'subscribe', action: 'pick', field: 'city' }, 147);
    await harness.pressButton('Ещё ➡️', 148);
    await harness.pressButton('Город 29', 149);
    expect(harness.editedTexts().at(-1)).toContain('Город 29');
  });

  it('не принимает идентификаторы вне справочника и показывает свежее меню', async () => {
    const harness = await makeHarness();

    await harness.press({ type: 'search', action: 'city', id: 'mars' }, 150);
    expect(harness.lastText()).toContain('устарела');
    expect(harness.keyboardButtons()).toContain('🔍 Найти событие');

    await harness.press(
      { type: 'filter', action: 'setCategory', category: 'opera' },
      151,
    );
    expect(harness.lastText()).toContain('устарела');

    await harness.press(
      { type: 'subscribe', action: 'quick', city: 'ufa', category: 'opera' },
      152,
    );
    expect(harness.lastText()).toContain('устарела');
    expect(harness.createSubscription).not.toHaveBeenCalled();
  });

  it('команды для меню Telegram корректны', () => {
    for (const item of BOT_COMMANDS) {
      expect(item.command).toMatch(/^[a-z0-9_]{1,32}$/);
      expect(item.description.length).toBeLessThanOrEqual(256);
    }
  });

  it('ассистент отвечает на свободный текст и запоминает контекст', async () => {
    const harness = await makeHarness({ config: { assistantEnabled: true } });
    harness.queryAssistant.mockResolvedValueOnce(
      makeAssistantResponse({
        message: 'Нашлось 1 событие по вашим условиям.',
        assumptions: [{ key: 'date_resolved', text: 'сегодня = 14 ноября' }],
        chips: [
          {
            key: 'hard.cities',
            kind: 'city',
            label: 'Город',
            value: 'Уфа',
            removable: true,
            unset: ['hard.cities'],
          },
        ],
      }),
    );

    await harness.run(messageUpdate('концерт в Уфе для ребёнка', 160));

    expect(harness.queryAssistant).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'концерт в Уфе для ребёнка',
        channel: 'telegram',
        user_ref: USER_REF,
        previous: null,
        limit: 6,
      }),
    );
    expect(harness.lastText()).toContain('Нашлось 1 событие');
    expect(harness.lastText()).toContain('сегодня = 14 ноября');
    expect(harness.keyboardButtons()).toContain('1. Вечер башкирской музыки');
    expect(harness.keyboardButtons()).toContain('✖️ Город: Уфа');
    expect(harness.sessions.get(USER.id).assistant.history).toHaveLength(2);

    await harness.pressButton('✖️ Город: Уфа', 161);
    expect(harness.queryAssistant).toHaveBeenLastCalledWith(
      expect.objectContaining({
        previous: { hard: { cities: ['ufa'] }, soft: {} },
        patch: { unset: ['hard.cities'] },
      }),
    );
    expect(harness.queryAssistant.mock.calls[1]?.[0].message).toBeUndefined();
  });

  it('ассистент принимает сообщение до 1000 знаков, а не 100', async () => {
    const harness = await makeHarness({ config: { assistantEnabled: true } });
    harness.queryAssistant.mockResolvedValueOnce(
      makeAssistantResponse({ message: 'Принял длинный запрос.' }),
    );

    await harness.run(messageUpdate('а'.repeat(1200), 176));

    const call = harness.queryAssistant.mock.calls[0]?.[0];
    expect(call?.message).toHaveLength(1000);
  });

  it('обычный поиск обрезает запрос до 100 знаков и сообщает об этом', async () => {
    const harness = await makeHarness();

    await harness.run(messageUpdate('б'.repeat(150), 177));

    expect(harness.searchEvents).toHaveBeenCalledWith(
      expect.objectContaining({ q: 'б'.repeat(100) }),
    );
    expect(harness.lastText()).toContain('сокращён до 100 знаков');
  });

  it('ассистент задаёт уточнение и принимает быстрый ответ', async () => {
    const harness = await makeHarness({ config: { assistantEnabled: true } });
    harness.queryAssistant.mockResolvedValueOnce(
      makeAssistantResponse({
        action: 'clarify',
        message: 'В каком городе искать?',
        assumptions: [],
        results: [],
        total: 0,
        clarify: {
          code: 'city',
          pending: ['city'],
          question: 'В каком городе искать?',
          quick_replies: ['Уфа', 'Стерлитамак'],
        },
      }),
    );

    await harness.run(messageUpdate('куда сходить с ребёнком', 162));
    expect(harness.keyboardButtons()).toContain('Уфа');

    await harness.pressButton('Уфа', 163);
    expect(harness.queryAssistant).toHaveBeenLastCalledWith(
      expect.objectContaining({
        message: 'Уфа',
        answering: 'city',
        previous: { hard: { cities: ['ufa'] }, soft: {} },
      }),
    );
  });

  it('при 503 ассистент мягко откатывается на обычный поиск', async () => {
    const harness = await makeHarness({ config: { assistantEnabled: true } });
    harness.queryAssistant.mockRejectedValueOnce(
      new ApiError('API 503 unavailable', {
        kind: 'http',
        status: 503,
        code: 'unavailable',
      }),
    );

    await harness.run(messageUpdate('музыка', 164));

    expect(harness.searchEvents).toHaveBeenCalledWith(
      expect.objectContaining({ q: 'музыка', page: 1 }),
    );
    expect(harness.lastText()).toContain('Вечер башкирской музыки');
  });

  it('при 429 ассистент просит подождать и не обходит лимит поиском', async () => {
    const harness = await makeHarness({ config: { assistantEnabled: true } });
    harness.queryAssistant.mockRejectedValueOnce(
      new ApiError('API 429 rate_limited', {
        kind: 'http',
        status: 429,
        code: 'rate_limited',
      }),
    );

    await harness.run(messageUpdate('музыка', 165));

    expect(harness.searchEvents).not.toHaveBeenCalled();
    expect(harness.lastText()).toContain('Слишком много запросов');
  });

  it('по умолчанию не показывает подтверждения и предлагает обычный поиск', async () => {
    const harness = await makeHarness({ config: { assistantEnabled: true } });
    harness.queryAssistant.mockResolvedValueOnce(
      makeAssistantResponse({
        action: 'confirmation_required',
        message: 'Подтвердите оформление подписки.',
        results: [],
        total: 0,
        confirmation: {
          confirmation_id: 'cnf_123456',
          summary: 'Подписка на концерты',
          expires_at: '2026-11-14T12:00:00+05:00',
        },
      }),
    );

    await harness.run(messageUpdate('подпишись на концерты', 166));

    expect(harness.lastText()).toContain('Подтверждения действий в боте пока отключены');
    expect(harness.keyboardButtons()).not.toContain('✅ Подтвердить');
    expect(harness.keyboardButtons()).toContain('🔎 Обычный поиск');

    await harness.pressButton('🔎 Обычный поиск', 167);
    expect(harness.searchEvents).toHaveBeenCalledWith(
      expect.objectContaining({ q: 'подпишись на концерты' }),
    );
  });

  it('с явным флагом подтверждает и отменяет действие ассистента', async () => {
    const harness = await makeHarness({
      config: { assistantEnabled: true, assistantConfirmations: true },
    });
    const confirmation = makeAssistantResponse({
      action: 'confirmation_required',
      message: 'Подтвердите оформление подписки.',
      results: [],
      total: 0,
      confirmation: {
        confirmation_id: 'cnf_123456',
        summary: 'Подписка на концерты',
        expires_at: '2026-11-14T12:00:00+05:00',
      },
    });
    harness.queryAssistant.mockResolvedValue(confirmation);

    await harness.run(messageUpdate('подпишись на концерты', 168));
    expect(harness.keyboardButtons()).toContain('✅ Подтвердить');
    await harness.pressButton('✅ Подтвердить', 169);
    expect(harness.confirmAssistant).toHaveBeenCalledWith('cnf_123456', 'approve', USER_REF);
    expect(harness.lastText()).toContain('Готово');

    await harness.run(messageUpdate('подпишись на концерты', 170));
    await harness.pressButton('❌ Отменить', 171);
    expect(harness.confirmAssistant).toHaveBeenLastCalledWith('cnf_123456', 'reject', USER_REF);
    expect(harness.lastText()).toContain('Действие отменено');
  });

  it('при 429 на подтверждении просит подождать, а не падает', async () => {
    const harness = await makeHarness({
      config: { assistantEnabled: true, assistantConfirmations: true },
    });
    harness.queryAssistant.mockResolvedValue(
      makeAssistantResponse({
        action: 'confirmation_required',
        message: 'Подтвердите оформление подписки.',
        results: [],
        total: 0,
        confirmation: {
          confirmation_id: 'cnf_123456',
          summary: 'Подписка на концерты',
          expires_at: '2026-11-14T12:00:00+05:00',
        },
      }),
    );
    harness.confirmAssistant.mockRejectedValueOnce(
      new ApiError('API 429 rate_limited', {
        kind: 'http',
        status: 429,
        code: 'rate_limited',
      }),
    );

    await harness.run(messageUpdate('подпишись на концерты', 174));
    await harness.pressButton('✅ Подтвердить', 175);

    expect(harness.lastText()).toContain('Слишком много запросов');
  });

  it('кнопка ослабления из ответа ассистента запускает поиск', async () => {
    const harness = await makeHarness({ config: { assistantEnabled: true } });
    harness.queryAssistant.mockResolvedValueOnce(
      makeAssistantResponse({
        message: 'Ничего не нашлось.',
        results: [],
        total: 0,
        relaxations: [
          {
            code: 'date',
            codes: ['date'],
            label: 'Без даты',
            query: { date_from: '2026-11-20', date_to: '2026-11-25' },
            count: 7,
          },
        ],
      }),
    );

    await harness.run(messageUpdate('балет на выходных', 172));
    expect(harness.keyboardButtons()).toContain('Без даты · 7');

    await harness.pressButton('Без даты · 7', 173);
    expect(harness.searchEvents).toHaveBeenLastCalledWith(
      expect.objectContaining({ date_from: '2026-11-20', date_to: '2026-11-25' }),
    );
  });
});
