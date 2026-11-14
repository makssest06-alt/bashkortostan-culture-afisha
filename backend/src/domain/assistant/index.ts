import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';

import type { AppConfig } from '../../config.js';
import type { Database } from '../../db/adapter.js';
import { logEvent } from '../../observability/logger.js';
import type { MetricsRegistry } from '../../observability/metrics.js';
import type { SlidingRateLimiter } from '../rate-limit.js';
import { USER_REF_PATTERN } from '../subscriptions.js';
import { formatRfc3339Local, localNow, TZ_OFFSET } from '../time.js';
import type { ApiErrorDetail } from '../types.js';
import { PROMPT_VERSION, runLlmAgent, LlmError } from './llm.js';
import {
  maskPii,
  MAX_MESSAGE_LENGTH,
  MAX_RESULT_LIMIT,
  runDeterministicAssistant,
  type AssistantRequest,
  type AssistantResponsePayload,
} from './nlu.js';
import { ToolRuntime } from './tools.js';

export { confirmPendingAction } from './tools.js';

const ClarifyEnum = z.enum([
  'city',
  'date',
  'time',
  'child_age',
  'participants',
  'budget',
  'category',
  'audience',
  'location',
  'contradiction',
]);

/** Ограничение числа ключей: защита от раздутых JSON-объектов (zod CVE + память). */
const BoundedRecord = z
  .record(z.string(), z.unknown())
  .refine((value) => Object.keys(value).length <= 100, 'Слишком много полей');

const AssistantRequestSchema = z.object({
  message: z.string().max(MAX_MESSAGE_LENGTH, `Сообщение не длиннее ${MAX_MESSAGE_LENGTH} знаков`).optional(),
  previous: BoundedRecord.nullable().optional(),
  patch: z
    .object({
      reset: z.boolean().optional(),
      set: BoundedRecord.optional(),
      unset: z.array(z.string()).max(50).optional(),
    })
    .nullable()
    .optional(),
  answering: ClarifyEnum.nullable().optional(),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().max(MAX_MESSAGE_LENGTH),
      }),
    )
    .max(12)
    .optional(),
  limit: z.number().int().min(1).max(MAX_RESULT_LIMIT).nullable().optional(),
  user_ref: z
    .string()
    .regex(USER_REF_PATTERN, 'user_ref должен содержать 16–128 символов [A-Za-z0-9_-]')
    .optional(),
  channel: z.enum(['telegram', 'web', 'api']).optional(),
});

export function parseAssistantRequestBody(
  raw: unknown,
): { ok: true; value: AssistantRequest } | { ok: false; details: ApiErrorDetail[] } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      details: [{ field: 'body', message: 'Тело запроса должно быть объектом JSON' }],
    };
  }
  const parsed = AssistantRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      details: parsed.error.issues.map((i) => ({
        field: i.path.join('.') || 'body',
        message: i.message,
      })),
    };
  }
  const msg = parsed.data.message?.trim();
  if (!msg && !parsed.data.patch) {
    return {
      ok: false,
      details: [{ field: 'message', message: 'Нужна фраза в поле message или правка условий в поле patch' }],
    };
  }
  return {
    ok: true,
    value: {
      message: msg,
      previous: parsed.data.previous as AssistantRequest['previous'],
      patch: parsed.data.patch as AssistantRequest['patch'],
      answering: parsed.data.answering ?? undefined,
      history: parsed.data.history,
      limit: parsed.data.limit ?? undefined,
      user_ref: parsed.data.user_ref,
      channel: parsed.data.channel,
    },
  };
}

/** Потрачено на LLM за текущие локальные сутки (+05:00) по трассам. */
async function assistantSpendTodayRub(db: Database, now: Date): Promise<number> {
  const today = localNow(now).date;
  const res = await db.query<{ total: string | number }>(
    `SELECT COALESCE(SUM(cost_rub), 0) AS total FROM agent_traces WHERE created_at >= $1`,
    [`${today}T00:00:00${TZ_OFFSET}`],
  );
  const total = Number(res.rows[0]?.total ?? 0);
  return Number.isFinite(total) && total >= 0 ? total : 0;
}

/**
 * Оценка максимальной стоимости одного запроса. Резервируется до вызова LLM,
 * чтобы параллельные запросы не прошли проверку бюджета одновременно.
 */
let budgetReservedRub = 0;

