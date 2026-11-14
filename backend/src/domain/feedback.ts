import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';

import type { Database } from '../db/adapter.js';
import type { MetricsRegistry } from '../observability/metrics.js';
import { UUID_PATTERN } from './identity.js';
import type { SlidingRateLimiter } from './rate-limit.js';
import { USER_REF_PATTERN } from './subscriptions.js';
import { formatRfc3339Local } from './time.js';
import type { ApiErrorDetail } from './types.js';

export type FeedbackKind = 'organizer_application' | 'correction' | 'question';

export const FEEDBACK_RATE_RULES = [
  { suffix: '10m', max: 5, windowMs: 10 * 60_000 },
  { suffix: '24h', max: 20, windowMs: 24 * 3_600_000 },
] as const;

/** Сетевой backstop: не блокирует всех пользователей одного прокси/бота. */
export const FEEDBACK_IP_BACKSTOP_RULES = [
  { suffix: '10m', max: 100, windowMs: 10 * 60_000 },
  { suffix: '24h', max: 1_000, windowMs: 24 * 3_600_000 },
] as const;

function feedbackKeyHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

export const KIND_LABEL: Record<FeedbackKind, string> = {
  organizer_application: 'Заявка организатора',
  correction: 'Уточнение информации',
  question: 'Вопрос организатору',
};

const FeedbackCreateSchema = z
  .object({
    kind: z.enum(['organizer_application', 'correction', 'question']),
    event_id: z.string().nullable().optional(),
    /** Необязательный псевдоним для per-user лимита; в ответах и логах не используется. */
    user_ref: z.string().regex(USER_REF_PATTERN, 'user_ref должен содержать 16–128 символов [A-Za-z0-9_-]').optional(),
    name: z.string().trim().min(1, 'Укажите имя').max(100, 'Имя не длиннее 100 символов'),
    contact: z
      .string()
      .trim()
      .min(3, 'Укажите контакт для ответа')
      .max(200, 'Контакт не длиннее 200 символов'),
    organization: z
      .string()
      .trim()
      .max(200, 'Название организации не длиннее 200 символов')
      .nullable()
      .optional(),
    text: z
      .string()
      .trim()
      .min(1, 'Напишите текст обращения')
      .max(2000, 'Текст обращения не длиннее 2000 символов'),
    website: z.string().max(500).optional().default(''),
  })
  .strict();

export async function cleanupExpiredFeedback(
  db: Database,
  now: Date = new Date(),
): Promise<number> {
  const res = await db.query('DELETE FROM feedback WHERE expires_at <= $1', [
    formatRfc3339Local(now),
  ]);
  return res.rowCount;
}

export async function submitFeedback(
  db: Database,
  rawBody: unknown,
  options: {
    clientIp: string;
    rateLimiter?: SlidingRateLimiter;
    retentionDays?: number;
    metrics?: MetricsRegistry;
    now?: Date;
  },
): Promise<
  | { ok: true; id: string; status: 'received'; honeypot: boolean }
  | {
      ok: false;
      status: 400 | 429;
      code: string;
      message: string;
      details?: ApiErrorDetail[];
      retryAfterSeconds?: number;
    }
