import { describe, expect, it } from 'vitest';

import {
  addIsoDays,
  findCategoryId,
  findCityId,
  isIsoDate,
  todayIsoDate,
} from '../src/dictionaries.js';

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
});

describe('поиск по справочникам', () => {
  it('находит город по названию и падежу', () => {
    expect(findCityId('Уфа')).toBe('ufa');
    expect(findCityId('в Уфе')).toBe('ufa');
    expect(findCityId('  СТЕРЛИТАМАК ')).toBe('sterlitamak');
    expect(findCityId('Марс')).toBeNull();
  });

  it('находит категорию по названию и основе', () => {
    expect(findCategoryId('концерты')).toBe('concert');
    expect(findCategoryId('концерт')).toBe('concert');
    expect(findCategoryId('спектакли')).toBe('performance');
    expect(findCategoryId('нет такой')).toBeNull();
  });
});