function estimateMaxLlmCostRub(config: AppConfig): number {
  const inputTokens = 6_000;
  const outputTokens = config.assistantMaxTokens;
  const inRate = config.llmCostInRubPer1k ?? 0.015;
  const outRate = config.llmCostOutRubPer1k ?? 0.06;
  return Math.round(((inputTokens / 1000) * inRate + (outputTokens / 1000) * outRate) * 10_000) / 10_000;
}

/** Уточнения, которые rules задаёт по структурным правилам и не стоит переспрашивать у LLM. */
const STRUCTURAL_CLARIFY = new Set(['city', 'date', 'child_age', 'contradiction']);

/**
 * Политика hybrid-режима: LLM подключается, только если детерминированный
 * движок не понял свободную формулировку (нет ограничений / пустая выдача)
 * или задаёт необязательное смысловое уточнение. Guardrails и запись в БД
 * никогда не эскалируются.
 */
export function hybridEscalationReason(
  request: AssistantRequest,
  response: AssistantResponsePayload,
): string | null {
  if (!request.message?.trim()) return null;
  if (response.action === 'out_of_scope' || response.action === 'confirmation_required') return null;

  if (response.action === 'clarify') {
    const code = response.clarify?.code;
    return code && !STRUCTURAL_CLARIFY.has(code) ? `clarify_${code}` : null;
  }

  if (response.action === 'search') {
    if (response.total === 0) return 'no_results';
    const hard = response.constraints?.hard ?? {};
    const soft = response.constraints?.soft ?? {};
    if (Object.keys(hard).length === 0 && Object.keys(soft).length === 0) return 'no_constraints';
  }

  return null;
}

const SENSITIVE_PLAN_KEY = /^(title_query|topic_query|venue_query|geo_query|semantic_query|q|text|name|contact|email|phone|organization)$/i;

/** Рекурсивно убирает свободный текст/ПДн из plan перед записью в трассу. */
function sanitizeTracePlan(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[depth]';
  if (typeof value === 'string') return maskPii(value).slice(0, 200);
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeTracePlan(item, depth + 1));
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 100)) {
    out[key] = SENSITIVE_PLAN_KEY.test(key) ? '[redacted]' : sanitizeTracePlan(item, depth + 1);
  }
  return out;
}

