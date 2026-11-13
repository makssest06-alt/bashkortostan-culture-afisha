'use client';

/**
 * «Ещё в этом городе»: до четырёх ближайших событий того же города строками-ссылками.
 * Если других событий нет, блок честно говорит об этом и ведёт в общий каталог.
 */

import { ArrowRight } from '@phosphor-icons/react';
import Image from 'next/image';
import Link from 'next/link';
import { useId, useState } from 'react';
import type { CSSProperties } from 'react';

import { KuskarBorder, KuskarRing } from '@/components/ornament';
import { Button, PriceTag, StatusBadge } from '@/components/ui';
import { displayStatusOf, getCity } from '@/data/dictionaries';
import { formatOccurrence } from '@/lib/api/format';
import { eventsHref } from '@/lib/api/params';
import type { CityId } from '@/lib/api/types';
import { cn } from '@/lib/cn';
import { pick, useT } from '@/lib/i18n';

import { copy } from './copy';
import styles from './event.module.css';
import { eventPath } from './model';
import type { MoreItem } from './model';

type MoreRowProps = {
  item: MoreItem;
  today: string;
  order: number;
};

function MoreRow({ item, today, order }: MoreRowProps) {
  const { lang } = useT();
  const [failed, setFailed] = useState(false);
  const title = lang === 'ba' && item.title_ba ? item.title_ba : item.title;
  const { occurrence } = item;
  const status = occurrence ? displayStatusOf(occurrence) : null;

  return (
    <li className={styles.row} style={{ '--i': order } as CSSProperties} data-more-item={item.id}>
      <span className={styles.rowThumb}>
        {item.image && !failed ? (
          <Image
            src={item.image}
            alt=""
            fill
            sizes="72px"
            loading="lazy"
            className={styles.image}
            onError={() => setFailed(true)}
          />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center text-fg-muted">
            <KuskarRing size="70%" />
          </span>
        )}
      </span>

      {occurrence ? (
        <time dateTime={occurrence.start.local} className={cn(styles.rowWhen, 't-caps text-copper-hi')}>
          {formatOccurrence(occurrence, lang, today)}
        </time>
      ) : null}

      <div className={styles.rowMain}>
        <h3 className={styles.rowTitle}>
          <Link href={eventPath(item.id)} className={styles.rowLink}>
            {title}
          </Link>
        </h3>
        <p className="mt-1 text-[0.875rem] leading-[1.35] text-fg-muted max-md:hidden">{item.venue_name}</p>
      </div>

      <span className={cn(styles.rowFacts, 'flex flex-wrap items-center gap-x-3 gap-y-1.5 md:flex-col md:items-end')}>
        <PriceTag price={item.price_summary} className="text-[0.9375rem] leading-[1.2]" />
        {occurrence && status !== 'scheduled' ? <StatusBadge occurrence={occurrence} size="sm" /> : null}
      </span>

      <ArrowRight size={20} weight="bold" aria-hidden="true" className={styles.rowArrow} />
    </li>
  );
}

export type MoreInCityProps = {
  city: CityId;
  items: readonly MoreItem[];
  /** Сегодняшняя дата афиши: от неё считается «до 2 декабря» у выставок. */
  today: string;
  className?: string;
};

export function MoreInCity({ city, items, today, className }: MoreInCityProps) {
  const { t, lang } = useT();
  const titleId = useId();
  const entry = getCity(city);
  const where = entry ? pick(entry.name_in, lang) : '';
  const cityHref = eventsHref({ city: [city] });

  return (
    <section className={className} aria-labelledby={titleId} data-more-in-city={items.length}>
      <KuskarBorder variant="row" height={14} className="text-line-strong" />

      <div className="mt-10 mb-6 flex flex-wrap items-end justify-between gap-x-8 gap-y-3 md:mt-14 md:mb-8">
        <h2 id={titleId} className="t-subtitle">
          {copy('moreInCity', lang, { where })}
        </h2>
        {items.length > 0 ? (
          <Button variant="link" href={cityHref} data-more-all="">
            {copy('allInCity', lang, { where })}
            <ArrowRight size={16} weight="bold" aria-hidden="true" />
          </Button>
        ) : null}
      </div>

      {items.length > 0 ? (
        <ul className={styles.rows}>
          {items.map((item, index) => (
            <MoreRow key={item.id} item={item} today={today} order={index} />
          ))}
        </ul>
      ) : (
        <div className="flex flex-col items-start gap-4 border-t border-line pt-6" data-more-empty="">
          <p className="t-lead max-w-[44ch] text-fg-soft">{copy('moreInCityEmpty', lang, { where })}</p>
          <Button variant="ghost" href="/events">
            {t('event.backToCatalog')}
            <ArrowRight size={16} weight="bold" aria-hidden="true" />
          </Button>
        </div>
      )}
    </section>
  );
}
