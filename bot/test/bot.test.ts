import { describe, expect, it, vi } from 'vitest';
import type { Update } from 'grammy/types';

import { ApiError, type ApiClient, type CreateSubscriptionInput, type SearchEventsParams } from '../src/api/client.js';
import type { EventListResponse, Subscription } from '../src/api/types.js';
import { createBot } from '../src/bot.js';
import { CB } from '../src/callbacks.js';
import type { BotConfig } from '../src/config.js';
import { createLogger } from '../src/logger.js';
import { SessionStore } from '../src/session.js';
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
  publicWebUrl: 'http://web.test',
  sessionTtlMs: 60_000,
};

interface ApiCall {
  method: string;
  payload: Record<string, unknown>;
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

async function makeHarness() {
  const stub = makeStubApi();
  const calls: ApiCall[] = [];
  const sessions = new SessionStore();
  const logger = createLogger('error', { log: () => {}, error: () => {} });
  const bot = createBot(TOKEN, { api: stub.api, sessions, config: CONFIG, logger });

  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    if (method === 'getMe') return { ok: true, result: BOT_INFO } as never;
    if (method === 'sendMessage' || method === 'editMessageText') {
      return {
        ok: true,
        result: {
          message_id: calls.length,
          date: 1_760_000_000,
          chat: CHAT,
          text: String((payload as Record<string, unknown>).text ?? ''),
        },
      } as never;
    }
    return { ok: true, result: true } as never;
  });

  await bot.init();

  async function run(update: Update): Promise<void> {
    await bot.handleUpdate(update);
  }

  function sentTexts(): string[] {
    return calls
      .filter((call) => call.method === 'sendMessage')
      .map((call) => String(call.payload.text ?? ''));
  }

  function editedTexts(): string[] {
    return calls
      .filter((call) => call.method === 'editMessageText')
      .map((call) => String(call.payload.text ?? ''));
  }

  function lastSentKeyboardButtons(): string[] {
    const sent = calls.filter((call) => call.method === 'sendMessage');
    const last = sent[sent.length - 1];
    const markup = last?.payload.reply_markup as
      | { inline_keyboard?: { text: string; callback_data?: string; url?: string }[][] }
      | undefined;
    return (markup?.inline_keyboard ?? []).flat().map((button) => button.text);
  }

  return {
    ...stub,
    bot,
    sessions,
    calls,
    run,
    sentTexts,
    editedTexts,
    lastSentKeyboardButtons,
  };
}

