/**
 * Демонстрационный каталог афиши.
 *
 * Все записи условные: у каждой в ответе API стоит synthetic: true,
 * источник назван «Демо-источник» и ведёт на /about#demo. Когда появится
 * боевой каталог, заменить нужно только этот каталог данных и src/lib/api/db.ts:
 * форма ответов API не изменится.
 */

import { FAMILY_EVENTS } from './events-family';
import { MUSEUM_EVENTS } from './events-museum';
import { STAGE_EVENTS } from './events-stage';
import type { MockEvent } from './types';

export { MOCK_VENUES } from './venues';
export type { MockEvent, MockOffer, MockSchedule, MockVenue, MockWeekday, MockWeekdaySession } from './types';

export const MOCK_EVENTS: readonly MockEvent[] = [...STAGE_EVENTS, ...MUSEUM_EVENTS, ...FAMILY_EVENTS];

/** Источник у всех демонстрационных записей один. */
export const MOCK_SOURCE = {
  name: 'Демо-источник',
  url: '/about#demo',
} as const;

/** Куда ведёт кнопка «Купить билет» у демонстрационных событий: на пояснение о демо-данных. */
export const MOCK_TICKET_URL = '/about#demo';
