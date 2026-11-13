import { describe, expect, it } from 'vitest';

import { isUserRef, telegramUserRef, UserRefError } from '../src/user-ref.js';

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
});
