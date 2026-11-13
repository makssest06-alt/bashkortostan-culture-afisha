import { ApiHttpError, type BackendApiClient, type BotEvent, type EventListResponse } from './api-client.js';
import type { BotConfig } from './config.js';
import {
  CATEGORY_LABELS,
  CITY_LABELS,
  PERIOD_LABELS,
  assertCallbackData64,
  escapeHtml,
  formatEventCardHtml,
  formatEventShortLine,
} from './format.js';
import type { ChatSession, SessionStore } from './session.js';

export interface InlineButton {
  text: string;
  callback_data: string;
}

export interface BotReply {
  text: string;
  parse_mode: 'HTML';
  reply_markup?: { inline_keyboard: InlineButton[][] };
  callback_alert?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number | string };
    text?: string;
  };
  callback_query?: {
    id: string;
    message?: { chat: { id: number | string }; message_id: number };
    data?: string;
  };
}

function btn(text: string, callbackData: string): InlineButton {
  return { text, callback_data: assertCallbackData64(callbackData) };
}

function buildMainMenuKeyboard(session: ChatSession): InlineButton[][] {
  const freeLabel = session.freeOnly ? '💸 Бесплатные: ДА' : '💸 Бесплатные: нет';
  const cityLabel = session.city ? `🏙 Город: ${CITY_LABELS[session.city] ?? session.city}` : '🏙 Выбрать город';
  const catLabel = session.category ? `🎭 Категория: ${CATEGORY_LABELS[session.category] ?? session.category}` : '🎭 Категория';
  const periodLabel = session.period ? `🗓 Период: ${PERIOD_LABELS[session.period] ?? session.period}` : '🗓 Период';

  return [
    [btn(cityLabel, 'menu:city'), btn(catLabel, 'menu:cat')],
    [btn(periodLabel, 'menu:per'), btn(freeLabel, 'f:toggle')],
    [btn('🔎 Найти события', 'ev:list:1'), btn('🔔 Подписаться', 'sub:new')],
    [btn('📋 Мои подписки', 'sub:list'), btn('🔄 Сбросить', 'menu:reset')],
  ];
}

function buildCityKeyboard(): InlineButton[][] {
  const rows: InlineButton[][] = [];
  const entries = Object.entries(CITY_LABELS);
  for (let i = 0; i < entries.length; i += 2) {
    const pair = entries.slice(i, i + 2).map(([slug, label]) => btn(label, `c:${slug}`));
    rows.push(pair);
  }
  rows.push([btn('Все города', 'c:all'), btn('⬅️ Назад', 'menu:main')]);
  return rows;
}

function buildCategoryKeyboard(): InlineButton[][] {
  const rows: InlineButton[][] = [];
  const entries = Object.entries(CATEGORY_LABELS);
  for (let i = 0; i < entries.length; i += 2) {
    const pair = entries.slice(i, i + 2).map(([id, label]) => btn(label, `k:${id}`));
    rows.push(pair);
  }
  rows.push([btn('Любая категория', 'k:all'), btn('⬅️ Назад', 'menu:main')]);
  return rows;
}

function buildPeriodKeyboard(): InlineButton[][] {
  return [
    [btn('Сегодня', 'p:today'), btn('Завтра', 'p:tomorrow')],
    [btn('Выходные', 'p:weekend'), btn('Неделя', 'p:week')],
    [btn('Любой период', 'p:all'), btn('⬅️ Назад', 'menu:main')],
  ];
}

function filtersSummary(session: ChatSession): string {
  const parts: string[] = [];
  parts.push(`город: ${session.city ? CITY_LABELS[session.city] ?? session.city : 'вся республика'}`);
  if (session.category) parts.push(`категория: ${CATEGORY_LABELS[session.category] ?? session.category}`);
  if (session.period) parts.push(`период: ${PERIOD_LABELS[session.period] ?? session.period}`);
  if (session.freeOnly) parts.push('только бесплатные');
  return parts.join(', ');
}

