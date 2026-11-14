import { describe, expect, it } from 'vitest';

import { DirectoryService } from '../src/directory-service.js';
import {
  ageKeyboard,
  assistantKeyboard,
  categoriesKeyboard,
  citiesKeyboard,
  cityChoiceKeyboard,
  datePickerKeyboard,
  eventCardKeyboard,
  filtersKeyboard,
  languageKeyboard,
  noResultsKeyboard,
  sessionsKeyboard,
  similarResultsKeyboard,
  sortKeyboard,
  subscriptionsKeyboard,
} from '../src/keyboards.js';
import { createSearchState } from '../src/session.js';
import { EVENT_ID, makeAssistantResponse, makeEvent, makeListItem, makeOccurrence } from './fixtures.js';

const issue = () => 'v1_AAAAAAAAAAAA';
const DIRECTORIES = new DirectoryService();

function labels(keyboard: ReturnType<typeof filtersKeyboard>): string[] {
  return keyboard.inline_keyboard.flat().map((button) => button.text);
}

function many<T>(count: number, make: (index: number) => T): T[] {
  return Array.from({ length: count }, (_, index) => make(index + 1));
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
      filtersKeyboard(createSearchState({ priceMax: 1000 }), issue, DIRECTORIES),
    );

    expect(buttons).toContain('✅ до 1\u00A0000\u00A0₽');
    expect(buttons.some((label) => label.startsWith('💰 Цена:'))).toBe(false);
  });

  it('показывает возраст, язык, сортировку и период', () => {
    const buttons = labels(
      filtersKeyboard(
        createSearchState({
          age: 6,
          language: 'ba',
          sort: 'price',
          dateFrom: '2026-11-20',
          dateTo: '2026-11-25',
        }),
        issue,
        DIRECTORIES,
        new Date('2026-11-13T12:00:00Z'),
      ),
    );
    expect(buttons).toContain('👶 Возраст: 6 лет');
    expect(buttons).toContain('🌐 Язык: Башкирский');
    expect(buttons).toContain('🔀 По цене');
    expect(buttons.some((label) => label.startsWith('📆 20–25 ноября'))).toBe(true);
  });

  it('добавляет счётчики facets к городам и категориям', () => {
    const facets = {
      cities: [{ id: 'ufa', name: 'Уфа', count: 3 }],
      categories: [{ id: 'concert', name: 'Концерт', count: 2 }],
      age_limits: [],
      price: { free: 0, paid: 0, unknown: 0 },
      total: 3,
    };
    const filterButtons = labels(
      filtersKeyboard(createSearchState({ facets }), issue, DIRECTORIES),
    );
    expect(filterButtons).toContain('📍 Все города · 3');
    expect(filterButtons).toContain('🎭 Все категории · 3');
    expect(filterButtons).toContain('Бесплатно · 0');

    const cities = labels(citiesKeyboard(issue, DIRECTORIES, 'filter', 1, facets));
    expect(cities).toContain('Уфа · 3');
    const categories = labels(categoriesKeyboard(issue, DIRECTORIES, 'filter', 1, facets));
    expect(categories).toContain('Концерт · 2');
  });

  it('строит экраны возраста, сортировки и языка', () => {
    expect(labels(ageKeyboard(12, issue))).toContain('✅ 12 лет');
    expect(labels(sortKeyboard('popularity', issue))).toContain('✅ По популярности');
    expect(labels(languageKeyboard('ba', issue))).toContain('✅ Башкирский');
    expect(labels(languageKeyboard(null, issue))).toContain('✅ Любой язык');
  });

  it('считает, сколько событий подходит ребёнку по age_limits', () => {
    const buttons = labels(
      ageKeyboard(null, issue, {
        cities: [],
        categories: [],
        age_limits: [
          { value: 6, count: 2 },
          { value: 12, count: 3 },
          { value: null, count: 4 },
        ],
        price: { free: 0, paid: 0, unknown: 0 },
        total: 9,
      }),
    );
    expect(buttons).toContain('6 лет · 2');
    expect(buttons).toContain('12 лет · 5');
    expect(buttons).toContain('18 лет · 5');
  });

  it('строит кнопки серверных ослаблений пустой выдачи', () => {
    const state = createSearchState({
      priceMax: 500,
      relaxations: [
        { code: 'budget', codes: ['budget'], label: 'Без цены', count: 7 },
        {
          code: 'date',
          codes: ['date'],
          label: { ru: 'Без даты', ba: 'Датаһыҙ' },
          count: 12,
        },
      ],
    });
    const buttons = labels(noResultsKeyboard(state, issue));
    expect(buttons).toContain('Без цены · 7');
    expect(buttons).toContain('Без даты · 12');
  });
});

