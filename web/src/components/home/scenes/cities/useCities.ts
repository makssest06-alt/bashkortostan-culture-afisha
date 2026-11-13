'use client';

import { useEffect, useState } from 'react';

import { CITIES } from '@/data/dictionaries';
import { getFacets, listEvents } from '@/lib/api/client';
import type { CityId, EventListItem, LocalizedText } from '@/lib/api/types';

export type CityEvent = {
  id: string;
  title: string;
  titleBa?: string;
  /** Путь к картинке события или null, если картинки нет. */
  image: string | null;
};

export type CityRow = {
  id: CityId;
  name: LocalizedText;
  /** Число событий в городе. null, пока API не ответил. */
  count: number | null;
  /** Самое популярное событие города: оно даёт миниатюру строки. undefined, пока идёт загрузка. */
  event: CityEvent | null | undefined;
};

export type CitiesState = {
  status: 'loading' | 'ready' | 'error';
  rows: CityRow[];
  /** Всего событий в каталоге. */
  total: number | null;
};

/** Сколько событий запрашиваем ради миниатюр: это предел page_size у API. */
const EVENTS_PAGE = 50;

/** Строки до ответа API: города из справочника, названия и ссылки работают сразу. */
const PLACEHOLDER: CitiesState = {
  status: 'loading',
  rows: CITIES.map((city) => ({ id: city.slug, name: city.name, count: null, event: undefined })),
  total: null,
};

function toCityEvent(event: EventListItem): CityEvent {
  return { id: event.id, title: event.title, titleBa: event.title_ba, image: event.image };
}

/** Самое популярное событие каждого города. События уже отсортированы по популярности; с картинкой важнее. */
function pickEvents(events: readonly EventListItem[]): Map<CityId, CityEvent> {
  const picked = new Map<CityId, CityEvent>();
  for (const event of events) {
    const current = picked.get(event.venue.city);
    if (!current || (!current.image && event.image)) picked.set(event.venue.city, toCityEvent(event));
  }
  return picked;
}

/**
 * Города с числом событий (GET /api/v1/facets, по убыванию) и миниатюрами (GET /api/v1/events).
 * Пока ответа нет, отдаёт города из справочника без чисел; при ошибке они же остаются ссылками.
 */
export function useCities(): CitiesState {
  const [state, setState] = useState<CitiesState>(PLACEHOLDER);

  useEffect(() => {
    const controller = new AbortController();
    const options = { signal: controller.signal };

    Promise.all([getFacets({}, options), listEvents({ sort: 'popularity', page_size: EVENTS_PAGE }, options)])
      .then(async ([facets, list]) => {
        const events = pickEvents(list.items);
        const cities = facets.cities.filter((city) => city.count > 0).sort((a, b) => b.count - a.count);

        // В первую страницу попали не все события: городам без миниатюры спрашиваем по одному событию.
        const missing = list.total > list.items.length ? cities.filter((city) => !events.get(city.id)?.image) : [];
        const extra = await Promise.all(
          missing.map((city) => listEvents({ city: [city.id], sort: 'popularity', page_size: 4 }, options)),
        );
        for (const response of extra) {
          for (const [city, event] of pickEvents(response.items)) {
            if (!events.get(city)?.image) events.set(city, event);
          }
        }

        setState({
          status: 'ready',
          rows: cities.map((city) => ({
            id: city.id,
            name: city.name,
            count: city.count,
            event: events.get(city.id) ?? null,
          })),
          total: facets.total,
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (process.env.NODE_ENV !== 'production') console.warn('[cities] каталог не ответил', error);
        setState((previous) => ({
          status: 'error',
          rows: previous.rows.map((row) => ({ ...row, event: row.event ?? null })),
          total: previous.total,
        }));
      });

    return () => controller.abort();
  }, []);

  return state;
}
