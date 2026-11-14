import { describe, expect, it } from 'vitest';

import {
  addIsoDays,
  ageLabel,
  isAgeOption,
  isIsoDate,
  isLanguageCode,
  isSearchSort,
  parseIsoRange,
  rangeDays,
  todayIsoDate,
} from '../src/search-options.js';

describe('даты в часовом поясе афиши', () => {
  it('берёт сегодняшнюю дату в UTC+5, а не по TZ сервера', () => {
    expect(todayIsoDate(new Date('2026-11-13T20:00:00Z'))).toBe('2026-11-14');
    expect(todayIsoDate(new Date('2026-11-13T18:59:59Z'))).toBe('2026-11-13');
  });

  it('сдвигает дату через границы месяца, года и високосного дня', () => {
    expect(addIsoDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addIsoDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addIsoDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addIsoDays('2026-11-14', 9)).toBe('2026-11-23');
  });

  it('проверяет календарную дату, а не только форму', () => {
    expect(isIsoDate('2026-11-20')).toBe(true);
    expect(isIsoDate('2024-02-29')).toBe(true);
    expect(isIsoDate('2026-02-29')).toBe(false);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('2026-11-31')).toBe(false);
    expect(isIsoDate('20.11.2026')).toBe(false);
  });

  it('разбирает период и ограничивает его 31 днём', () => {
    expect(parseIsoRange('2026-11-20..2026-11-25')).toEqual({
      from: '2026-11-20',
      to: '2026-11-25',
    });
    expect(parseIsoRange('2026-11-20 — 2026-11-25')).toEqual({
      from: '2026-11-20',
      to: '2026-11-25',
    });
    expect(parseIsoRange('2026-11-25..2026-11-20')).toBeNull();
    expect(parseIsoRange('2026-11-01..2026-12-31')).toBeNull();
    expect(parseIsoRange('2026-02-30..2026-03-01')).toBeNull();
    expect(rangeDays('2026-11-20', '2026-11-25')).toBe(6);
  });

  it('подписывает возраст посетителя по-русски', () => {
    expect(ageLabel(null)).toBe('Любой возраст');
    expect(ageLabel(0)).toBe('0 лет');
    expect(ageLabel(3)).toBe('3 года');
    expect(ageLabel(6)).toBe('6 лет');
    expect(ageLabel(21)).toBe('21 год');
    expect(isAgeOption(6)).toBe(true);
    expect(isAgeOption(7)).toBe(false);
    expect(isSearchSort('popularity')).toBe(true);
    expect(isLanguageCode('ba')).toBe(true);
    expect(isLanguageCode('en')).toBe(false);
  });
});
