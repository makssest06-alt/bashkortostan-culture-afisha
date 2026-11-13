'use client';

import { useEffect, useState } from 'react';

import { listEvents } from '@/lib/api/client';

/** Факты каталога для светлого блока: только то, что отдал API. */
export type TrustFacts = {
  /** Сколько событий в каталоге прямо сейчас. */
  total: number;
  /** Самое популярное событие: на нём показано, как выглядит отметка о проверке. */
  sample: { title: string; titleBa?: string; checkedAt: string } | null;
  /** Момент ответа API: от него считается «проверено N часов назад». */
  loadedAt: number;
};

/**
 * Число событий и одна настоящая отметка о проверке из GET /api/v1/events.
 * null, пока ответа нет или запрос не удался: блок тогда обходится без числа.
 */
export function useTrustFacts(): TrustFacts | null {
  const [facts, setFacts] = useState<TrustFacts | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    listEvents({ sort: 'popularity', page_size: 1 }, { signal: controller.signal })
      .then((response) => {
        const first = response.items[0];
        setFacts({
          total: response.total,
          sample: first
            ? { title: first.title, titleBa: first.title_ba, checkedAt: first.source.checked_at }
            : null,
          loadedAt: Date.now(),
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        // Без ответа блок остаётся без числа и без примера: выдуманных значений не показываем.
        if (process.env.NODE_ENV !== 'production') console.warn('[trust] каталог не ответил', error);
      });
    return () => controller.abort();
  }, []);

  return facts;
}
