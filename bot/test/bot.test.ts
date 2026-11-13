import { describe, expect, it, vi } from 'vitest';
import type { Update } from 'grammy/types';

import { ApiError, type ApiClient, type CreateSubscriptionInput, type SearchEventsParams } from '../src/api/client.js';
import type { EventListResponse, Subscription } from '../src/api/types.js';
import { CallbackStore } from '../src/callback-store.js';
import type { Callback } from '../src/callbacks.js';
import { createBot } from '../src/bot.js';
import type { BotConfig } from '../src/config.js';
import { createLogger, type LogSink } from '../src/logger.js';
import { SessionStore } from '../src/session.js';
import { BOT_COMMANDS } from '../src/texts.js';
import { EVENT_ID, EVENT_ID_2, makeEvent, makeListItem, makeListResponse } from './fixtures.js';

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
  const getCategories = vi.fn(async () => [{ id: 'concert', name: 'Концерты' }]);

  const api: ApiClient = {
    health,
    searchEvents,
    getEvent,
    getCities,
    getCategories,
    listSubscriptions,
    createSubscription,
    deleteSubscription,
  };

  return {
    api,
    searchEvents,
    getEvent,
    createSubscription,
    listSubscriptions,
    deleteSubscription,
    setSubscriptions: (items: Subscription[]) => {
      subscriptions = items;
    },
  };
}

interface HarnessOptions {
  config?: Partial<BotConfig>;
  logSink?: LogSink;
  failPhoto?: boolean;
}

async function makeHarness(options: HarnessOptions = {}) {
  const stub = makeStubApi();
  const calls: ApiCall[] = [];
  const sessions = new SessionStore();
  const callbacks = new CallbackStore({ ttlMs: 60_000 });
  const sink = options.logSink ?? { log: () => {}, error: () => {} };
  const logger = createLogger('debug', sink);
  const config: BotConfig = { ...CONFIG, ...options.config };
  const bot = createBot(TOKEN, { api: stub.api, sessions, config, logger, callbacks });

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
    expect(harness.keyboardButtons()).toContain('🔔 Подписаться: Концерты · Уфа');
    expect(harness.keyboardButtons()).toContain('← К результатам');
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
      user_ref: 'telegram_00000123',
      city: 'ufa',
      category: 'concert',
      period: null,
    });
    const text = harness.lastText();
    expect(text).toContain('Подписка сохранена');
    expect(text).toContain('Концерты · Уфа');
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
    expect(harness.lastText()).toContain('Концерты · Уфа');

    await harness.press({ type: 'subscriptions', action: 'delete', id: id as string }, 13);
    expect(harness.deleteSubscription).toHaveBeenCalledWith(id, 'telegram_00000123');
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

  it('команды для меню Telegram корректны', () => {
    for (const item of BOT_COMMANDS) {
      expect(item.command).toMatch(/^[a-z0-9_]{1,32}$/);
      expect(item.description.length).toBeLessThanOrEqual(256);
    }
  });
});