function formatEventListReply(
  session: ChatSession,
  sessions: SessionStore,
  res: EventListResponse,
  headerNotice?: string,
): BotReply {
  if (res.items.length === 0) {
    const hints = (res.relaxations ?? [])
      .map((r) => (typeof r.label === 'string' ? r.label : r.label.ru))
      .slice(0, 3);
    const lines = [
      ...(headerNotice ? [headerNotice, ''] : []),
      `По фильтрам (${escapeHtml(filtersSummary(session))}) ничего не нашлось.`,
      ...(hints.length > 0 ? ['Попробуйте ослабить условия: ' + escapeHtml(hints.join('; '))] : []),
    ];
    return {
      text: lines.join('\n'),
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: buildMainMenuKeyboard(session) },
    };
  }

  const startNum = (res.page - 1) * res.page_size + 1;
  const lines: string[] = [];
  if (headerNotice) lines.push(headerNotice, '');
  lines.push(`<b>Найдено событий: ${res.total}</b> (стр. ${res.page} из ${Math.max(1, res.total_pages)})`);
  lines.push('');

  const itemButtons: InlineButton[] = [];
  res.items.forEach((ev, idx) => {
    lines.push(formatEventShortLine(ev, startNum + idx));
    lines.push('');
    const shortId = sessions.registerEventRef(session, ev.id);
    itemButtons.push(btn(`№${startNum + idx}`, `ev:d:${shortId}`));
  });

  const keyboard: InlineButton[][] = [];
  for (let i = 0; i < itemButtons.length; i += 5) {
    keyboard.push(itemButtons.slice(i, i + 5));
  }
  const navRow: InlineButton[] = [];
  if (res.page > 1) navRow.push(btn('⬅️ Назад', `pg:${res.page - 1}`));
  if (res.page < res.total_pages) navRow.push(btn('Ещё ➡️', `pg:${res.page + 1}`));
  if (navRow.length > 0) keyboard.push(navRow);
  keyboard.push([btn('⚙️ Меню и фильтры', 'menu:main')]);

  return {
    text: lines.join('\n').trim(),
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: keyboard },
  };
}

function extractFallbackParams(text: string, session: ChatSession) {
  const lower = text.toLowerCase();
  let city = session.city ?? undefined;
  if (/уф[аеуы]/i.test(lower)) city = 'ufa';
  else if (/стерлитамак/i.test(lower)) city = 'sterlitamak';
  else if (/салават/i.test(lower)) city = 'salavat';
  else if (/нефтекамск/i.test(lower)) city = 'neftekamsk';
  else if (/октябрьск/i.test(lower)) city = 'oktyabrsky';
  else if (/белорецк/i.test(lower)) city = 'beloretsk';
  else if (/сиба[йяе]/i.test(lower)) city = 'sibay';
  else if (/кумертау/i.test(lower)) city = 'kumertau';

  let category = session.category ?? undefined;
  if (/концерт|музык|филармон/i.test(lower)) category = 'concert';
  else if (/спектакл|театр|балет|опер/i.test(lower)) category = 'performance';
  else if (/выставк|музе[йяе]|галере/i.test(lower)) category = 'exhibition';
  else if (/фестивал/i.test(lower)) category = 'festival';
  else if (/кино|фильм/i.test(lower)) category = 'cinema';
  else if (/экскурси/i.test(lower)) category = 'excursion';

  let date = session.period ?? undefined;
  if (/сегодня/i.test(lower)) date = 'today';
  else if (/завтра/i.test(lower)) date = 'tomorrow';
  else if (/выходн/i.test(lower)) date = 'weekend';
  else if (/недел/i.test(lower)) date = 'week';

  const free = session.freeOnly || /бесплат|даром|свободный вход/i.test(lower);
  return { city, category, date, free, page: 1, page_size: 5 };
}

export class BotHandler {
  constructor(
    private readonly api: BackendApiClient,
    private readonly sessions: SessionStore,
    private readonly config: BotConfig,
  ) {}

  async handleUpdate(update: TelegramUpdate): Promise<{ chatId: number | string; reply: BotReply; callbackQueryId?: string } | null> {
    if (update.message?.text) {
      const chatId = update.message.chat.id;
      const reply = await this.handleMessage(chatId, update.message.text);
      return { chatId, reply };
    }
    if (update.callback_query?.data && update.callback_query.message) {
      const chatId = update.callback_query.message.chat.id;
      const reply = await this.handleCallback(chatId, update.callback_query.data);
      return { chatId, reply, callbackQueryId: update.callback_query.id };
    }
    return null;
  }

