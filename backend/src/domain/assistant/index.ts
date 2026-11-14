import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import type { AppConfig } from '../../config.js';
import type { Database } from '../../db/adapter.js';
import type { MetricsRegistry } from '../../observability/metrics.js';
import type { SlidingRateLimiter } from '../rate-limit.js';
import { formatRfc3339Local } from '../time.js';
import type { ApiErrorDetail } from '../types.js';
import { PROMPT_VERSION, runLlmAgent } from './llm.js';
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

const AssistantRequestSchema = z.object({
  message: z.string().max(MAX_MESSAGE_LENGTH, `Сообщение не длиннее ${MAX_MESSAGE_LENGTH} знаков`).optional(),
  previous: z.record(z.unknown()).nullable().optional(),
  patch: z
    .object({
      reset: z.boolean().optional(),
      set: z.record(z.unknown()).optional(),
      unset: z.array(z.string()).optional(),
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
  confirmation_token: z.string().optional(),
  user_ref: z.string().max(128).optional(),
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
      confirmation_token: parsed.data.confirmation_token,
      user_ref: parsed.data.user_ref,
      channel: parsed.data.channel,
    },
  };
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
  const maskedUserRef = request.user_ref ? maskPii(request.user_ref).slice(0, 64) : null;

  const runtime = new ToolRuntime(db, {
    requestId: options.requestId,
    userRef: request.user_ref,
    channel,
    clientIp: options.clientIp,
    confirmationToken: request.confirmation_token,
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

  if (config.llmApiKey) {
    try {
      const llmRes = await runLlmAgent(request, config, runtime, now);
      payload = llmRes.response;
      tokenUsage = llmRes.tokenUsage;
      costRub = llmRes.costRub;
      modelUsed = config.llmModel;
      planObj = llmRes.plan;
    } catch (err) {
      fallbackUsed = true;
      errorText = err instanceof Error ? err.message : 'LLM error';
      payload = await runDeterministicAssistant(request, runtime, now, 'rules-fallback-v2');
      planObj = { constraints: payload.constraints, fallback: true };
    }
  } else {
    payload = await runDeterministicAssistant(request, runtime, now, 'rules-v2');
    planObj = { constraints: payload.constraints };
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
      request.message ? maskPii(request.message) : null,
      durationMs,
      JSON.stringify(runtime.steps),
      JSON.stringify([...runtime.groundedIds]),
      tokenUsage ? JSON.stringify(tokenUsage) : null,
      planObj ? JSON.stringify(planObj) : null,
      costRub,
      fallbackUsed,
      errorText,
    ],
  );

  options.metrics?.incAssistant(payload.engine, payload.action);
  return payload;
}
