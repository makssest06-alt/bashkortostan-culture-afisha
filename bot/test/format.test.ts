import { describe, expect, it } from 'vitest';

import {
  eventSourceUrl,
  formatAge,
  formatDate,
  formatDateRange,
  formatEventCard,
  formatEventWhen,
  formatFilterLine,
  formatNoResults,
  formatOccurrence,
  formatPrice,
  formatSearchResults,
  formatSubscription,
  formatSubscriptionCreated,
  formatSubscriptionsList,
  formatDuration,
  formatRubles,
  pickPrimaryOccurrence,
  telegramSafeHttpUrl,
  truncate,
} from '../src/format.js';
import { makeEvent, makeListItem, makeListResponse, makeOccurrence } from './fixtures.js';

const NOW = new Date('2026-11-13T12:00:00Z');

describe('даты', () => {
  it('форматирует дату по-русски', () => {
    expect(formatDate('2026-11-20', NOW)).toBe('20 ноября');
    expect(formatDate('2027-01-05', NOW)).toBe('5 января 2027');
  });

  it('добавляет день недели', () => {
    expect(formatDateRange('2026-11-20', null, NOW)).toBe('20 ноября, пт');
  });

  it('форматирует диапазон в одном месяце', () => {
    expect(formatDateRange('2026-11-20', '2026-11-22', NOW)).toBe('20–22 ноября, пт–вс');
  });

  it('форматирует диапазон в разных месяцах', () => {
    expect(formatDateRange('2026-11-30', '2026-12-02', NOW)).toBe('30 ноября, пн – 2 декабря, ср');
  });

  it('показывает время для точности minute и «в течение дня» для date', () => {
    expect(formatOccurrence(makeOccurrence(), NOW)).toBe('20 ноября, пт, 19:00');
    expect(
      formatOccurrence(
        makeOccurrence({ time_precision: 'date', date_start: '2026-11-20T00:00:00+05:00' }),
        NOW,
      ),
    ).toBe('20 ноября, пт · в течение дня');
  });

  it('берёт ближайший будущий сеанс', () => {
    const event = makeEvent({
      occurrences: [
        makeOccurrence({ id: 'a', date_start: '2026-11-25T19:00:00+05:00' }),
        makeOccurrence({ id: 'b', date_start: '2026-11-19T19:00:00+05:00' }),
        makeOccurrence({ id: 'c', date_start: '2026-11-01T19:00:00+05:00', is_past: true }),
      ],
    });
    expect(pickPrimaryOccurrence(event)?.id).toBe('b');
    expect(formatEventWhen(event, NOW)).toBe('19 ноября, чт, 19:00');
  });
});

describe('цена и возраст', () => {
  it('форматирует варианты цены', () => {
    expect(formatPrice(null, null, true)).toBe('Бесплатно');
    expect(formatPrice(null, null, false)).toBe('Цена не указана');
    expect(formatPrice(500, 500, false)).toBe('500\u00A0₽');
    expect(formatPrice(500, 1200, false)).toBe('500\u00A0₽–1\u00A0200\u00A0₽');
    expect(formatPrice(500, null, false)).toBe('от 500\u00A0₽');
    expect(formatPrice(null, 1000, false)).toBe('до 1\u00A0000\u00A0₽');
  });

  it('группирует тысячи', () => {
    expect(formatRubles(1234567)).toBe('1\u00A0234\u00A0567\u00A0₽');
  });

  it('форматирует возраст и длительность', () => {
    expect(formatAge(null)).toBe('Возраст не указан');
    expect(formatAge(12)).toBe('12+');
    expect(formatDuration(90)).toBe('1 ч 30 мин');
    expect(formatDuration(45)).toBe('45 мин');
    expect(formatDuration(null)).toBeNull();
  });
});

