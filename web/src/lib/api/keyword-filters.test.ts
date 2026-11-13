import { describe, expect, it } from 'vitest';

import { keywordFilters, mergeQueries } from './keyword-filters';

describe('обычный поиск без модели (резервный режим п. 7.5)', () => {
  it('явные условия из фразы', () => {
    expect(keywordFilters('Концерт в Стерлитамаке в субботу до 1500 рублей')).toEqual({
      city: ['sterlitamak'],
      category: ['concert'],
      date: 'weekend',
      price_max: 1500,
    });
  });

  it('с ребёнком, бесплатно, сегодня', () => {
    expect(keywordFilters('что-нибудь бесплатное для детей сегодня в Уфе')).toEqual({
      city: ['ufa'],
      date: 'today',
      free_only: true,
      audience: 'kids',
    });
  });

  it('музей раскрывается в выставки и экскурсии, неизвестное не угадывается', () => {
    expect(keywordFilters('сходить в музей')).toEqual({ category: ['exhibition', 'excursion'] });
    expect(keywordFilters('что-нибудь интересное')).toEqual({});
  });

  it('новая фраза уточняет условия диалога, прежние остаются', () => {
    expect(mergeQueries({ city: ['ufa'], date: 'weekend', page: 2 }, { category: ['cinema'] })).toEqual({
      city: ['ufa'],
      date: 'weekend',
      category: ['cinema'],
    });
  });
});
