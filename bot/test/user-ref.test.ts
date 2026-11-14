import { describe, expect, it } from 'vitest';

import { isUserRef, telegramUserRef, UserRefError, hashTelegramUserId } from '../src/user-ref.js';

describe('telegramUserRef', () => {
  it('строит user_ref из telegram id с дополнением до 8 цифр', () => {
    expect(telegramUserRef(123)).toBe('telegram_00000123');
    expect(isUserRef(telegramUserRef(123))).toBe(true);
  });

  it('не обрезает длинные id', () => {
    expect(telegramUserRef('123456789012')).toBe('telegram_123456789012');
  });

  it('принимает строковый id', () => {
    expect(telegramUserRef(' 42 ')).toBe('telegram_00000042');
  });

  it('отклоняет нечисловой id', () => {
    expect(() => telegramUserRef('abc')).toThrow(UserRefError);
    expect(() => telegramUserRef('12a')).toThrow(UserRefError);
  });

  it('не выходит за лимит длины API', () => {
    const ref = telegramUserRef('9'.repeat(110));
    expect(ref.length).toBeLessThanOrEqual(128);
    expect(isUserRef(ref)).toBe(true);
  });

  it('в HMAC-режиме не содержит id и стабилен при одном секрете', () => {
    const first = telegramUserRef(123, { mode: 'hmac', secret: 'secret-one' });
    const second = telegramUserRef(123, { mode: 'hmac', secret: 'secret-one' });
    const otherSecret = telegramUserRef(123, { mode: 'hmac', secret: 'secret-two' });
    const otherUser = telegramUserRef(124, { mode: 'hmac', secret: 'secret-one' });

    expect(first).toBe(second);
    expect(first).not.toBe(otherSecret);
    expect(first).not.toBe(otherUser);
    expect(first).not.toContain('00000123');
    expect(first).toMatch(/^telegram_[A-Za-z0-9_-]{16,}$/);
    expect(isUserRef(first)).toBe(true);
  });

  it('HMAC-режим требует секрет, legacy остаётся для отката', () => {
    expect(() => telegramUserRef(123, { mode: 'hmac' })).toThrow(UserRefError);
    expect(telegramUserRef(123, { mode: 'legacy' })).toBe('telegram_00000123');
  });
});

describe('hashTelegramUserId', () => {
  it('не содержит сырой id и зависит от секрета', () => {
    const first = hashTelegramUserId(123, 'secret-one');
    const second = hashTelegramUserId(123, 'secret-two');

    expect(first).toMatch(/^u_[0-9a-f]{16}$/);
    expect(first).not.toContain('123');
    expect(first).not.toBe(second);
  });

  it('стабилен при одном секрете', () => {
    expect(hashTelegramUserId('42', 'secret')).toBe(hashTelegramUserId('42', 'secret'));
  });
});
