/**
 * Конфигурация бэкенда из переменных окружения.
 * Никаких секретов в коде нет; заглушка из .env.example никогда не принимается за токен админа.
 */

export const EXAMPLE_ADMIN_TOKEN = 'change-me-to-a-long-random-string';

/** Минимальная длина токена админки в production: 32 случайных символа. */
export const MIN_PRODUCTION_ADMIN_TOKEN_LENGTH = 32;

export interface AppConfig {
  port: number;
  /** Адрес, на котором слушает API. По умолчанию только localhost; в Docker — 0.0.0.0. */
  host: string;
  databaseUrl: string;
  pgliteDataDir: string;
  adminToken: string | undefined;
  adminOpen: boolean;
  production: boolean;
  publicWebUrl: string;
  assistantDisabled: boolean;
  llmApiKey: string | undefined;
  llmBaseUrl: string;
  llmModel: string;
  llmTimeoutMs: number;
  feedbackRetentionDays: number;
  metricsRatePerMinute: number;
  /** Bearer-токен для /metrics. В production без него метрики скрыты. */
  metricsToken: string | undefined;
  /** Лимит публичных GET на IP в минуту (backstop от scraping/amplification). */
  readRatePerMinute: number;
  trustProxy: boolean;
  /** Сколько доверенных прокси стоит между клиентом и API (по умолчанию 1). */
  trustedProxyHops: number;
  assistantRatePer10Min: number;
  assistantDailyLimit: number;
  assistantConfirmPer10Min: number;
  assistantMaxTokens: number;
  assistantDailyBudgetRub: number;
  assistantTraceRetentionDays: number;
  confirmationRetentionDays: number;
  rawRecordRetentionDays: number;
  importRetentionDays: number;
  auditRetentionDays: number;
  subscriptionInactiveDays: number;
  llmCostInRubPer1k?: number;
  llmCostOutRubPer1k?: number;
}

function parseOptionalRate(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const num = Number.parseFloat(raw.trim().replace(',', '.'));
  return Number.isFinite(num) && num >= 0 ? num : fallback;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const num = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(num) && num > 0 ? num : fallback;
}

/**
 * `TRUST_PROXY=0` — заголовкам не верим; `1`/`true` — один доверенный прокси;
 * число N — N доверенных прокси (берём адрес с конца цепочки X-Forwarded-For).
 */