describe('карточка события', () => {
  it('содержит ключевые поля', () => {
    const text = formatEventCard(makeEvent(), NOW);
    expect(text).toContain('Вечер башкирской музыки');
    expect(text).toContain('20 ноября, пт, 19:00');
    expect(text).toContain('Башкирская государственная филармония');
    expect(text).toContain('500\u00A0₽–1\u00A0200\u00A0₽');
    expect(text).toContain('12+');
    expect(text).toContain('Концерт симфонической музыки');
    expect(text).not.toContain('<b>');
  });

  it('предупреждает об отмене и синтетических данных', () => {
    const text = formatEventCard(
      makeEvent({
        status: 'cancelled',
        synthetic: true,
        occurrences: [makeOccurrence({ status: 'cancelled' })],
      }),
      NOW,
    );
    expect(text).toContain('Событие отменено');
    expect(text).toContain('Этот сеанс отменён');
    expect(text).toContain('Демонстрационное событие');
  });

  it('не обещает цену, которой нет', () => {
    const text = formatEventCard(makeEvent({ price_min: null, price_max: null, is_free: false }), NOW);
    expect(text).toContain('Цена не указана');
    expect(text).not.toContain('Бесплатно');
  });

  it('ссылка на источник только http(s)', () => {
    expect(eventSourceUrl(makeEvent())).toBe('https://example.com/tickets/1');
    expect(eventSourceUrl(makeEvent({ org_link: 'javascript:alert(1)', source_url: '' }))).toBeNull();
    expect(eventSourceUrl(makeEvent({ org_link: null, source_url: 'not a url' }))).toBeNull();
    expect(
      eventSourceUrl(makeEvent({ org_link: null, source_url: 'http://localhost:3210/events/1' })),
    ).toBeNull();
  });

  it('не пускает в кнопки localhost и приватные адреса', () => {
    expect(telegramSafeHttpUrl('https://afisha.example/events/1')).toBe(
      'https://afisha.example/events/1',
    );
    expect(telegramSafeHttpUrl('https://afisha.example/')).toBe('https://afisha.example');
    expect(telegramSafeHttpUrl('http://localhost:3210')).toBeNull();
    expect(telegramSafeHttpUrl('http://127.0.0.1:3210')).toBeNull();
    expect(telegramSafeHttpUrl('http://127.0.0.2/x')).toBeNull();
    expect(telegramSafeHttpUrl('http://169.254.169.254/latest/meta-data')).toBeNull();
    expect(telegramSafeHttpUrl('http://100.64.0.1/x')).toBeNull();
    expect(telegramSafeHttpUrl('http://198.18.0.1/x')).toBeNull();
    expect(telegramSafeHttpUrl('http://10.0.0.5/x')).toBeNull();
    expect(telegramSafeHttpUrl('http://172.20.0.1/x')).toBeNull();
    expect(telegramSafeHttpUrl('http://192.168.0.1/x')).toBeNull();
    expect(telegramSafeHttpUrl('http://[::1]/x')).toBeNull();
    expect(telegramSafeHttpUrl('http://[fc00::1]/x')).toBeNull();
    expect(telegramSafeHttpUrl('http://[fe80::1]/x')).toBeNull();
    expect(telegramSafeHttpUrl('http://[::ffff:127.0.0.1]/x')).toBeNull();
    expect(telegramSafeHttpUrl('http://8.8.8.8/x')).toBe('http://8.8.8.8/x');
    expect(telegramSafeHttpUrl('http://[2001:4860:4860::8888]/x')).toBe(
      'http://[2001:4860:4860::8888]/x',
    );
    expect(telegramSafeHttpUrl('ftp://example.com/file')).toBeNull();
    expect(telegramSafeHttpUrl(null)).toBeNull();
  });
});

describe('выдача поиска', () => {
  it('нумерует события с учётом страницы', () => {
    const response = makeListResponse(
      [makeListItem({ id: 'a', title: 'Первое' }), makeListItem({ id: 'b', title: 'Второе' })],
      { page: 2, page_size: 5, total: 7, total_pages: 2 },
    );
    const text = formatSearchResults(response, {
      q: 'музыка',
      city: 'ufa',
      category: 'concert',
      date: 'weekend',
    });
    expect(text).toContain('Поиск «музыка» — найдено 7');
    expect(text).toContain('6. Первое');
    expect(text).toContain('7. Второе');
    expect(text).toContain('Город: Уфа · Категория: Концерты · Когда: На выходных');
    expect(text).toContain('Страница 2 из 2');
  });

  it('сообщает, что ничего не найдено', () => {
    const text = formatNoResults({ q: 'балет', city: 'sibay', category: null, date: null });
    expect(text).toContain('Ничего не нашлось');
    expect(text).toContain('«балет»');
    expect(text).toContain('Город: Сибай');
  });

  it('показывает все фильтры по умолчанию', () => {
    expect(formatFilterLine({ q: null, city: null, category: null, date: null })).toBe(
      'Все города и категории',
    );
  });
});

describe('подписки', () => {
  const subscription = {
    id: '44444444-4444-4444-8444-444444444444',
    channel: 'telegram' as const,
    city: 'ufa',
    category: 'concert',
    period: 'week' as const,
    created_at: '2026-11-13T10:00:00+05:00',
  };

  it('описывает подписку', () => {
    expect(formatSubscription(subscription)).toBe('Концерты · Уфа · На этой неделе');
  });

  it('перечисляет подписки и пустое состояние', () => {
    expect(formatSubscriptionsList([])).toContain('Подписок пока нет');
    const text = formatSubscriptionsList([subscription, { ...subscription, id: 'x', city: null, category: null, period: null }]);
    expect(text).toContain('Ваши подписки (2)');
    expect(text).toContain('Концерты · Уфа');
    expect(text).toContain('Все категории · Любой город');
  });

  it('подтверждает создание без обещания рассылки', () => {
    const text = formatSubscriptionCreated(subscription);
    expect(text).toContain('Подписка сохранена');
    expect(text).toContain('Мои подписки');
    expect(text).not.toContain('пришлём');
  });
});

describe('truncate', () => {
  it('схлопывает пробелы и обрезает по слову', () => {
    expect(truncate('  одно   два  ', 50)).toBe('одно два');
    expect(truncate('слово слово слово', 12)).toMatch(/…$/);
    expect(truncate('слово слово слово', 12).length).toBeLessThanOrEqual(12);
  });
});