  private welcomeReply(session: ChatSession): BotReply {
    return {
      text:
        `👋 <b>Афиша культуры Башкортостана</b>\n\n` +
        `Подберу концерты, спектакли, выставки, кино и экскурсии по городам республики. ` +
        `Можете выбрать фильтры кнопками ниже или просто написать запрос своими словами — например:\n` +
        `<i>«Куда сходить в Уфе в выходные с ребёнком 7 лет до 1000 ₽?»</i>\n\n` +
        `<i>Неофициальный сервис команды хакатона (не является сервисом Минкультуры РБ).</i>`,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: buildMainMenuKeyboard(session) },
    };
  }

  private helpReply(): BotReply {
    return {
      text:
        `<b>Что умеет бот:</b>\n` +
        `• /start — главное меню с фильтрами\n` +
        `• /events — поиск событий по выбранным фильтрам\n` +
        `• /subscriptions — список ваших подписок и кнопка отписки\n` +
        `• /unsubscribe — удалить все подписки одной командой\n` +
        `• /cancel — сбросить текущий диалог и фильтры\n\n` +
        `Любой обычный текст передаётся ИИ-агенту (помнит контекст диалога, задаёт уточнения и объясняет подбор).`,
      parse_mode: 'HTML',
    };
  }

  async handleMessage(chatId: number | string, rawText: string): Promise<BotReply> {
    const text = rawText.trim();
    const session = this.sessions.get(chatId);

    if (text === '/start' || text.startsWith('/start ')) {
      const fresh = this.sessions.reset(chatId);
      return this.welcomeReply(fresh);
    }
    if (text === '/help') {
      return this.helpReply();
    }
    if (text === '/cancel') {
      const fresh = this.sessions.reset(chatId);
      return {
        text: 'Диалог и фильтры сброшены. Выберите новые параметры или напишите запрос:',
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: buildMainMenuKeyboard(fresh) },
      };
    }
    if (text === '/events') {
      session.page = 1;
      return this.fetchCatalogReply(session);
    }
    if (text === '/subscriptions') {
      return this.fetchSubscriptionsReply(session);
    }
    if (text === '/unsubscribe') {
      return this.unsubscribeAllReply(session);
    }

    return this.handleAssistantText(session, text);
  }

  async handleCallback(chatId: number | string, data: string): Promise<BotReply> {
    const session = this.sessions.get(chatId);

    if (data === 'menu:main') {
      return {
        text: `<b>Фильтры каталога</b> (${escapeHtml(filtersSummary(session))})`,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: buildMainMenuKeyboard(session) },
      };
    }
    if (data === 'menu:reset') {
      const fresh = this.sessions.reset(chatId);
      return {
        text: 'Фильтры и история диалога сброшены.',
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: buildMainMenuKeyboard(fresh) },
      };
    }
    if (data === 'menu:city') {
      return {
        text: 'Выберите город Башкортостана:',
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: buildCityKeyboard() },
      };
    }
    if (data === 'menu:cat') {
      return {
        text: 'Выберите категорию событий:',
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: buildCategoryKeyboard() },
      };
    }
    if (data === 'menu:per') {
      return {
        text: 'Выберите период:',
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: buildPeriodKeyboard() },
      };
    }

    if (data.startsWith('c:')) {
      const val = data.slice(2);
      session.city = val === 'all' ? null : val;
      session.page = 1;
      return {
        text: `Город: <b>${escapeHtml(session.city ? CITY_LABELS[session.city] ?? session.city : 'вся республика')}</b>`,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: buildMainMenuKeyboard(session) },
      };
    }
    if (data.startsWith('k:')) {
      const val = data.slice(2);
      session.category = val === 'all' ? null : val;
      session.page = 1;
      return {
        text: `Категория: <b>${escapeHtml(session.category ? CATEGORY_LABELS[session.category] ?? session.category : 'любая')}</b>`,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: buildMainMenuKeyboard(session) },
      };
    }
    if (data.startsWith('p:')) {
      const val = data.slice(2);
      session.period =
        val === 'today' || val === 'tomorrow' || val === 'weekend' || val === 'week' ? val : null;
      session.page = 1;
      return {
        text: `Период: <b>${escapeHtml(session.period ? PERIOD_LABELS[session.period] ?? session.period : 'любой')}</b>`,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: buildMainMenuKeyboard(session) },
      };
    }
    if (data === 'f:toggle') {
      session.freeOnly = !session.freeOnly;
      session.page = 1;
      return {
        text: `Фильтр «только бесплатные»: <b>${session.freeOnly ? 'включён' : 'выключен'}</b>`,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: buildMainMenuKeyboard(session) },
      };
    }

    if (data.startsWith('ev:list:') || data.startsWith('pg:')) {
      const page = Number.parseInt(data.split(':').pop() ?? '1', 10) || 1;
      session.page = Math.max(1, page);
      return this.fetchCatalogReply(session);
    }

    if (data.startsWith('ev:d:')) {
      const token = data.slice(5);
      const eventId = session.eventRefs.get(token);
      if (!eventId) {
        return {
          text: 'Карточка устарела, пожалуйста повторите поиск.',
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: buildMainMenuKeyboard(session) },
        };
      }
      try {
        const ev = await this.api.getEvent(eventId);
        return {
          text: formatEventCardHtml(ev, { publicWebUrl: this.config.publicWebUrl }),
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [[btn('🔎 К списку', `pg:${session.page}`), btn('⚙️ Меню', 'menu:main')]] },
        };
      } catch {
        return {
          text: 'Не удалось загрузить карточку события.',
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [[btn('⚙️ Меню', 'menu:main')]] },
        };
      }
    }

    if (data === 'sub:new') {
      try {
        await this.api.createSubscription({
          user_ref: session.userRef,
          city: session.city,
          category: session.category,
          period: session.period ?? 'weekend',
        });
        return {
          text: `🔔 Подписка оформлена (${escapeHtml(filtersSummary(session))}). Отписаться можно в любой момент командой /unsubscribe.`,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: buildMainMenuKeyboard(session) },
        };
      } catch (err) {
        if (err instanceof ApiHttpError && err.status === 409) {
          return {
            text: 'Такая подписка у вас уже оформлена. Посмотреть все: /subscriptions',
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: buildMainMenuKeyboard(session) },
          };
        }
        return {
          text: 'Не удалось оформить подписку. Попробуйте позже.',
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: buildMainMenuKeyboard(session) },
        };
      }
    }

    if (data === 'sub:list') {
      return this.fetchSubscriptionsReply(session);
    }

    if (data.startsWith('unsub:')) {
      const token = data.slice(6);
      const subId = session.subRefs.get(token);
      if (!subId) {
        return { text: 'Подписка не найдена. Откройте /subscriptions заново.', parse_mode: 'HTML' };
      }
      await this.api.deleteSubscription(subId, session.userRef);
      return this.fetchSubscriptionsReply(session);
    }

    if (data.startsWith('qr:')) {
      const idx = Number.parseInt(data.slice(3), 10);
      const replyText = session.quickReplies[idx];
      if (!replyText) {
        return { text: 'Быстрый ответ устарел — напишите текстом.', parse_mode: 'HTML' };
      }
      return this.handleAssistantText(session, replyText);
    }

    if (data.startsWith('cfm:y:') || data.startsWith('cfm:n:')) {
      const approve = data.startsWith('cfm:y:');
      const token = data.slice(6);
      const pending = session.pendingConfirmations.get(token);
      if (!pending || pending.resolved) {
        return {
          text: 'Это подтверждение уже обработано.',
          parse_mode: 'HTML',
          callback_alert: 'Уже обработано',
        };
      }
      pending.resolved = true;
      try {
        const res = await this.api.confirmAssistant({
          confirmation_id: pending.confirmationId,
          decision: approve ? 'approve' : 'reject',
        });
        return {
          text: escapeHtml(res.message ?? (approve ? 'Готово: действие выполнено.' : 'Действие отменено.')),
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: buildMainMenuKeyboard(session) },
        };
      } catch {
        return {
          text: 'Не удалось завершить подтверждение. Попробуйте ещё раз.',
          parse_mode: 'HTML',
        };
      }
    }

    return this.welcomeReply(session);
  }

  private async fetchCatalogReply(session: ChatSession, headerNotice?: string): Promise<BotReply> {
    const res = await this.api.getEvents({
      city: session.city ?? undefined,
      category: session.category ?? undefined,
      date: session.period ?? undefined,
      free: session.freeOnly || undefined,
      page: session.page,
      page_size: 5,
    });
    return formatEventListReply(session, this.sessions, res, headerNotice);
  }

  private async fetchSubscriptionsReply(session: ChatSession): Promise<BotReply> {
    const { items } = await this.api.getSubscriptions(session.userRef);
    if (items.length === 0) {
      return {
        text: 'У вас пока нет активных подписок. Выберите фильтры в /start и нажмите «Подписаться».',
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: buildMainMenuKeyboard(session) },
      };
    }

    const lines = ['<b>Ваши подписки:</b>', ''];
    const keyboard: InlineButton[][] = [];
    items.forEach((sub, idx) => {
      const city = sub.city ? CITY_LABELS[sub.city] ?? sub.city : 'все города';
      const cat = sub.category ? CATEGORY_LABELS[sub.category] ?? sub.category : 'все категории';
      const per = sub.period ? PERIOD_LABELS[sub.period] ?? sub.period : 'любой период';
      lines.push(`${idx + 1}. ${escapeHtml(city)} · ${escapeHtml(cat)} · ${escapeHtml(per)}`);
      const token = this.sessions.registerSubRef(session, sub.id);
      keyboard.push([btn(`❌ Отписаться от #${idx + 1}`, `unsub:${token}`)]);
    });
    keyboard.push([btn('⬅️ Главное меню', 'menu:main')]);

    return {
      text: lines.join('\n'),
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard },
    };
  }

  private async unsubscribeAllReply(session: ChatSession): Promise<BotReply> {
    const { items } = await this.api.getSubscriptions(session.userRef);
    if (items.length === 0) {
      return { text: 'Активных подписок нет.', parse_mode: 'HTML' };
    }
    for (const sub of items) {
      await this.api.deleteSubscription(sub.id, session.userRef);
    }
    return {
      text: `✅ Все подписки удалены (${items.length}). Новых уведомлений приходить не будет.`,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: buildMainMenuKeyboard(session) },
    };
  }

  private async handleAssistantText(session: ChatSession, text: string): Promise<BotReply> {
    this.sessions.pushHistory(session, 'user', text);
    try {
      const res = await this.api.queryAssistant({
        message: text,
        user_ref: session.userRef,
        previous: session.lastConstraints,
        history: session.history.slice(0, -1),
        answering: session.lastClarifyCode,
        limit: 5,
      });

      this.sessions.pushHistory(session, 'assistant', res.message);
      if (res.action !== 'out_of_scope') {
        session.lastConstraints = res.constraints;
      }

      if (res.action === 'clarify' && res.clarify) {
        session.lastClarifyCode = res.clarify.code;
        session.quickReplies = res.clarify.quick_replies ?? [];
        const qrRows: InlineButton[][] = [];
        for (let i = 0; i < session.quickReplies.length; i += 2) {
          qrRows.push(
            session.quickReplies
              .slice(i, i + 2)
              .map((label, j) => btn(label.slice(0, 32), `qr:${i + j}`)),
          );
        }
        return {
          text: escapeHtml(res.message),
          parse_mode: 'HTML',
          ...(qrRows.length > 0 ? { reply_markup: { inline_keyboard: qrRows } } : {}),
        };
      }

      session.lastClarifyCode = undefined;
      session.quickReplies = [];

      if (res.action === 'confirmation_required' && res.confirmation) {
        const token = this.sessions.registerConfirmation(session, res.confirmation.confirmation_id);
        return {
          text: `${escapeHtml(res.message)}\n\n<i>Подтвердите действие кнопкой ниже:</i>`,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[
              btn('✅ Подтвердить', `cfm:y:${token}`),
              btn('✖ Отменить', `cfm:n:${token}`),
            ]],
          },
        };
      }

      const lines = [escapeHtml(res.message)];
      const itemButtons: InlineButton[] = [];
      const results = res.results ?? [];
      if (results.length > 0) {
        lines.push('');
        results.forEach((item, idx) => {
          lines.push(formatEventShortLine(item.event, idx + 1));
          if (item.reasons.length > 0) {
            lines.push(`   <i>${escapeHtml(item.reasons.slice(0, 2).join('; '))}</i>`);
          }
          if (item.caveats.length > 0) {
            lines.push(`   ⚠️ ${escapeHtml(item.caveats.join('; '))}`);
          }
          lines.push('');
          const shortId = this.sessions.registerEventRef(session, item.event.id);
          itemButtons.push(btn(`№${idx + 1}`, `ev:d:${shortId}`));
        });
      }

      const keyboard: InlineButton[][] = [];
      if (itemButtons.length > 0) keyboard.push(itemButtons);
      keyboard.push([btn('⚙️ Меню и фильтры', 'menu:main')]);

      return {
        text: lines.join('\n').trim(),
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard },
      };
    } catch (err) {
      // ТЗ п. 7.5: при недоступности/503/тайм-ауте модели автоматически переключаемся на поиск по каталогу
      const isAssistantUnavailable =
        (err instanceof ApiHttpError && err.status >= 500) ||
        !(err instanceof ApiHttpError);
      if (!isAssistantUnavailable) {
        return {
          text: escapeHtml((err as Error).message),
          parse_mode: 'HTML',
        };
      }

      const fallbackParams = extractFallbackParams(text, session);
      try {
        const res = await this.api.getEvents(fallbackParams);
        return formatEventListReply(
          session,
          this.sessions,
          res,
          '⚠️ <i>ИИ-помощник временно недоступен — показаны результаты обычного поиска по каталогу.</i>',
        );
      } catch {
        return {
          text: '⚠️ Сервис поиска временно недоступен. Попробуйте через минуту.',
          parse_mode: 'HTML',
        };
      }
    }
  }
}

export function extractEventUrlsForCheck(event: BotEvent): string[] {
  return [event.source_url, ...(event.org_link ? [event.org_link] : [])];
}
