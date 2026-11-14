/**
 * Стабильный непрозрачный идентификатор браузера для подписок и подтверждений ассистента.
 * ПДн не содержит, в URL не попадает; хранится в localStorage, при недоступном
 * localStorage (приватный режим) живёт только на время страницы.
 */

export const USER_REF_STORAGE_KEY = 'afisha_user_ref';

const USER_REF_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

let ephemeral: string | null = null;

function generateUserRef(): string {
  const cryptoObj = typeof globalThis.crypto !== 'undefined' ? globalThis.crypto : undefined;
  if (cryptoObj?.randomUUID) {
    return `web_${cryptoObj.randomUUID().replace(/-/g, '')}`;
  }
  const random = Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `web_${random.padEnd(24, '0').slice(0, 24)}`;
}

export function browserUserRef(): string {
  if (typeof window === 'undefined') return (ephemeral ??= generateUserRef());
  try {
    const stored = window.localStorage.getItem(USER_REF_STORAGE_KEY);
    if (stored && USER_REF_PATTERN.test(stored)) return stored;
    const created = generateUserRef();
    window.localStorage.setItem(USER_REF_STORAGE_KEY, created);
    return created;
  } catch {
    return (ephemeral ??= generateUserRef());
  }
}
