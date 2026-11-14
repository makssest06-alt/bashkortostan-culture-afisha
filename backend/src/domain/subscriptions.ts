import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import type { Database } from '../db/adapter.js';
import { isCategoryId, isCitySlug } from './dictionaries.js';
import { UUID_PATTERN } from './identity.js';
import { formatRfc3339Local } from './time.js';
import type { ApiErrorDetail, CategoryId, CityId, DatePreset } from './types.js';

export const USER_REF_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

export interface SubscriptionRecord {
  id: string;
  channel: 'telegram' | 'web';
  city: CityId | null;
  category: CategoryId | null;
  period: DatePreset | null;
  created_at: string;
}

const SubscriptionCreateSchema = z
  .object({
    channel: z.enum(['telegram', 'web']),
    user_ref: z.string().regex(USER_REF_PATTERN, 'Поле user_ref должно содержать 16–128 символов [A-Za-z0-9_-]'),
    city: z.string().nullable().optional(),
    category: z.string().nullable().optional(),
    period: z.enum(['today', 'tomorrow', 'weekend', 'week']).nullable().optional(),
  })
  .strict();

function zodIssuesToDetails(err: z.ZodError): ApiErrorDetail[] {
  return err.issues.map((issue) => ({
    field: issue.path.join('.') || 'body',
    message: issue.message,
  }));
}

export async function createSubscription(
  db: Database,
  rawBody: unknown,
  now: Date = new Date(),
): Promise<
  | { ok: true; subscription: SubscriptionRecord }
  | { ok: false; status: 400 | 409; code: string; message: string; details?: ApiErrorDetail[] }
> {
  const parsed = SubscriptionCreateSchema.safeParse(rawBody);
  if (!parsed.success) {
    return {
      ok: false,
      status: 400,
      code: 'validation_error',
      message: 'Проверьте параметры подписки',
      details: zodIssuesToDetails(parsed.error),
    };
  }

  const { channel, user_ref } = parsed.data;
  const city = parsed.data.city ?? null;
  const category = parsed.data.category ?? null;
  const period = parsed.data.period ?? null;

  const details: ApiErrorDetail[] = [];
  if (city !== null && !isCitySlug(city)) {
    details.push({ field: 'city', message: `Неизвестный город «${city}»` });
  }
  if (category !== null && !isCategoryId(category)) {
    details.push({ field: 'category', message: `Неизвестная категория «${category}»` });
  }
  if (details.length > 0) {
    return {
      ok: false,
      status: 400,
      code: 'validation_error',
      message: 'Указаны неизвестные значения справочника',
      details,
    };
  }

  const dupCheck = await db.query<{ id: string }>(
    `SELECT id FROM subscriptions
     WHERE channel = $1
       AND user_ref = $2
       AND COALESCE(city, '') = $3
       AND COALESCE(category, '') = $4
       AND COALESCE(period, '') = $5
     LIMIT 1`,
    [channel, user_ref, city ?? '', category ?? '', period ?? ''],
  );

  if (dupCheck.rows.length > 0) {
    return {
      ok: false,
      status: 409,
      code: 'conflict',
      message: 'Такая подписка уже оформлена',
    };
  }

  const id = randomUUID();
  const createdAt = formatRfc3339Local(now);

  try {
    await db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO subscriptions (id, channel, user_ref, city, category, period, created_at, last_used_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
        [id, channel, user_ref, city, category, period, createdAt],
      );

      // Журнал без ПДн и без user_ref
      await tx.query(
        `INSERT INTO audit_log (id, at, actor, action, entity_type, entity_id, entity_title, changes)
         VALUES ($1, $2, 'system', 'create', 'subscription', $3, $4, $5::jsonb)`,
        [
          randomUUID(),
          createdAt,
          id,
          `${channel}:${city ?? 'all'}`,
          JSON.stringify([{ field: 'channel', from: null, to: channel }]),
        ],
      );
    });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === '23505') {
      return {
        ok: false,
        status: 409,
        code: 'conflict',
        message: 'Такая подписка уже оформлена',
      };
    }
    throw err;
  }

  return {
    ok: true,
    subscription: {
      id,
      channel,
      city: city as CityId | null,
      category: category as CategoryId | null,
      period: period ?? null,
      created_at: createdAt,
    },
  };
}

interface SubRow {
  id: string;
  channel: 'telegram' | 'web';
  user_ref: string;
  city: CityId | null;
  category: CategoryId | null;
  period: DatePreset | null;
  created_at: Date | string;
}

export async function listSubscriptions(
  db: Database,
  userRef: string | null | undefined,
  now: Date = new Date(),
): Promise<
  | { ok: true; items: SubscriptionRecord[] }
  | { ok: false; status: 400; code: string; message: string; details: ApiErrorDetail[] }
> {
  if (!userRef || !USER_REF_PATTERN.test(userRef)) {
    return {
      ok: false,
      status: 400,
      code: 'validation_error',
      message: 'Параметр user_ref обязателен (16–128 символов [A-Za-z0-9_-])',
      details: [{ field: 'user_ref', message: 'Некорректный или отсутствующий user_ref' }],
    };
  }

  const res = await db.query<SubRow>(
    'SELECT * FROM subscriptions WHERE user_ref = $1 ORDER BY created_at DESC',
    [userRef],
  );

  // Отметка активности: пользователь открыл список — подписка не считается брошенной.
  if (res.rows.length > 0) {
    await db.query('UPDATE subscriptions SET last_used_at = $2 WHERE user_ref = $1', [
      userRef,
      formatRfc3339Local(now),
    ]);
  }

  return {
    ok: true,
    items: res.rows.map((r) => ({
      id: r.id,
      channel: r.channel,
      // user_ref не возвращается: он и так известен владельцу, лишний раз в ответах ему не нужен.
      city: r.city,
      category: r.category,
      period: r.period,
      created_at:
        r.created_at instanceof Date ? formatRfc3339Local(r.created_at) : String(r.created_at),
    })),
  };
}

export async function deleteSubscription(
  db: Database,
  id: string,
  userRef: string | null | undefined,
): Promise<{ ok: true } | { ok: false; status: 400 | 401 | 404; code: string; message: string }> {
  if (!UUID_PATTERN.test(id)) {
    return {
      ok: false,
      status: 400,
      code: 'validation_error',
      message: 'Идентификатор подписки должен быть корректным UUID',
    };
  }

  // P0-5: без user_ref удаление запрещено — по одному UUID удалить подписку нельзя.
  if (!userRef || !USER_REF_PATTERN.test(userRef)) {
    return {
      ok: false,
      status: 401,
      code: 'unauthorized',
      message: 'Требуется заголовок Authorization: Bearer <user_ref>',
    };
  }

  const at = formatRfc3339Local(new Date());
  const deleted = await db.transaction(async (tx) => {
    const delRes = await tx.query('DELETE FROM subscriptions WHERE id = $1 AND user_ref = $2', [
      id.toLowerCase(),
      userRef,
    ]);
    if (delRes.rowCount === 0) return false;
    await tx.query(
      `INSERT INTO audit_log (id, at, actor, action, entity_type, entity_id, changes)
       VALUES ($1, $2, 'system', 'delete', 'subscription', $3, '[]'::jsonb)`,
      [randomUUID(), at, id.toLowerCase()],
    );
    return true;
  });

  if (!deleted) {
    return {
      ok: false,
      status: 404,
      code: 'not_found',
      message: 'Подписка не найдена',
    };
  }

  return { ok: true };
}