describe('карточка события', () => {
  const event = makeEvent({
    lat: 54.7388,
    lon: 55.9721,
    venue_id: 'demo-hall-1',
    offers: [{ name: 'Взрослый', price: 800, audience: 'adult', is_free: false }],
    occurrences: [
      makeOccurrence({ id: 'a', date_start: '2026-11-20T19:00:00+05:00' }),
      makeOccurrence({ id: 'b', date_start: '2026-11-21T19:00:00+05:00' }),
    ],
  });

  it('показывает сеансы, тарифы, календарь, карту, площадку и шаринг', () => {
    const buttons = labels(
      eventCardKeyboard(event, issue, DIRECTORIES, {
        publicWebUrl: 'https://afisha-rb.ru',
        botUsername: 'afisha_test_bot',
      }),
    );
    expect(buttons).toContain('📅 Все сеансы (2)');
    expect(buttons).toContain('🎟 Тарифы');
    expect(buttons).toContain('📅 В календарь');
    expect(buttons).toContain('🗺 На карте');
    expect(buttons).toContain('🏛 Афиша площадки');
    expect(buttons).toContain('📤 Поделиться');
    expect(buttons).toContain('🎯 Похожие');
  });

  it('перечисляет сеансы и возвращает к событию', () => {
    const buttons = labels(sessionsKeyboard(event, issue, new Date('2026-11-13T12:00:00Z')));
    expect(buttons.some((label) => label.startsWith('20 ноя, пт, 19:00'))).toBe(true);
    expect(buttons.some((label) => label.startsWith('21 ноя, сб, 19:00'))).toBe(true);
    expect(buttons).toContain('← К событию');
  });
});

describe('подписки', () => {
  it('даёт открыть события подписки и удалить её', () => {
    const buttons = labels(
      subscriptionsKeyboard(
        [
          {
            id: '44444444-4444-4444-8444-444444444444',
            channel: 'telegram',
            city: 'ufa',
            category: 'concert',
            period: 'week',
            created_at: '2026-11-13T10:00:00+05:00',
          },
        ],
        issue,
        DIRECTORIES,
      ),
    );
    expect(buttons.some((label) => label.startsWith('▶️ Концерт · Уфа'))).toBe(true);
    expect(buttons).toContain('❌');
  });
});

describe('клавиатура ассистента', () => {
  it('открывает результаты, ослабления и снятие условий', () => {
    const buttons = labels(
      assistantKeyboard(
        makeAssistantResponse({
          chips: [
            {
              key: 'hard.cities',
              kind: 'city',
              label: 'Город',
              value: 'Уфа',
              removable: true,
              unset: ['hard.cities'],
            },
          ],
          relaxations: [{ code: 'date', codes: ['date'], label: 'Без даты', count: 4 }],
        }),
        issue,
      ),
    );
    expect(buttons).toContain('1. Вечер башкирской музыки');
    expect(buttons).toContain('Без даты · 4');
    expect(buttons).toContain('✖️ Город: Уфа');
    expect(buttons).toContain('🔎 Обычный поиск');
    expect(buttons).toContain('🏠 Меню');
  });

  it('показывает быстрые ответы на уточнение', () => {
    const buttons = labels(
      assistantKeyboard(
        makeAssistantResponse({
          action: 'clarify',
          clarify: {
            code: 'city',
            pending: ['city'],
            question: 'В каком городе?',
            quick_replies: ['Уфа', 'Стерлитамак'],
          },
          results: [],
          total: 0,
        }),
        issue,
      ),
    );
    expect(buttons).toContain('Уфа');
    expect(buttons).toContain('Стерлитамак');
  });

  it('не показывает подтверждение, пока флаг выключен', () => {
    const response = makeAssistantResponse({
      action: 'confirmation_required',
      results: [],
      total: 0,
      confirmation: {
        confirmation_id: 'cnf_123456',
        summary: 'Подписка на концерты',
        expires_at: '2026-11-14T12:00:00+05:00',
      },
    });
    expect(labels(assistantKeyboard(response, issue))).not.toContain('✅ Подтвердить');
    expect(
      labels(assistantKeyboard(response, issue, { confirmationsEnabled: true })),
    ).toContain('✅ Подтвердить');
  });
});