> {
  const now = options.now ?? new Date();
  const nowMs = now.getTime();
  const rawUserRef =
    typeof (rawBody as { user_ref?: unknown })?.user_ref === 'string'
      ? (rawBody as { user_ref: string }).user_ref
      : '';
  const userRef = rawUserRef && USER_REF_PATTERN.test(rawUserRef) ? rawUserRef : null;

  if (options.rateLimiter) {
    const ipCheck = options.rateLimiter.consumeMulti(
      `feedback:ip:${options.clientIp}`,
      userRef ? FEEDBACK_IP_BACKSTOP_RULES : FEEDBACK_RATE_RULES,
      nowMs,
    );
    if (!ipCheck.ok) {
      options.metrics?.incFeedback('rate_limited');
      return {
        ok: false,
        status: 429,
        code: 'rate_limited',
        message: 'Слишком много обращений с вашего адреса. Попробуйте позже.',
        retryAfterSeconds: ipCheck.retryAfter,
      };
    }
    if (userRef) {
      const userCheck = options.rateLimiter.consumeMulti(
        `feedback:user:${feedbackKeyHash(userRef)}`,
        FEEDBACK_RATE_RULES,
        nowMs,
      );
      if (!userCheck.ok) {
        options.metrics?.incFeedback('rate_limited');
        return {
          ok: false,
          status: 429,
          code: 'rate_limited',
          message: 'Слишком много обращений. Попробуйте позже.',
          retryAfterSeconds: userCheck.retryAfter,
        };
      }
    }
  }

  const parsed = FeedbackCreateSchema.safeParse(rawBody);
  if (!parsed.success) {
    options.metrics?.incFeedback('invalid');
    return {
      ok: false,
      status: 400,
      code: 'validation_error',
      message: 'Проверьте заполнение формы обратной связи',
      details: parsed.error.issues.map((issue) => ({
        field: issue.path.join('.') || 'body',
        message: issue.message,
      })),
    };
  }

  const data = parsed.data;
  const id = randomUUID();

  // Honeypot: молча отвечаем 202, но ничего не сохраняем в БД и аудит
  if (data.website.trim().length > 0) {
    options.metrics?.incFeedback('honeypot');
    return { ok: true, id, status: 'received', honeypot: true };
  }

  let resolvedEventId: string | null = null;
  let resolvedEventTitle: string | null = null;
  if (data.event_id) {
    const evId = data.event_id.trim();
    if (!UUID_PATTERN.test(evId) && !/^evt_[a-z0-9_]+$/i.test(evId)) {
      return {
        ok: false,
        status: 400,
        code: 'validation_error',
        message: 'Некорректный идентификатор события event_id',
        details: [{ field: 'event_id', message: 'Ожидается UUID события' }],
      };
    }
    const evRes = UUID_PATTERN.test(evId)
      ? await db.query<{ id: string; title: string }>('SELECT id, title FROM events WHERE id = $1', [
          evId.toLowerCase(),
        ])
      : await db.query<{ id: string; title: string }>(
          'SELECT id, title FROM events WHERE legacy_code = $1',
          [evId],
        );
    if (evRes.rows.length > 0) {
      resolvedEventId = evRes.rows[0].id;
      resolvedEventTitle = evRes.rows[0].title;
    } else {
      resolvedEventId = UUID_PATTERN.test(evId) ? evId.toLowerCase() : null;
    }
  }

  const createdAt = formatRfc3339Local(nowMs);
  const retentionDays = options.retentionDays ?? 90;
  const expiresAt = formatRfc3339Local(nowMs + retentionDays * 86_400_000);

  await cleanupExpiredFeedback(db, now);

  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO feedback (id, created_at, expires_at, kind, event_id, event_title, name, contact, organization, text, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'new')`,
      [
        id,
        createdAt,
        expiresAt,
        data.kind,
        resolvedEventId,
        resolvedEventTitle,
        data.name,
        data.contact,
        data.organization ?? null,
        data.text,
      ],
    );

    // В аудит и логи не попадают name и contact (ПДн)
    await tx.query(
      `INSERT INTO audit_log (id, at, actor, action, entity_type, entity_id, entity_title, changes)
       VALUES ($1, $2, 'system', 'create', 'application', $3, $4, $5::jsonb)`,
      [
        randomUUID(),
        createdAt,
        id,
        KIND_LABEL[data.kind],
        JSON.stringify([
          { field: 'kind', from: null, to: data.kind },
          ...(resolvedEventId ? [{ field: 'event_id', from: null, to: resolvedEventId }] : []),
        ]),
      ],
    );
  });

  options.metrics?.incFeedback('accepted');
  return { ok: true, id, status: 'received', honeypot: false };
}
