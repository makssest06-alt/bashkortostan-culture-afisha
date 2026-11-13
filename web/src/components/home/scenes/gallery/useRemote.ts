'use client';

/**
 * Загрузка данных сцены после монтирования: три состояния и повтор.
 *
 *   const [events, retry] = useRemote((signal) => listEvents(query, { signal }));
 *   if (events.status === 'loading') ...скелетон
 *   if (events.status === 'error')   ...сообщение и кнопка, которая зовёт retry()
 *
 * Запрос уходит один раз на попытку. При размонтировании отменяется.
 */

import { useCallback, useEffect, useEffectEvent, useState } from 'react';

export type Remote<T> = { status: 'loading' } | { status: 'ready'; data: T } | { status: 'error' };

const LOADING: Remote<never> = { status: 'loading' };

export function useRemote<T>(load: (signal: AbortSignal) => Promise<T>): [Remote<T>, () => void] {
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<{ attempt: number; value: Remote<T> } | null>(null);
  const run = useEffectEvent(load);

  useEffect(() => {
    const controller = new AbortController();
    run(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setSettled({ attempt, value: { status: 'ready', data } });
      },
      () => {
        // Отмена при размонтировании не ошибка: состояние не трогаем.
        if (!controller.signal.aborted) setSettled({ attempt, value: { status: 'error' } });
      },
    );
    return () => controller.abort();
  }, [attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const state = settled && settled.attempt === attempt ? settled.value : LOADING;
  return [state, retry];
}
