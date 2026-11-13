/**
 * Внешние ссылки сайта.
 *
 * Адрес Telegram-бота в репозитории команды пока не записан, а выдумывать имя бота нельзя:
 * ссылка на несуществующего бота хуже её отсутствия. Поэтому адрес берётся из переменной
 * окружения NEXT_PUBLIC_TELEGRAM_BOT_URL (например, https://t.me/имя_бота).
 * Пока она не задана, ссылка ведёт на сайт Telegram, а флаг TELEGRAM_BOT_IS_SET равен false:
 * по нему интерфейс может показать пометку «бот скоро».
 */

const configuredBotUrl = (process.env.NEXT_PUBLIC_TELEGRAM_BOT_URL ?? '').trim();

export const TELEGRAM_BOT_IS_SET = /^https:\/\/t\.me\/[A-Za-z0-9_]{5,}/.test(configuredBotUrl);

export const TELEGRAM_BOT_URL = TELEGRAM_BOT_IS_SET ? configuredBotUrl : 'https://t.me/';

/** Внутренние адреса разделов: одно место, чтобы ссылки в сценах и в подвале не расходились. */
export const ROUTES = {
  home: '/',
  events: '/events',
  ask: '/ask',
  widget: '/widget',
  developers: '/developers',
  about: '/about',
  aboutDemo: '/about#demo',
  aboutDedup: '/about#dedup',
  aboutVerify: '/about#verify',
  apiDocs: '/developers#api',
} as const;
