'use client';

/**
 * Резервный режим /ask (п. 7.5): ассистент недоступен, и рабочая область показывает обычный
 * поиск по каталогу с теми же фильтрами, что в /events. Плашка говорит об этом прямо.
 */

import { ArrowRight, WarningCircle } from '@phosphor-icons/react';
import Link from 'next/link';
import { useEffect, useId, useState } from 'react';

import { FilterControls } from '@/components/events/FilterControls';
import { catalogHref } from '@/components/events/query';
import { listEvents } from '@/lib/api/client';
import type { EventsListResponse, EventsQuery } from '@/lib/api/types';
import { useT } from '@/lib/i18n';

import styles from './ask.module.css';
import { askText } from './copy';
import { ResultCard, ResultCardSkeleton } from './ResultCard';

const LIMIT = 6;

type Loaded = {
  key: string;
  data: EventsListResponse | null;
  failed: boolean;
  at: number;
};

export function FallbackSearch({ query, onChange }: { query: EventsQuery; onChange: (query: EventsQuery) => void }) {
  const { t, lang } = useT();
  const titleId = useId();
  const key = JSON.stringify(query);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const abort = new AbortController();
    listEvents({ ...query, page: 1, page_size: LIMIT }, { signal: abort.signal })
      .then((data) => setLoaded({ key, data, failed: false, at: Date.now() }))
      .catch((error: unknown) => {
        if (!abort.signal.aborted) setLoaded({ key, data: null, failed: true, at: Date.now() });
        void error;
      });
    return () => abort.abort();
  }, [key, query, attempt]);

  const current = loaded?.key === key ? loaded : null;
  const data = current?.data ?? null;

  return (
    <section className={styles.results} aria-labelledby={titleId} data-ask-fallback="">
      <div
        role="status"
        className="mb-5 flex items-start gap-3 rounded-sm border border-status-moved/60 bg-status-moved/10 px-4 py-3"
      >
        <WarningCircle size={22} weight="fill" aria-hidden="true" className="mt-px shrink-0 text-status-moved" />
        <div className="flex flex-col gap-1">
          <p id={titleId} className="t-ui text-fg" data-ask-fallback-banner="">
            {askText('fallbackBanner', lang)}
          </p>
          <p className="text-[0.875rem] leading-[1.45] text-fg-soft">{askText('fallbackHint', lang)}</p>
        </div>
      </div>

      <details className="mb-6 rounded-sm border border-line px-4 py-3" open>
        <summary className="cursor-pointer t-ui text-fg">{askText('fallbackFilters', lang)}</summary>
        <FilterControls
          query={query}
          facets={data?.facets ?? null}
          today={data?.reference_date ?? null}
          onChange={(next) => onChange({ ...next, page: undefined, page_size: undefined })}
          className="mt-4"
        />
      </details>

      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <p className="t-ui text-fg" aria-live="polite">
          {data ? askText('fallbackFound', lang, { total: data.total }) : ' '}
        </p>
        <Link
          href={catalogHref(query)}
          className="inline-flex min-h-11 items-center gap-1.5 text-[0.9375rem] underline decoration-line-strong underline-offset-4 hover:decoration-fg"
        >
          {askText('fallbackCatalog', lang)}
          <ArrowRight size={14} weight="bold" aria-hidden="true" />
        </Link>
      </div>

      {current?.failed ? (
        <div role="alert" className="flex flex-col items-start gap-3">
          <p className="text-fg-soft">{askText('fallbackError', lang)}</p>
          <button
            type="button"
            className="underline underline-offset-4"
            onClick={() => setAttempt((value) => value + 1)}
          >
            {t('common.retry')}
          </button>
        </div>
      ) : !current ? (
        <ul className={styles.cards} aria-busy="true">
          {Array.from({ length: 3 }, (_, index) => (
            <ResultCardSkeleton key={index} />
          ))}
        </ul>
      ) : data && data.items.length === 0 ? (
        <p className="text-fg-soft">{askText('fallbackEmpty', lang)}</p>
      ) : data ? (
        <ul className={styles.cards}>
          {data.items.map((item, index) => (
            <ResultCard
              key={item.id}
              result={{
                event: item,
                occurrence_id: item.primary_occurrence_id,
                reasons: [],
                caveats: [],
              }}
              today={data.reference_date}
              now={current.at}
              order={index}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}
