import { fileURLToPath } from 'node:url';

import { z } from 'zod';

const emptyToUndefined = (value: unknown) => (value === '' ? undefined : value);

const envBoolean = z.preprocess((value) => {
  if (value === undefined || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}, z.boolean());

const DEFAULT_BRAND_IMAGE_PATH = fileURLToPath(
  new URL('../assets/token-height.png', import.meta.url),
);

const EnvSchema = z.object({
  TELEGRAM_BOT_TOKEN: z
    .string({
      error: 'TELEGRAM_BOT_TOKEN обязателен: без него бот не сможет подключиться к Telegram',
    })
    .min(1, 'TELEGRAM_BOT_TOKEN обязателен')
    .regex(
      /^\d{5,15}:[A-Za-z0-9_-]{20,}$/,
      'TELEGRAM_BOT_TOKEN не похож на токен от @BotFather',
    ),
  API_BASE_URL: z.preprocess(
    emptyToUndefined,
    z.string().url('API_BASE_URL должен быть абсолютным http(s)-адресом').default('http://localhost:8000'),
  ),
  API_TIMEOUT_MS: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(500).max(60_000).default(10_000),
  ),
  API_RETRY_ATTEMPTS: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(0).max(5).default(2),
  ),
  LOG_LEVEL: z.preprocess(
    emptyToUndefined,
    z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  ),
  PUBLIC_WEB_URL: z.preprocess(
    emptyToUndefined,
    z.string().url('PUBLIC_WEB_URL должен быть абсолютным http(s)-адресом').optional(),
  ),
  SESSION_TTL_MINUTES: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(5).max(1440).default(120),
  ),
  CALLBACK_TTL_MINUTES: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(5).max(1440).default(720),
  ),
  RATE_LIMIT_PER_MINUTE: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(0).max(120).default(20),
  ),
  LOG_HASH_SECRET: z.preprocess(
    emptyToUndefined,
    z.string().min(16, 'LOG_HASH_SECRET должен быть не короче 16 символов').max(200).optional(),
  ),
  USER_REF_SECRET: z.preprocess(
    emptyToUndefined,
    z.string().min(16, 'USER_REF_SECRET должен быть не короче 16 символов').max(200).optional(),
  ),
  USER_REF_MODE: z.preprocess(
    emptyToUndefined,
    z.enum(['hmac', 'legacy']).default('hmac'),
  ),
  ASSISTANT_ENABLED: envBoolean.default(false),
  ASSISTANT_CONFIRMATIONS: envBoolean.default(false),
  BRAND_IMAGE_PATH: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .optional()
      .transform((value) => {
        if (!value) return DEFAULT_BRAND_IMAGE_PATH;
        if (value === 'off' || value === 'none' || value === '0') return null;
        return value;
      }),
  ),
});

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface BotConfig {
  telegramBotToken: string;
  apiBaseUrl: string;
  apiTimeoutMs: number;
  logLevel: LogLevel;
  publicWebUrl: string | null;
  sessionTtlMs: number;
  /** Необязательные поля: тесты могут собирать конфиг без них. */
  callbackTtlMs?: number;
  apiRetryAttempts?: number;
  rateLimitPerMinute?: number;
  brandImagePath?: string | null;
  /** Ключ HMAC для псевдонимов в логах; по умолчанию — токен бота. */
  logHashSecret?: string | null;
  /** Ключ HMAC для user_ref подписок; по умолчанию — logHashSecret или токен. */
  userRefSecret?: string | null;
  /** `hmac` — непредсказуемый user_ref, `legacy` — откат к telegram_<id>. */
  userRefMode?: 'hmac' | 'legacy';
  /** Ассистент в боте; по умолчанию выключен. */
  assistantEnabled?: boolean;
  /** Подтверждения ассистента; P0-4 исправлен, флаг включается осознанно. */
  assistantConfirmations?: boolean;
}

export class ConfigError extends Error {
  readonly fields: string[];

  constructor(fields: string[], message = 'Проверьте переменные окружения бота') {
    super(message);
    this.name = 'ConfigError';
    this.fields = fields;
  }
}

/**
 * Убирает завершающие слэши и случайный суффикс /api/v1, чтобы клиент всегда
 * собирал адрес как `${base}/api/v1/...`.
 */
export function normalizeBaseUrl(raw: string): string {
  let value = raw.trim().replace(/\/+$/, '');
  value = value.replace(/\/api\/v1$/i, '');
  return value.replace(/\/+$/, '');
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BotConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    // Не выводим значения переменных: в TELEGRAM_BOT_TOKEN лежит секрет.
    const fields = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.') || 'env'))];
    const message = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`)
      .join('; ');
    throw new ConfigError(fields, `Некорректная конфигурация бота: ${message}`);
  }

  const value = parsed.data;
  return {
    telegramBotToken: value.TELEGRAM_BOT_TOKEN,
    apiBaseUrl: normalizeBaseUrl(value.API_BASE_URL),
    apiTimeoutMs: value.API_TIMEOUT_MS,
    apiRetryAttempts: value.API_RETRY_ATTEMPTS,
    logLevel: value.LOG_LEVEL,
    publicWebUrl: value.PUBLIC_WEB_URL ? value.PUBLIC_WEB_URL.replace(/\/+$/, '') : null,
    sessionTtlMs: value.SESSION_TTL_MINUTES * 60_000,
    callbackTtlMs: value.CALLBACK_TTL_MINUTES * 60_000,
    rateLimitPerMinute: value.RATE_LIMIT_PER_MINUTE,
    brandImagePath: value.BRAND_IMAGE_PATH,
    logHashSecret: value.LOG_HASH_SECRET ?? null,
    userRefSecret: value.USER_REF_SECRET ?? null,
    userRefMode: value.USER_REF_MODE,
    assistantEnabled: value.ASSISTANT_ENABLED,
    assistantConfirmations: value.ASSISTANT_CONFIRMATIONS,
  };
}
