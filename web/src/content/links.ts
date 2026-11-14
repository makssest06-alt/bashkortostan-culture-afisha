/**
 * Внешние ссылки сайта.
 *
 * Адрес Telegram-бота берётся из NEXT_PUBLIC_TELEGRAM_BOT_URL; если переменная
 * не задана, используется бот проекта @bash_hackathon102bot. Пустой https://t.me/
 * не отдаём: это выглядит как рабочая ссылка, но ведёт в никуда.
 */

const configuredBotUrl = (process.env.NEXT_PUBLIC_TELEGRAM_BOT_URL ?? '').trim();
const DEFAULT_BOT_URL = 'https://t.me/bash_hackathon102bot';

export const TELEGRAM_BOT_IS_SET = /^https:\/\/t\.me\/[A-Za-z0-9_]{5,}/.test(
  configuredBotUrl || DEFAULT_BOT_URL,
);

export const TELEGRAM_BOT_URL =
  configuredBotUrl && TELEGRAM_BOT_IS_SET ? configuredBotUrl : DEFAULT_BOT_URL;

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
