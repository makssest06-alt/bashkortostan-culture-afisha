/**
 * Конфигурация бэкенда из переменных окружения.
 * Никаких секретов в коде нет; заглушка из .env.example никогда не принимается за токен админа.
 */

export const EXAMPLE_ADMIN_TOKEN = 'change-me-to-a-long-random-string';

export interface AppConfig {
  port: number;
  databaseUrl: string;
  pgliteDataDir: string;
  adminToken: string | undefined;
  adminOpen: boolean;
  publicWebUrl: string;
  assistantDisabled: boolean;
  llmApiKey: string | undefined;
  llmBaseUrl: string;
  llmModel: string;
  llmTimeoutMs: number;
  feedbackRetentionDays: number;
  metricsRatePerMinute: number;
  trustProxy: boolean;
  llmCostInRubPer1k?: number;
  llmCostOutRubPer1k?: number;
}

function parseOptionalRate(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const num = Number.parseFloat(raw.trim().replace(',', '.'));
  return Number.isFinite(num) && num >= 0 ? num : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const rawToken = env.ADMIN_TOKEN?.trim();
  const adminToken = rawToken && rawToken !== EXAMPLE_ADMIN_TOKEN ? rawToken : undefined;
  const port = Number.parseInt(env.PORT ?? '8000', 10);

  return {
    port: Number.isFinite(port) && port > 0 ? port : 8000,
    databaseUrl: (env.DATABASE_URL ?? '').trim(),
    pgliteDataDir: (env.PGLITE_DATA_DIR ?? './data/pglite').trim(),
    adminToken,
    adminOpen: env.ADMIN_OPEN === '1',
    publicWebUrl: (env.PUBLIC_WEB_URL ?? 'http://localhost:3210').replace(/\/+$/, ''),
    assistantDisabled: env.ASSISTANT_DISABLED === '1',
    llmApiKey: env.LLM_API_KEY?.trim() || undefined,
    llmBaseUrl: (env.LLM_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/+$/, ''),
    llmModel: (env.LLM_MODEL ?? 'gpt-4o-mini').trim(),
    llmTimeoutMs: Math.max(1000, Number.parseInt(env.LLM_TIMEOUT_MS ?? '12000', 10) || 12000),
    feedbackRetentionDays: Math.max(1, Number.parseInt(env.FEEDBACK_RETENTION_DAYS ?? '90', 10) || 90),
    metricsRatePerMinute: Math.max(10, Number.parseInt(env.METRICS_RATE_LIMIT ?? '120', 10) || 120),
    trustProxy: env.TRUST_PROXY !== '0',
    llmCostInRubPer1k: parseOptionalRate(env.LLM_COST_IN_RUB_PER_1K, 0.015),
    llmCostOutRubPer1k: parseOptionalRate(env.LLM_COST_OUT_RUB_PER_1K, 0.06),
  };
}
