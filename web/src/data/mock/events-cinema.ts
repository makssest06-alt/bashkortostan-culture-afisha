/**
 * Демонстрационные кинопоказы: категория «кино» из п. 8.1 ТЗ.
 * Площадки настоящие, сами показы условные (synthetic: true, «Демо-источник»).
 */

import type { MockEvent } from './types';

export const CINEMA_EVENTS: readonly MockEvent[] = [
  {
    id: 'evt_demo_v1',
    title: 'Кинопоказ: башкирское кино с субтитрами',
    description: 'Вечерний показ художественного фильма на башкирском языке с русскими субтитрами. Перед сеансом короткое вступление ведущего.',
    category: 'cinema',
    tags: ['башкирский язык'],
    language: 'ba',
    kind: 'standalone',
    age_rating: '12+',
    image: null,
    organizer: 'Городской дом культуры (демо)',
    popularity: 52,
    venue_id: 'ven_okt_gdk',
    schedule: [
      { kind: 'weekday', weekday: 'fri', time: '18:30', duration_min: 110 },
      { kind: 'weekday', weekday: 'fri', week: 1, time: '18:30', duration_min: 110 },
    ],
    offers: [{ rub: 200 }],
    checked_hours_ago: 5,
    sources_count: 1,
    has_ticket_link: false,
  },
  {
    id: 'evt_demo_v2',
    title: 'Детский киноутренник: мультфильмы',
    description: 'Сборник короткометражных мультфильмов для малышей. Сеанс идёт около часа, в зале горит неяркий свет.',
    category: 'cinema',
    tags: ['дети'],
    kind: 'standalone',
    age_rating: '0+',
    image: null,
    organizer: 'Театрально-концертное объединение (демо)',
    popularity: 61,
    venue_id: 'ven_str_tko',
    schedule: [
      { kind: 'weekday', weekday: 'sat', time: '10:30', duration_min: 60 },
      { kind: 'weekday', weekday: 'sun', time: '10:30', duration_min: 60 },
    ],
    offers: [{ rub: 150 }],
    checked_hours_ago: 9,
    sources_count: 2,
    has_ticket_link: true,
  },
  {
    id: 'evt_demo_v3',
    title: 'Документальное кино о Южном Урале',
    description: 'Показ документального фильма о природе и заповедниках Южного Урала в лектории музея. После показа обсуждение со зрителями.',
    category: 'cinema',
    kind: 'standalone',
    age_rating: '6+',
    image: null,
    organizer: 'Национальный музей (демо)',
    popularity: 44,
    venue_id: 'ven_ufa_national_museum',
    schedule: [
      { kind: 'offset', day_offset: 3, time: '17:00', duration_min: 75 },
      { kind: 'offset', day_offset: 10, time: '17:00', duration_min: 75 },
    ],
    offers: [{ rub: 0, is_free: true }],
    checked_hours_ago: 20,
    sources_count: 1,
    has_ticket_link: false,
  },
];
