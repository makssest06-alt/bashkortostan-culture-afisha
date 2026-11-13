import { z } from 'zod';

const emptyToUndefined = (value: unknown) => (value === '' ? undefined : value);

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
});

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface BotConfig {
  telegramBotToken: string;
  apiBaseUrl: string;
  apiTimeoutMs: number;
  logLevel: LogLevel;
  publicWebUrl: string | null;
  sessionTtlMs: number;
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
    logLevel: value.LOG_LEVEL,
    publicWebUrl: value.PUBLIC_WEB_URL ? value.PUBLIC_WEB_URL.replace(/\/+$/, '') : null,
    sessionTtlMs: value.SESSION_TTL_MINUTES * 60_000,
  };
}
