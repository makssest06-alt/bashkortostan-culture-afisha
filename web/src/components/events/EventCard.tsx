'use client';

/**
 * Карточка события в выдаче каталога. Вся карточка ведёт на /events/<id>:
 * ссылка стоит в заголовке и растянута на всю площадь, поэтому скринридер читает название,
 * а не всё содержимое карточки подряд.
 */

import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import type { CSSProperties } from 'react';

import { KuskarRing } from '@/components/ornament';
import { AgeBadge, PriceTag, Skeleton, StatusBadge } from '@/components/ui';
import { getCategory } from '@/data/dictionaries';
import { formatAgo, formatOccurrence, formatTimeValue } from '@/lib/api/format';
import type { EventListItem } from '@/lib/api/types';
import { cn } from '@/lib/cn';
import { pick, useT } from '@/lib/i18n';

import styles from './catalog.module.css';

export type EventCardProps = {
  event: EventListItem;
  /** Сегодняшняя дата афиши (reference_date): от неё считается «до 2 декабря» у выставок. */
  today: string;
  /** Момент получения ответа: от него считается «проверено N часов назад». */
  now: number;
  /** Номер в каскаде появления. */
  order: number;
  /** Картинка из первого экрана: грузится сразу, без ленивой загрузки. */
  eager?: boolean;
};

export function EventCard({ event, today, now, order, eager = false }: EventCardProps) {
  const { t, lang } = useT();
  const [imageFailed, setImageFailed] = useState(false);

  const occurrence =
    event.occurrences.find((item) => item.id === event.primary_occurrence_id) ?? event.occurrences[0];
  const title = lang === 'ba' && event.title_ba ? event.title_ba : event.title;
  const category = getCategory(event.category);
  const categoryName = category ? pick(category.name_one, lang) : '';
  const moreSessions = event.matched_occurrence_ids.length - 1;
  const showImage = Boolean(event.image) && !imageFailed;

  return (
    <article className={styles.card} style={{ '--i': order } as CSSProperties} data-event-card={event.id}>
      <div className={styles.media}>
        {showImage && event.image ? (
          <Image
            src={event.image}
            alt=""
            fill
            sizes="(min-width: 1280px) 26vw, (min-width: 768px) 44vw, 104px"
            loading={eager ? 'eager' : 'lazy'}
            className={styles.image}
            onError={() => setImageFailed(true)}
          />
        ) : (
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-surface-2 px-2 text-fg-muted">
            <KuskarRing size="56%" />
            <span className="t-caps text-center text-fg-soft max-md:visually-hidden">{categoryName}</span>
            <span className="visually-hidden">{t('events.card.noImage')}</span>
          </span>
        )}
      </div>

      {/* Две части текста: на широком экране они встают в общие строки ряда (subgrid в catalog.module.css) */}
      <div className={styles.body}>
        <div className={styles.head}>
          <p className="t-caps flex flex-wrap items-baseline gap-x-3 gap-y-1">
            {occurrence ? (
              <time dateTime={occurrence.start.local} className="text-copper-hi">
                {formatOccurrence(occurrence, lang, today)}
              </time>
            ) : null}
            <span className="text-fg-muted">{categoryName}</span>
          </p>

          <h3 className={styles.title}>
            <Link href={`/events/${event.id}`} className={styles.link}>
              {title}
            </Link>
          </h3>

          <p className={cn(styles.excerpt, 't-body max-w-[58ch] text-fg-soft')}>{event.description}</p>

          <p className="text-[0.9375rem] leading-[1.35] text-fg-soft">
            {event.venue.name}, {pick(event.venue.city_name, lang)}
          </p>

          {moreSessions > 0 || occurrence?.previous_start ? (
            <p className="text-[0.8125rem] leading-[1.35] text-fg-muted">
              {occurrence?.previous_start
                ? t('event.previousDate', { date: formatTimeValue(occurrence.previous_start, lang) })
                : t('events.card.moreSessions', { count: moreSessions })}
            </p>
          ) : null}
        </div>

        <div className={styles.tail}>
          <div className={styles.facts}>
            <PriceTag price={event.price_summary} className="text-[1.0625rem] leading-[1.2]" />
            <AgeBadge rating={event.age_rating} />
            {occurrence ? <StatusBadge occurrence={occurrence} size="sm" /> : null}
          </div>

          <p className="text-[0.8125rem] leading-[1.35] text-fg-soft">
            {event.source.name}. {t('event.checked', { ago: formatAgo(event.source.checked_at, new Date(now), lang) })}
          </p>
        </div>
      </div>
    </article>
  );
}

/** Заглушка карточки на время загрузки: те же пропорции, что у настоящей. */
export function EventCardSkeleton() {
  return (
    <div className={styles.card} aria-hidden="true" data-event-skeleton="">
      <Skeleton className={cn(styles.media, 'w-full')} />
      <div className={styles.body}>
        <div className={styles.head}>
          <Skeleton className="h-3.5 w-2/5" />
          <Skeleton className="h-6 w-11/12" />
          <Skeleton className="h-6 w-3/5 max-md:hidden" />
          <Skeleton className="h-4 w-4/5" />
        </div>
        <div className={styles.tail}>
          <div className={styles.facts}>
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-5 w-9" />
            <Skeleton className="h-5 w-24" />
          </div>
          <Skeleton className="h-3.5 w-3/5" />
        </div>
      </div>
    </div>
  );
}
