/**
 * Проверочные состояния страницы события. Работают только в режиме разработки
 * (в боевой сборке параметр ?debug=... ничего не делает):
 *
 *   /events/<id>?debug=error    сбой сервера: страница ошибки с кнопкой повтора
 *   /events/<id>?debug=slow     задержка ответа: виден каркас загрузки
 *   /events/<id>?debug=past     все сеансы прошли: «Ближайших сеансов нет»
 *   /events/<id>?debug=alone    других событий в городе нет: пустой блок «Ещё в городе»
 *   /events/<id>?debug=long     длинные название, описание, площадка и тарифы
 *   /events/<id>?debug=many     шесть сеансов подряд: список сворачивается под кнопку «Все сеансы»
 */

import { addDays, timedValue, valueDate, valueTime } from '@/lib/api/time';
import type { AfishaEvent, Occurrence } from '@/lib/api/types';

export type DebugMode = 'error' | 'slow' | 'past' | 'alone' | 'long' | 'many';

const MODES: readonly DebugMode[] = ['error', 'slow', 'past', 'alone', 'long', 'many'];
const MANY_SESSIONS = 6;
const SLOW_MS = 2500;

export function debugModeOf(value: string | string[] | undefined): DebugMode | null {
  if (process.env.NODE_ENV === 'production' || typeof value !== 'string') return null;
  return MODES.includes(value as DebugMode) ? (value as DebugMode) : null;
}

const LONG_TITLE =
  'Большой праздничный вечер национальной музыки, танца и театра с участием приглашённых коллективов республики';

const LONG_PARAGRAPH =
  'Проверочный текст длинного описания. Он нужен, чтобы убедиться: абзацы переносятся, строка не шире шестидесяти знаков, а хвост свёрнут под кнопкой.';

/** Подменяет данные события под проверочное состояние. Само событие в каталоге не меняется. */
export async function applyDebug(event: AfishaEvent, mode: DebugMode | null): Promise<AfishaEvent> {
  if (mode === 'error') throw new Error('Проверочный сбой страницы события (?debug=error)');
  if (mode === 'slow') await new Promise((resolve) => setTimeout(resolve, SLOW_MS));
  if (mode === 'past') {
    return { ...event, occurrences: event.occurrences.map((occurrence) => ({ ...occurrence, is_past: true })) };
  }
  if (mode === 'many') {
    const base = event.occurrences.find((occurrence) => !occurrence.is_past) ?? event.occurrences[0];
    if (!base) return event;
    const time = valueTime(base.start) ?? '19:00';
    const occurrences: Occurrence[] = Array.from({ length: MANY_SESSIONS }, (_, index) => ({
      ...base,
      id: `occ_debug_${index + 1}`,
      start: timedValue(addDays(valueDate(base.start), index), time),
      end: undefined,
      previous_start: undefined,
      status: 'scheduled',
      status_is_verified: true,
      availability: index === 1 ? 'sold_out' : 'available',
      is_past: false,
    }));
    return { ...event, occurrences };
  }
  if (mode === 'long') {
    return {
      ...event,
      title: LONG_TITLE,
      title_ba: undefined,
      description: [event.description, LONG_PARAGRAPH, LONG_PARAGRAPH, '<script>alert(1)</script> <b>не разметка</b>', LONG_PARAGRAPH].join('\n\n'),
      organizer: 'Проверочный организатор с очень длинным официальным названием учреждения культуры',
      venue: {
        ...event.venue,
        name: 'Проверочная площадка с длинным официальным названием и уточнением зала',
      },
      offers: [
        { id: 'off_debug_1', name: 'Партер, первые ряды у сцены', amount_minor: 250000, currency: 'RUB', is_free: false },
        { id: 'off_debug_2', name: 'Балкон', amount_minor: 90000, currency: 'RUB', is_free: false },
        { id: 'off_debug_3', amount_minor: null, currency: 'RUB', audience: 'reduced', is_free: false },
        { id: 'off_debug_4', amount_minor: 0, currency: 'RUB', audience: 'child', is_free: true },
      ],
      price_summary: { kind: 'from', amount_minor: 90000 },
    };
  }
  return event;
}
