/**
 * Спорные демо-карточки: черновики в очереди модерации (п. 6.1 «спорные помечены»).
 * Публично не видны, пока модератор не опубликует их в /admin.
 */

import type { MockEvent } from './types';

export const MODERATION_EVENTS: readonly MockEvent[] = [
  {
    id: 'evt_demo_d1',
    title: 'Вечер авторской песни',
    description: 'Камерный вечер авторской песни под гитару. Программа уточняется у организатора.',
    category: 'concert',
    status: 'draft',
    confidence: 0.58,
    review: {
      reasons: [
        'Возможный дубль: похожее событие пришло из другого источника с другим временем начала',
        'Цена указана текстом: «уточняйте в кассе»',
      ],
    },
    kind: 'standalone',
    age_rating: '12+',
    image: null,
    popularity: 35,
    venue_id: 'ven_nfk_philharmonic',
    schedule: [{ kind: 'offset', day_offset: 6, time: '19:00', duration_min: 90 }],
    offers: [],
    checked_hours_ago: 30,
    sources_count: 2,
    has_ticket_link: false,
  },
  {
    id: 'evt_demo_d2',
    title: 'Выставка народного костюма',
    description: '',
    category: 'exhibition',
    status: 'draft',
    confidence: 0.64,
    review: { reasons: ['Нет описания', 'Не указано возрастное ограничение'] },
    kind: 'exhibition',
    age_rating: null,
    image: null,
    popularity: 28,
    venue_id: 'ven_blr_museum',
    schedule: [{ kind: 'period', from_offset: 2, to_offset: 20 }],
    offers: [{ rub: 150 }],
    checked_hours_ago: 50,
    sources_count: 1,
    has_ticket_link: false,
  },
];
