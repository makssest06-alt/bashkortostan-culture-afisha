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
  const bytes = new Uint8Array(16);
  if (cryptoObj?.getRandomValues) {
    // getRandomValues работает и в не-secure context, в отличие от randomUUID.
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `web_${hex}`;
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
