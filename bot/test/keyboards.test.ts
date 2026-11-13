import { describe, expect, it } from 'vitest';

import { datePickerKeyboard, filtersKeyboard } from '../src/keyboards.js';
import { createSearchState } from '../src/session.js';

const issue = () => 'v1_AAAAAAAAAAAA';

function labels(keyboard: ReturnType<typeof filtersKeyboard>): string[] {
  return keyboard.inline_keyboard.flat().map((button) => button.text);
}

describe('клавиатуры фильтров', () => {
  it('строит дата-пикер по часовому поясу афиши, а не сервера', () => {
    const keyboard = datePickerKeyboard(
      null,
      issue,
      new Date('2026-11-13T20:00:00Z'),
    );
    const buttons = labels(keyboard);

    // 20:00 UTC — это уже 14 ноября в Уфе (UTC+5).
    expect(buttons[1]).toBe('14 ноя, сб');
    expect(buttons.some((label) => label.includes('23 ноя'))).toBe(true);
  });

  it('не сбрасывает цену при открытии экрана фильтров', () => {
    const buttons = labels(
      filtersKeyboard(createSearchState({ priceMax: 1000 }), issue),
    );

    expect(buttons).toContain('✅ до 1\u00A0000\u00A0₽');
    expect(buttons.some((label) => label.startsWith('💰 Цена:'))).toBe(false);
  });
});
