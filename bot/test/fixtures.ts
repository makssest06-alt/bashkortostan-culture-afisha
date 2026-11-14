import type { AssistantResponse, Event, EventListItem, Occurrence } from '../src/api/types.js';

export const EVENT_ID = '11111111-1111-4111-8111-111111111111';
export const EVENT_ID_2 = '22222222-2222-4222-8222-222222222222';

export function makeOccurrence(overrides: Partial<Occurrence> = {}): Occurrence {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    date_start: '2026-11-20T19:00:00+05:00',
    date_end: null,
    time_precision: 'minute',
    status: 'scheduled',
    status_verified: true,
    availability: 'available',
    is_past: false,
    ...overrides,
  };
}

export function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: EVENT_ID,
    title: 'Вечер башкирской музыки',
    category: 'concert',
    tags: ['музыка', 'классика'],
    date_start: '2026-11-20T19:00:00+05:00',
    date_end: null,
    duration_min: 90,
    city: 'Уфа',
    venue: 'Башкирская государственная филармония',
    address: 'ул. Гоголя, 58',
    description: 'Концерт симфонической музыки с участием солистов филармонии.',
    price_min: 500,
    price_max: 1200,
    is_free: false,
    age_limit: 12,
    language: 'ru',
    org_link: 'https://afisha-rb.ru/tickets/1',
    source_url: 'https://afisha-rb.ru/events/1',
    status: 'published',
    city_id: 'ufa',
    occurrences: [makeOccurrence()],
    offers: [],
    sources: [],
    ...overrides,
  };
}

export function makeListItem(overrides: Partial<EventListItem> = {}): EventListItem {
  return {
    ...makeEvent(overrides),
    matched_occurrence_ids: ['33333333-3333-4333-8333-333333333333'],
    primary_occurrence_id: '33333333-3333-4333-8333-333333333333',
    ...overrides,
  };
}

export function makeListResponse(items: EventListItem[] = [makeListItem()], overrides: Record<string, unknown> = {}) {
  return {
    items,
    page: 1,
    page_size: 5,
    total: items.length,
    total_pages: items.length > 0 ? 1 : 0,
    facets: {
      cities: [{ id: 'ufa', name: 'Уфа', count: items.length }],
      categories: [{ id: 'concert', name: 'Концерт', count: items.length }],
      age_limits: [{ value: 12, count: items.length }],
      price: { free: 0, paid: items.length, unknown: 0 },
      total: items.length,
    },
    relaxations: [],
    hidden_unknown_price: 0,
    hidden_unknown_age: 0,
    ...overrides,
  };
}

export function makeAssistantResponse(
  overrides: Partial<AssistantResponse> = {},
): AssistantResponse {
  return {
    action: 'search',
    message: 'Нашлось 1 событие по вашим условиям.',
    constraints: { hard: { cities: ['ufa'] }, soft: {} },
    chips: [],
    assumptions: [],
    results: [
      {
        event: makeListItem(),
        occurrence_id: '33333333-3333-4333-8333-333333333333',
        reasons: ['подходит по городу'],
        caveats: [],
      },
    ],
    total: 1,
    hidden_unknown_price: 0,
    hidden_unknown_age: 0,
    relaxations: [],
    unsupported_actions: [],
    reference_date: '2026-11-13',
    timezone: 'Asia/Yekaterinburg',
    engine: 'rules-v2',
    trace_id: 'trace-1',
    ...overrides,
  };
}
