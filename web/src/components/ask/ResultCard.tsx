'use client';

/**
 * Карточка события в подборке ассистента. Под фактами события стоит блок
 * «Почему подходит»: причины приходят из ответа API и выводятся как есть, текстом.
 */

import { Check, Warning } from '@phosphor-icons/react';
import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import type { CSSProperties } from 'react';

import { KuskarRing } from '@/components/ornament';
import { AgeBadge, PriceTag, Skeleton, StatusBadge } from '@/components/ui';
import { getCategory } from '@/data/dictionaries';
import { formatAgo, formatOccurrence } from '@/lib/api/format';
import type { AssistantResult } from '@/lib/api/types';
import { cn } from '@/lib/cn';
import { pick, useT } from '@/lib/i18n';

import styles from './ask.module.css';

export type ResultCardProps = {
  result: AssistantResult;
  /** Сегодняшняя дата афиши (reference_date). */
  today: string;
  /** Момент получения ответа: от него считается «проверено N часов назад». */
  now: number;
  /** Номер в каскаде появления. */
  order: number;
};

export function ResultCard({ result, today, now, order }: ResultCardProps) {
  const { t, lang } = useT();
  const [imageFailed, setImageFailed] = useState(false);

  const { event, reasons, caveats } = result;
  const occurrence = event.occurrences.find((item) => item.id === result.occurrence_id) ?? event.occurrences[0];
  const title = lang === 'ba' && event.title_ba ? event.title_ba : event.title;
  const category = getCategory(event.category);
  const categoryName = category ? pick(category.name_one, lang) : '';
  const href = `/events/${event.id}`;
  const showImage = Boolean(event.image) && !imageFailed;

  return (
    <li className={styles.card} style={{ '--i': order } as CSSProperties} data-ask-card={event.id}>
      <div className={styles.media}>
        {showImage && event.image ? (
          <Image
            src={event.image}
            alt=""
            fill
            sizes="(min-width: 1024px) 148px, 96px"
            loading={order < 2 ? 'eager' : 'lazy'}
            className={styles.image}
            onError={() => setImageFailed(true)}
          />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center bg-surface-2 text-fg-muted">
            <KuskarRing size="62%" />
            <span className="visually-hidden">{t('events.card.noImage')}</span>
          </span>
        )}
      </div>

      <div className={styles.cardBody}>
        <p className="t-caps flex flex-wrap items-baseline gap-x-3 gap-y-1">
          {occurrence ? (
            <time dateTime={occurrence.start.local} className="text-copper-hi">
              {formatOccurrence(occurrence, lang, today)}
            </time>
          ) : null}
          <span className="text-fg-muted">{categoryName}</span>
        </p>

        <h3 className={styles.cardTitle}>
          <Link href={href} className={styles.cardLink}>
            {title}
          </Link>
        </h3>

        <p className="text-[0.9375rem] leading-[1.35] text-fg-soft">
          {event.venue.name}, {pick(event.venue.city_name, lang)}
        </p>

        <div className={styles.facts}>
          <PriceTag price={event.price_summary} className="text-[1.0625rem] leading-[1.2]" />
          <AgeBadge rating={event.age_rating} />
          {occurrence ? <StatusBadge occurrence={occurrence} size="sm" /> : null}
        </div>

        <p className="text-[0.8125rem] leading-[1.35] text-fg-muted">
          {event.source.name}. {t('event.checked', { ago: formatAgo(event.source.checked_at, new Date(now), lang) })}
        </p>
      </div>

      <div className={styles.why} data-ask-why="">
        <h4 className="t-caps mb-2.5 text-fg-soft">{t('ask.why')}</h4>
        <ul className="flex flex-col gap-1.5">
          {reasons.map((reason) => (
            <li key={reason} className={styles.reason} data-reason="">
              <Check size={16} weight="bold" aria-hidden="true" className={cn(styles.reasonIcon, 'text-copper-hi')} />
              <span>{reason}</span>
            </li>
          ))}
        </ul>

        {caveats.length > 0 ? (
          <>
            <h4 className="t-caps mt-4 mb-2.5 text-status-moved">{t('ask.caveats')}</h4>
            <ul className="flex flex-col gap-1.5">
              {caveats.map((caveat) => (
                <li key={caveat} className={styles.reason} data-caveat="">
                  <Warning
                    size={16}
                    weight="bold"
                    aria-hidden="true"
                    className={cn(styles.reasonIcon, 'text-status-moved')}
                  />
                  <span>{caveat}</span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </li>
  );
}

/** Заглушка карточки на время первого подбора: те же колонки и пропорции. */
export function ResultCardSkeleton() {
  return (
    <li className={styles.card} aria-hidden="true" data-ask-skeleton="">
      <Skeleton className={cn(styles.media, 'w-full')} />
      <div className={styles.cardBody}>
        <Skeleton className="h-3.5 w-2/5" />
        <Skeleton className="h-6 w-11/12" />
        <Skeleton className="h-4 w-3/5" />
        <div className={styles.facts}>
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-5 w-9" />
          <Skeleton className="h-5 w-24" />
        </div>
      </div>
      <div className={styles.why}>
        <Skeleton className="mb-3 h-3.5 w-2/5 bg-surface-2" />
        <div className="flex flex-col gap-2.5">
          <Skeleton className="h-4 w-11/12 bg-surface-2" />
          <Skeleton className="h-4 w-4/5 bg-surface-2" />
          <Skeleton className="h-4 w-3/5 bg-surface-2" />
        </div>
      </div>
    </li>
  );
}
