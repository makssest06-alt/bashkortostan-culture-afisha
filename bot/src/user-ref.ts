import { createHash, createHmac } from 'node:crypto';

const USER_REF_RE = /^[A-Za-z0-9_-]{16,128}$/;
const TELEGRAM_PREFIX = 'telegram_';
const MIN_DIGITS = 8;

export class UserRefError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserRefError';
  }
}

/**
 * Стабильный псевдоним пользователя для REST API.
 *
 * `hmac` (по умолчанию в боте) не даёт перебирать подписки по числовому
 * Telegram id. `legacy` оставлен для отката и старых подписок:
 * `telegram_00000123`.
 */
export function telegramUserRef(
  telegramUserId: number | string,
  options: { mode?: 'hmac' | 'legacy'; secret?: string | null } = {},
): string {
  const raw = String(telegramUserId).trim();
  if (!/^\d+$/.test(raw)) {
    throw new UserRefError('Telegram user id должен состоять только из цифр');
  }

  const mode = options.mode ?? 'hmac';
  let ref: string;
  if (mode === 'hmac') {
    if (!options.secret) {
      throw new UserRefError('Для HMAC user_ref нужен секрет');
    }
    const digest = createHmac('sha256', options.secret)
      .update(`telegram-user:${raw}`)
      .digest('base64url')
      .slice(0, 32);
    ref = `${TELEGRAM_PREFIX}${digest}`;
  } else {
    const padded = raw.padStart(MIN_DIGITS, '0');
    ref = `${TELEGRAM_PREFIX}${padded}`;
  }

  if (!USER_REF_RE.test(ref)) {
    throw new UserRefError('Не удалось построить корректный user_ref для API');
  }
  return ref;
}

export function isUserRef(value: string): boolean {
  return USER_REF_RE.test(value);
}

/**
 * Псевдоним пользователя для логов. Сам user_ref и telegram id в лог
 * не попадают. С секретом используется HMAC: без него хеш от числового id
 * слишком легко перебрать. Без секрета остаётся SHA-256 — для тестов и
 * обратной совместимости.
 */
export function hashUserRef(userRef: string, secret?: string | null): string {
  const digest = secret
    ? createHmac('sha256', secret).update(userRef).digest('hex')
    : createHash('sha256').update(userRef).digest('hex');
  return `u_${digest.slice(0, 16)}`;
}

export function hashTelegramUserId(
  telegramUserId: number | string,
  secret?: string | null,
): string {
  // Для лога достаточно старого детерминированного представления: секрет всё равно скрывает id.
  return hashUserRef(telegramUserRef(telegramUserId, { mode: 'legacy' }), secret);
}
