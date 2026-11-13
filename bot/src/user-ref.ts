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
 * API требует 16–128 символов [A-Za-z0-9_-], поэтому числовой id дополняем
 * нулями слева до 8 знаков. Нули не меняют id и не ломают сортировку.
 */
export function telegramUserRef(telegramUserId: number | string): string {
  const raw = String(telegramUserId).trim();
  if (!/^\d+$/.test(raw)) {
    throw new UserRefError('Telegram user id должен состоять только из цифр');
  }
  const padded = raw.padStart(MIN_DIGITS, '0');
  const ref = `${TELEGRAM_PREFIX}${padded}`;
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
  return hashUserRef(telegramUserRef(telegramUserId), secret);
}