describe('клавиатура похожих событий', () => {
  const items = [
    makeListItem({ id: 'a', title: 'Первое' }),
    makeListItem({ id: 'b', title: 'Второе' }),
  ];

  it('нумерует события и показывает только доступные переходы', () => {
    const first = labels(similarResultsKeyboard(items, 'source', 1, 2, issue));
    expect(first).toContain('1. Первое');
    expect(first).toContain('2. Второе');
    expect(first).toContain('Показать ещё ➡️');
    expect(first).not.toContain('⬅️ Назад');
    expect(first).toContain('← К событию');

    const second = labels(similarResultsKeyboard(items, 'source', 2, 2, issue));
    expect(second).toContain('⬅️ Назад');
    expect(second).not.toContain('Показать ещё ➡️');
  });
});

describe('постраничные справочники', () => {
  const cities = many(30, (index) => ({ id: `city-${index}`, name: `Город ${index}` }));
  const categories = many(26, (index) => ({ id: `cat-${index}`, name: `Категория ${index}` }));
  const directories = new DirectoryService({ cities, categories });

  it('делит города на страницы и показывает только доступные переходы', () => {
    const first = labels(citiesKeyboard(issue, directories));
    expect(first.filter((label) => label.startsWith('Город '))).toHaveLength(24);
    expect(first).toContain('Город 24');
    expect(first).not.toContain('Город 25');
    expect(first).toContain('Ещё ➡️');
    expect(first).not.toContain('⬅️ Назад');

    const second = labels(citiesKeyboard(issue, directories, 'search', 2));
    expect(second.filter((label) => label.startsWith('Город '))).toHaveLength(6);
    expect(second).toContain('Город 25');
    expect(second).toContain('Город 30');
    expect(second).toContain('⬅️ Назад');
    expect(second).not.toContain('Ещё ➡️');
  });

  it('не выходит за границы страниц', () => {
    const second = labels(citiesKeyboard(issue, directories, 'search', 2));
    expect(labels(citiesKeyboard(issue, directories, 'search', 99))).toEqual(second);
    expect(labels(citiesKeyboard(issue, directories, 'search', 0))).toEqual(
      labels(citiesKeyboard(issue, directories)),
    );
  });

  it('страницы фильтра сохраняют режим выбора', () => {
    const buttons = labels(citiesKeyboard(issue, directories, 'filter', 2));
    expect(buttons).toContain('Все города');
    expect(buttons).toContain('← К фильтрам');
    expect(buttons).toContain('Город 25');
    expect(buttons).not.toContain('Город 1');
  });

  it('делит категории на страницы', () => {
    const first = labels(categoriesKeyboard(issue, directories));
    expect(first.filter((label) => label.startsWith('Категория '))).toHaveLength(24);
    expect(first).toContain('Ещё ➡️');

    const second = labels(categoriesKeyboard(issue, directories, 'search', 2));
    expect(second.filter((label) => label.startsWith('Категория '))).toHaveLength(2);
    expect(second).toContain('Категория 26');
    expect(second).toContain('⬅️ Назад');
  });

  it('в выборе подписки отмечает выбор на второй странице', () => {
    const buttons = labels(cityChoiceKeyboard('city-25', issue, directories, 2));
    expect(buttons).toContain('✅ Город 25');
    expect(buttons).toContain('⬅️ Назад');
    expect(buttons).not.toContain('Ещё ➡️');
    expect(buttons).toContain('← Назад');
  });
});
