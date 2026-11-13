'use client';

/**
 * Выдача каталога: сетка карточек, кнопка «Показать ещё» и списки событий,
 * скрытых фильтром из-за неуказанной цены или возраста.
 */

import { Button } from '@/components/ui';
import type { EventListItem } from '@/lib/api/types';
import { cn } from '@/lib/cn';
import { useT } from '@/lib/i18n';

import styles from './catalog.module.css';
import { EventCard, EventCardSkeleton } from './EventCard';
import { PAGE_SIZE } from './query';
import type { CatalogEntry, UnknownKind } from './store';

/** Сколько первых картинок грузить без ленивой загрузки: они видны на первом экране. */
const EAGER_IMAGES = 2;

export function GridSkeleton({ count = PAGE_SIZE, className }: { count?: number; className?: string }) {
  return (
    <div className={cn(styles.grid, className)} data-grid-skeleton="">
      {Array.from({ length: count }, (_, index) => (
        <EventCardSkeleton key={index} />
      ))}
    </div>
  );
}

export type ResultsProps = {
  entry: CatalogEntry;
  onLoadMore: () => void;
};

export function Results({ entry, onLoadMore }: ResultsProps) {
  const { t } = useT();
  const response = entry.response;
  if (!response) return null;

  const left = Math.max(0, response.total - entry.items.length);
  const hasMore = entry.pages < response.total_pages && left > 0;

  return (
    <div className="flex flex-col gap-10">
      <div className={styles.grid} data-event-grid="">
        {entry.items.map((event, index) => (
          <EventCard
            key={event.id}
            event={event}
            today={response.reference_date}
            now={entry.fetchedAt}
            order={index % PAGE_SIZE}
            eager={index < EAGER_IMAGES}
          />
        ))}
        {entry.loadingMore
          ? Array.from({ length: Math.min(PAGE_SIZE, left) }, (_, index) => (
              <EventCardSkeleton key={`more-${index}`} />
            ))
          : null}
      </div>

      {hasMore ? (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-line pt-6">
          <Button variant="ghost" size="lg" onClick={onLoadMore} disabled={entry.loadingMore} data-load-more="">
            {entry.loadingMore ? t('events.loading') : entry.moreFailed ? t('common.retry') : t('events.loadMore')}
          </Button>
          <p data-num className="text-[0.9375rem] text-fg-muted" aria-hidden="true">
            {entry.items.length} / {response.total}
          </p>
          {entry.moreFailed ? (
            <p role="alert" className="text-[0.9375rem] font-medium text-status-cancelled">
              {t('common.error')}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export type UnknownSectionProps = {
  kind: UnknownKind;
  items: EventListItem[];
  status: 'loading' | 'ready' | 'error';
  count: number;
  today: string;
  now: number;
};

/** События без цены или возраста, показанные по кнопке: отдельный список со своим заголовком. */
export function UnknownSection({ kind, items, status, count, today, now }: UnknownSectionProps) {
  const { t } = useT();
  return (
    <section className="flex flex-col gap-6 border-t border-line pt-8" data-unknown-section={kind}>
      <h3 className="t-subtitle">{kind === 'price' ? t('price.unknown') : t('age.unknown')}</h3>
      {status === 'loading' ? <GridSkeleton count={Math.min(count, 3)} className={styles.plain} /> : null}
      {status === 'error' ? (
        <p role="alert" className="t-body text-status-cancelled">
          {t('common.error')}
        </p>
      ) : null}
      {status === 'ready' ? (
        <div className={cn(styles.grid, styles.plain)}>
          {items.map((event, index) => (
            <EventCard key={event.id} event={event} today={today} now={now} order={index} />
          ))}
        </div>
      ) : null}
    </section>
  );
}
