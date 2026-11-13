import { describe, expect, it } from 'vitest';

import { CB, parseCallback } from '../src/callbacks.js';

const ID = '11111111-1111-4111-8111-111111111111';

describe('parseCallback', () => {
  it('разбирает меню', () => {
    expect(parseCallback('menu:search')).toEqual({ type: 'menu', target: 'search' });
    expect(parseCallback('menu:home')).toEqual({ type: 'menu', target: 'home' });
  });

  it('разбирает поиск по категории и городу', () => {
    expect(parseCallback(CB.searchCategory('concert'))).toEqual({
      type: 'search',
      action: 'category',
      id: 'concert',
    });
    expect(parseCallback(CB.searchCity('ufa'))).toEqual({
      type: 'search',
      action: 'city',
      id: 'ufa',
    });
  });

  it('разбирает страницы и сброс', () => {
    expect(parseCallback(CB.searchPage(2))).toEqual({ type: 'search', action: 'page', page: 2 });
    expect(parseCallback(CB.searchReset())).toEqual({ type: 'search', action: 'reset' });
  });

  it('разбирает карточку с номером страницы', () => {
    expect(parseCallback(CB.event(ID, 3))).toEqual({ type: 'event', id: ID, page: 3 });
    expect(parseCallback(CB.event(ID))).toEqual({ type: 'event', id: ID, page: null });
  });

  it('разбирает подписки', () => {
    expect(parseCallback(CB.subscribeQuick('ufa', 'concert'))).toEqual({
      type: 'subscribe',
      action: 'quick',
      city: 'ufa',
      category: 'concert',
    });
    expect(parseCallback('sub:city:any')).toEqual({ type: 'subscribe', action: 'city', id: null });
    expect(parseCallback('sub:cat:any')).toEqual({ type: 'subscribe', action: 'category', id: null });
    expect(parseCallback('sub:period:any')).toEqual({ type: 'subscribe', action: 'period', id: null });
    expect(parseCallback(CB.subscribePick('period'))).toEqual({
      type: 'subscribe',
      action: 'pick',
      field: 'period',
    });
  });

  it('разбирает удаление подписки', () => {
    expect(parseCallback(CB.deleteSubscription(ID))).toEqual({
      type: 'subscriptions',
      action: 'delete',
      id: ID,
    });
  });

  it('отклоняет мусор и поддельные значения', () => {
    expect(parseCallback('')).toBeNull();
    expect(parseCallback('menu:unknown')).toBeNull();
    expect(parseCallback('ev:not-a-uuid')).toBeNull();
    expect(parseCallback('search:cat:not-a-category')).toBeNull();
    expect(parseCallback('sub:city:atlantis')).toBeNull();
    expect(parseCallback('search:page:0')).toBeNull();
    expect(parseCallback('search:page:1001')).toBeNull();
    expect(parseCallback(`sub:city:${'a'.repeat(80)}`)).toBeNull();
  });

  it('все генерируемые callback_data не длиннее 64 байт', () => {
    const values = [
      CB.menu('home'),
      CB.menu('categories'),
      CB.searchCategory('exhibition'),
      CB.searchCity('sterlitamak'),
      CB.searchReset(),
      CB.searchPage(999),
      CB.event(ID, 999),
      CB.subscribeEvent(ID),
      CB.subscribeQuick('sterlitamak', 'performance'),
      CB.subscribeAdd(),
      CB.subscribePick('category'),
      CB.subscribeSummary(),
      CB.subscribeCity(null),
      CB.subscribeCity('sterlitamak'),
      CB.subscribeCategory(null),
      CB.subscribeCategory('performance'),
      CB.subscribePeriod(null),
      CB.subscribePeriod('weekend'),
      CB.subscribeSave(),
      CB.subscribeCancel(),
      CB.deleteSubscription(ID),
      CB.noop(),
    ];
    for (const value of values) {
      expect(Buffer.byteLength(value, 'utf8')).toBeLessThanOrEqual(64);
    }
  });
});