export function parseTrustProxy(raw: string | undefined): {
  trustProxy: boolean;
  trustedProxyHops: number;
} {
  const value = (raw ?? '').trim().toLowerCase();
  if (!value || value === '0' || value === 'false' || value === 'no') {
    return { trustProxy: false, trustedProxyHops: 0 };
  }
  if (value === 'true' || value === 'yes') {
    return { trustProxy: true, trustedProxyHops: 1 };
  }
  const hops = Number.parseInt(value, 10);
  if (Number.isFinite(hops) && hops >= 1) {
    return { trustProxy: true, trustedProxyHops: hops };
  }
  return { trustProxy: false, trustedProxyHops: 0 };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const production = env.NODE_ENV === 'production';
  const rawToken = env.ADMIN_TOKEN?.trim();
  const adminToken = rawToken && rawToken !== EXAMPLE_ADMIN_TOKEN ? rawToken : undefined;
  const adminOpenRequested = env.ADMIN_OPEN === '1';
  const port = Number.parseInt(env.PORT ?? '8000', 10);
  const proxy = parseTrustProxy(env.TRUST_PROXY);

  if (production && adminOpenRequested) {
    throw new Error(
      'ADMIN_OPEN=1 запрещён в production: админка должна быть закрыта Bearer-токеном. Уберите ADMIN_OPEN и задайте ADMIN_TOKEN.',
    );
  }
  if (production) {
    if (!adminToken) {
      throw new Error(
        'В production обязателен ADMIN_TOKEN (случайная строка не короче 32 символов). Админка без токена не запускается.',
      );
    }
    if (adminToken.length < MIN_PRODUCTION_ADMIN_TOKEN_LENGTH) {
      throw new Error(
        `В production ADMIN_TOKEN должен быть не короче ${MIN_PRODUCTION_ADMIN_TOKEN_LENGTH} символов. Сгенерируйте: openssl rand -hex 32`,
      );
    }
    const metricsToken = env.METRICS_TOKEN?.trim();
    if (metricsToken && metricsToken.length < MIN_PRODUCTION_ADMIN_TOKEN_LENGTH) {
      throw new Error(
        `В production METRICS_TOKEN должен быть не короче ${MIN_PRODUCTION_ADMIN_TOKEN_LENGTH} символов.`,
      );
    }
  }

  return {
    port: Number.isFinite(port) && port > 0 ? port : 8000,
    host: (env.HOST ?? '127.0.0.1').trim() || '127.0.0.1',
    databaseUrl: (env.DATABASE_URL ?? '').trim(),
    pgliteDataDir: (env.PGLITE_DATA_DIR ?? './data/pglite').trim(),
    adminToken,
    adminOpen: adminOpenRequested && !production,
    production,
    publicWebUrl: (env.PUBLIC_WEB_URL ?? 'http://localhost:3210').replace(/\/+$/, ''),
    assistantDisabled: env.ASSISTANT_DISABLED === '1',
    llmApiKey: env.LLM_API_KEY?.trim() || undefined,
    llmBaseUrl: (env.LLM_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/+$/, ''),
    llmModel: (env.LLM_MODEL ?? 'gpt-4o-mini').trim(),
    llmTimeoutMs: Math.max(1000, Number.parseInt(env.LLM_TIMEOUT_MS ?? '12000', 10) || 12000),
    feedbackRetentionDays: Math.max(1, Number.parseInt(env.FEEDBACK_RETENTION_DAYS ?? '90', 10) || 90),
    metricsRatePerMinute: Math.max(10, Number.parseInt(env.METRICS_RATE_LIMIT ?? '120', 10) || 120),
    metricsToken: env.METRICS_TOKEN?.trim() || undefined,
    readRatePerMinute: Math.max(60, Number.parseInt(env.READ_RATE_LIMIT ?? '600', 10) || 600),
    trustProxy: proxy.trustProxy,
    trustedProxyHops: proxy.trustedProxyHops,
    assistantRatePer10Min: parsePositiveInt(env.ASSISTANT_RATE_LIMIT_10M, 20),
    assistantDailyLimit: parsePositiveInt(env.ASSISTANT_DAILY_LIMIT, 200),
    assistantConfirmPer10Min: parsePositiveInt(env.ASSISTANT_CONFIRM_LIMIT_10M, 20),
    assistantMaxTokens: Math.min(4096, Math.max(64, parsePositiveInt(env.ASSISTANT_MAX_TOKENS, 800))),
    assistantDailyBudgetRub: parseOptionalRate(env.ASSISTANT_DAILY_BUDGET_RUB, 100),
    assistantTraceRetentionDays: parsePositiveInt(env.ASSISTANT_TRACE_RETENTION_DAYS, 30),
    confirmationRetentionDays: parsePositiveInt(env.CONFIRMATION_RETENTION_DAYS, 7),
    rawRecordRetentionDays: parsePositiveInt(env.RAW_RECORD_RETENTION_DAYS, 180),
    importRetentionDays: parsePositiveInt(env.IMPORT_RETENTION_DAYS, 180),
    auditRetentionDays: parsePositiveInt(env.AUDIT_RETENTION_DAYS, 365),
    subscriptionInactiveDays: parsePositiveInt(env.SUBSCRIPTION_INACTIVE_DAYS, 180),
    llmCostInRubPer1k: parseOptionalRate(env.LLM_COST_IN_RUB_PER_1K, 0.015),
    llmCostOutRubPer1k: parseOptionalRate(env.LLM_COST_OUT_RUB_PER_1K, 0.06),
  };
}