describe('сценарии бота', () => {
  it('/start показывает меню и сбрасывает сессию', async () => {
    const harness = await makeHarness();
    harness.sessions.update(USER.id, (session) => {
      session.awaitingQuery = true;
    });

    await harness.run(messageUpdate('/start'));

    const text = harness.sentTexts().at(-1) ?? '';
    expect(text).toContain('бот афиши культуры Башкортостана');
    expect(harness.lastSentKeyboardButtons()).toEqual(
      expect.arrayContaining(['🔍 Найти событие', '🎭 Категории', '🔔 Мои подписки']),
    );
    expect(harness.sessions.get(USER.id).awaitingQuery).toBe(false);
  });

  it('/help перечисляет команды', async () => {
    const harness = await makeHarness();
    await harness.run(messageUpdate('/help'));
    const text = harness.sentTexts().at(-1) ?? '';
    expect(text).toContain('/start');
    expect(text).toContain('/cancel');
    expect(text).toContain('Подписки');
  });

  it('свободный текст запускает поиск и показывает «Показать ещё»', async () => {
    const harness = await makeHarness();
    await harness.run(messageUpdate('музыка'));

    expect(harness.searchEvents).toHaveBeenCalledWith(
      expect.objectContaining({ q: 'музыка', page: 1, page_size: 5 }),
    );
    const text = harness.sentTexts().at(-1) ?? '';
    expect(text).toContain('Поиск «музыка»');
    expect(text).toContain('Страница 1 из 2');
    expect(text).toContain('Вечер башкирской музыки');
    expect(harness.lastSentKeyboardButtons()).toContain('Показать ещё ➡️');
  });

  it('«Показать ещё» открывает следующую страницу', async () => {
    const harness = await makeHarness();
    await harness.run(messageUpdate('музыка'));
    await harness.run(callbackUpdate(CB.searchPage(2)));

    expect(harness.searchEvents).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
    const text = harness.sentTexts().at(-1) ?? '';
    expect(text).toContain('Страница 2 из 2');
    expect(text).toContain('Второе событие');
    expect(harness.lastSentKeyboardButtons()).toContain('⬅️ Назад');
    expect(harness.lastSentKeyboardButtons()).not.toContain('Показать ещё ➡️');
    expect(harness.calls.some((call) => call.method === 'answerCallbackQuery')).toBe(true);
  });

  it('карточка события показывает данные и кнопку подписки', async () => {
    const harness = await makeHarness();
    await harness.run(messageUpdate('музыка'));
    await harness.run(callbackUpdate(CB.event(EVENT_ID, 1)));

    expect(harness.getEvent).toHaveBeenCalledWith(EVENT_ID);
    const text = harness.sentTexts().at(-1) ?? '';
    expect(text).toContain('Вечер башкирской музыки');
    expect(text).toContain('500\u00A0₽–1\u00A0200\u00A0₽');
    expect(harness.lastSentKeyboardButtons()).toContain('🔔 Подписаться: Концерты · Уфа');
    expect(harness.lastSentKeyboardButtons()).toContain('← К результатам');
  });

  it('быстрая подписка из карточки создаёт подписку с telegram user_ref', async () => {
    const harness = await makeHarness();
    await harness.run(callbackUpdate(CB.subscribeQuick('ufa', 'concert')));

    expect(harness.createSubscription).toHaveBeenCalledWith({
      channel: 'telegram',
      user_ref: 'telegram_00000123',
      city: 'ufa',
      category: 'concert',
      period: null,
    });
    const text = harness.sentTexts().at(-1) ?? '';
    expect(text).toContain('Подписка сохранена');
    expect(text).toContain('Концерты · Уфа');
  });

  it('повторная подписка объясняет конфликт', async () => {
    const harness = await makeHarness();
    await harness.run(callbackUpdate(CB.subscribeQuick('ufa', 'concert')));
    harness.createSubscription.mockRejectedValueOnce(
      new ApiError('API 409 conflict', {
        kind: 'http',
        status: 409,
        code: 'conflict',
        userMessage: 'Такая подписка уже оформлена.',
      }),
    );
    await harness.run(callbackUpdate(CB.subscribeQuick('ufa', 'concert'), 11));

    const text = harness.sentTexts().at(-1) ?? '';
    expect(text).toContain('уже есть');
  });

  it('меню подписок показывает список и удаляет по кнопке', async () => {
    const harness = await makeHarness();
    await harness.run(callbackUpdate(CB.subscribeQuick('ufa', 'concert')));
    const subscriptionId = harness.createSubscription.mock.results[0]?.value;
    const id = (await subscriptionId)?.id;
    expect(id).toBeTruthy();

    await harness.run(callbackUpdate(CB.menu('subs'), 12));
    expect(harness.listSubscriptions).toHaveBeenCalled();
    let text = harness.sentTexts().at(-1) ?? '';
    expect(text).toContain('Ваши подписки (1)');
    expect(text).toContain('Концерты · Уфа');

    await harness.run(callbackUpdate(CB.deleteSubscription(id as string), 13));
    expect(harness.deleteSubscription).toHaveBeenCalledWith(id, 'telegram_00000123');
    text = harness.sentTexts().at(-1) ?? '';
    expect(text).toContain('Подписка удалена');
    expect(text).toContain('Подписок пока нет');
  });

  it('конструктор подписки проходит шаги и сохраняет выбранный город', async () => {
    const harness = await makeHarness();
    await harness.run(callbackUpdate(CB.subscribeAdd(), 20));

    let text = harness.sentTexts().at(-1) ?? '';
    expect(text).toContain('Новая подписка');
    expect(harness.lastSentKeyboardButtons()).toContain('✅ Сохранить');

    await harness.run(callbackUpdate(CB.subscribePick('city'), 21));
    expect(harness.editedTexts().at(-1)).toContain('Выберите город');

    await harness.run(callbackUpdate(CB.subscribeCity('sibay'), 22));
    expect(harness.editedTexts().at(-1)).toContain('Город: Сибай');

    await harness.run(callbackUpdate(CB.subscribeSave(), 23));
    expect(harness.createSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ city: 'sibay', category: null, period: null }),
    );
    text = harness.editedTexts().at(-1) ?? harness.sentTexts().at(-1) ?? '';
    expect(text).toContain('Подписка сохранена');
    expect(harness.sessions.get(USER.id).draft).toBeNull();
  });

  it('во время настройки подписки свободный текст не запускает поиск', async () => {
    const harness = await makeHarness();
    await harness.run(callbackUpdate(CB.subscribeAdd(), 30));
    await harness.run(messageUpdate('концерт', 31));

    expect(harness.searchEvents).not.toHaveBeenCalled();
    expect(harness.sentTexts().at(-1)).toContain('настраиваете подписку');
  });

  it('/cancel очищает состояние', async () => {
    const harness = await makeHarness();
    await harness.run(messageUpdate('музыка'));
    await harness.run(messageUpdate('/cancel', 2));

    const text = harness.sentTexts().at(-1) ?? '';
    expect(text).toContain('Отменил');
    expect(harness.sessions.get(USER.id).search).toBeNull();
  });

  it('ошибка API показывается пользователю без падения', async () => {
    const harness = await makeHarness();
    harness.searchEvents.mockRejectedValueOnce(
      new ApiError('fetch failed', {
        kind: 'network',
        userMessage: 'Сервис афиши сейчас недоступен. Попробуйте позже.',
      }),
    );

    await harness.run(messageUpdate('музыка'));
    const text = harness.sentTexts().at(-1) ?? '';
    expect(text).toContain('Сервис афиши сейчас недоступен');
    expect(text).not.toContain('fetch failed');
  });
});
