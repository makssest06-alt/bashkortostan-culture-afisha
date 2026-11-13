/**
 * Форма демонстрационных записей до материализации.
 *
 * Абсолютных дат здесь нет: сеанс задаётся смещением от «сегодня»
 * (day_offset от -1 до +21) или ближайшим днём недели. Реальные даты
 * вычисляет слой данных (src/lib/api/db.ts) в поясе Asia/Yekaterinburg,
 * поэтому «сегодня», «выходные» и «в субботу» всегда дают результаты.
 */

import type {
  AgeRating,
  Availability,
  CategoryId,
  CityId,
  EventKind,
  OccurrenceStatus,
  OfferAudience,
} from '../../lib/api/types';

export type MockWeekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

interface MockOccurrenceState {
  /** По умолчанию scheduled. */
  status?: OccurrenceStatus;
  /** По умолчанию true, для status = unknown всегда false. */
  status_is_verified?: boolean;
  /** По умолчанию available. */
  availability?: Availability;
}

/** Сеанс через N дней от сегодня. */
export interface MockOffsetSession extends MockOccurrenceState {
  kind: 'offset';
  /** От -1 до +21. */
  day_offset: number;
  /** ЧЧ:ММ по местному времени. */
  time: string;
  duration_min?: number;
  /** Прежняя дата перенесённого сеанса (для status = rescheduled). */
  previous?: { day_offset: number; time: string };
}

/**
 * Сеанс в ближайший день недели. week = 0: ближайший такой день, считая сегодня
 * (если сегодня его время уже прошло, берётся следующая неделя); week = 1: неделей позже.
 */
export interface MockWeekdaySession extends MockOccurrenceState {
  kind: 'weekday';
  weekday: MockWeekday;
  week?: 0 | 1 | 2;
  time: string;
  duration_min?: number;
}

/** Выставка или экспозиция с периодом работы: известны только даты. */
export interface MockPeriod extends MockOccurrenceState {
  kind: 'period';
  from_offset: number;
  to_offset: number;
}

export type MockSchedule = MockOffsetSession | MockWeekdaySession | MockPeriod;

export interface MockOffer {
  name?: string;
  /** Цена в рублях. null: цена не указана. */
  rub: number | null;
  audience?: OfferAudience;
  /** Явная пометка «бесплатно». */
  is_free?: boolean;
}

export interface MockVenue {
  id: string;
  name: string;
  city: CityId;
  /** Только проверенные адреса. null: показываем город без улицы. */
  address: string | null;
  lat?: number;
  lon?: number;
}

export interface MockEvent {
  id: string;
  title: string;
  title_ba?: string;
  description: string;
  category: CategoryId;
  kind: EventKind;
  age_rating: AgeRating | null;
  image: string | null;
  organizer?: string;
  /** От 0 до 100. */
  popularity: number;
  venue_id: string;
  schedule: MockSchedule[];
  /** Пустой массив: цена не указана. */
  offers: MockOffer[];
  /** Сколько часов назад запись сверяли с источником. */
  checked_hours_ago: number;
  sources_count: number;
  /** Есть ли ссылка для кнопки «Купить билет». */
  has_ticket_link: boolean;
}