export async function runAssistantPipeline(
  db: Database,
  config: AppConfig,
  request: AssistantRequest,
  options: {
    requestId: string;
    clientIp: string;
    rateLimiter?: SlidingRateLimiter;
    metrics?: MetricsRegistry;
    now?: Date;
  },
): Promise<AssistantResponsePayload> {
  const now = options.now ?? new Date();
  const startedMs = Date.now();
  const traceId = randomUUID();
  const channel = request.channel ?? 'web';
  const maskedUserRef = request.user_ref
    ? `u_${createHash('sha256').update(request.user_ref).digest('hex').slice(0, 16)}`
    : null;

  const runtime = new ToolRuntime(db, {
    requestId: options.requestId,
    userRef: request.user_ref,
    channel,
    clientIp: options.clientIp,
    // P0: подтверждение выдаётся только через /assistant/confirm.
    // Токен из тела query-запроса больше не принимается и не может обойти confirm.
    rateLimiter: options.rateLimiter,
    retentionDays: config.feedbackRetentionDays,
    metrics: options.metrics,
    now,
  });

  let payload: AssistantResponsePayload;
  let tokenUsage: Record<string, number> | null = null;
  let costRub: number | null = null;
  let modelUsed: string | null = null;
  let planObj: Record<string, unknown> | null = null;
  let fallbackUsed = false;
  let errorText: string | null = null;

  // P0-3: дневной бюджет. При его исчерпании LLM не вызывается вообще —
  // ассистент отвечает по rules-движку, деньги не тратятся молча.
  const engineMode = config.assistantEngine;
  const llmConfigured = Boolean(config.llmApiKey);
  let llmFallbackReason: 'budget' | 'error' | null = null;

  const rulesFallback = (engineName: string) =>
    runDeterministicAssistant(request, runtime, now, engineName);

  const runRules = async (): Promise<AssistantResponsePayload> => {
    const rulesPayload = await rulesFallback('rules-v2');
    planObj = {
      constraints: rulesPayload.constraints,
      engine_mode: engineMode,
      route: 'rules',
      ...(llmConfigured && engineMode !== 'rules' ? { llm: 'not_called' } : {}),
    };
    return rulesPayload;
  };

  /** Возвращает ответ LLM или null, если сработал бюджет/ошибка. */
  const runLlm = async (): Promise<AssistantResponsePayload | null> => {
    const spent = await assistantSpendTodayRub(db, now);
    const budget = config.assistantDailyBudgetRub;
    const estimate = estimateMaxLlmCostRub(config);
    const budgetExceeded = spent >= budget || spent + budgetReservedRub + estimate > budget;
    if (budgetExceeded) {
      fallbackUsed = true;
      llmFallbackReason = 'budget';
      errorText =
        spent >= budget
          ? `daily_budget_exhausted: ${spent.toFixed(4)} ₽ >= ${budget} ₽`
          : `daily_budget_reserved: ${(spent + budgetReservedRub).toFixed(4)} ₽ + ${estimate.toFixed(4)} ₽ > ${budget} ₽`;
      options.metrics?.incAssistantBudgetFallback();
      logEvent('warn', 'assistant_budget_exhausted', {
        request_id: options.requestId,
        spent_rub: Number(spent.toFixed(4)),
        reserved_rub: Number(budgetReservedRub.toFixed(4)),
        budget_rub: budget,
      });
      return null;
    }

    if (budget > 0 && spent >= budget * 0.8) {
      logEvent('warn', 'assistant_budget_warning', {
        request_id: options.requestId,
        spent_rub: Number(spent.toFixed(4)),
        budget_rub: budget,
      });
    }
    budgetReservedRub += estimate;
    try {
      const llmRes = await runLlmAgent(request, config, runtime, now);
      tokenUsage = llmRes.tokenUsage;
      costRub = llmRes.costRub;
      modelUsed = config.llmModel;
      planObj = { ...llmRes.plan, engine_mode: engineMode };
      return llmRes.response;
    } catch (err) {
      fallbackUsed = true;
      llmFallbackReason = 'error';
      errorText = err instanceof Error ? err.message : 'LLM error';
      if (err instanceof LlmError) {
        tokenUsage = err.tokenUsage;
        costRub = err.costRub;
      }
      return null;
    } finally {
      budgetReservedRub = Math.max(0, budgetReservedRub - estimate);
    }
  };

  const fallbackAfterLlm = async (): Promise<AssistantResponsePayload> => {
    const engineName = llmFallbackReason === 'budget' ? 'rules-budget-v2' : 'rules-fallback-v2';
    const fallbackPayload = await rulesFallback(engineName);
    planObj = {
      constraints: fallbackPayload.constraints,
      engine_mode: engineMode,
      route: 'rules_fallback',
      fallback: llmFallbackReason === 'budget' ? 'daily_budget_exhausted' : errorText ?? true,
    };
    return fallbackPayload;
  };

  if (engineMode === 'rules' || !llmConfigured) {
    payload = await runRules();
  } else if (engineMode === 'llm') {
    payload = (await runLlm()) ?? (await fallbackAfterLlm());
  } else {
    // hybrid: быстрый детерминированный путь; LLM — только на неоднозначных
    // запросах, где правила не смогли понять фразу или ничего не нашли.
    const rulesPayload = await runRules();
    const escalationReason = hybridEscalationReason(request, rulesPayload);
    if (!escalationReason) {
      payload = rulesPayload;
    } else {
      const llmPayload = await runLlm();
      if (llmPayload) {
        planObj = { ...(planObj ?? {}), hybrid_reason: escalationReason };
        payload = llmPayload;
      } else {
        payload = await fallbackAfterLlm();
        planObj = { ...(planObj ?? {}), hybrid_reason: escalationReason };
      }
    }
  }

  payload.trace_id = traceId;
  const durationMs = Date.now() - startedMs;

  await db.query(
    `INSERT INTO agent_traces (
       id, request_id, created_at, channel, user_ref, engine, model, prompt_version, action,
       user_query_masked, duration_ms, steps, grounding_ids, token_usage, plan, cost_rub, fallback_used, error
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14::jsonb,$15::jsonb,$16,$17,$18)`,
    [
      traceId,
      options.requestId,
      formatRfc3339Local(now),
      channel,
      maskedUserRef,
      payload.engine,
      modelUsed,
      PROMPT_VERSION,
      payload.action,
      request.message ? maskPii(request.message).slice(0, 200) : null,
      durationMs,
      JSON.stringify(runtime.steps),
      JSON.stringify([...runtime.groundedIds]),
      tokenUsage ? JSON.stringify(tokenUsage) : null,
      planObj ? JSON.stringify(sanitizeTracePlan(planObj)) : null,
      costRub,
      fallbackUsed,
      errorText,
    ],
  );

  options.metrics?.incAssistant(payload.engine, payload.action);
  return payload;
}
