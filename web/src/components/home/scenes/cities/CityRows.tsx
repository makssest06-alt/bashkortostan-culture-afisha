'use client';

import { ArrowUpRight } from '@phosphor-icons/react';
import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useRef } from 'react';

import { KuskarRing } from '@/components/ornament';
import { Skeleton } from '@/components/ui';
import { cn } from '@/lib/cn';
import { useT } from '@/lib/i18n';

import styles from './cities.module.css';
import type { CityEvent, CityRow } from './useCities';

/** Сетка строки на компьютере: текст слева, пустая середина под жетон, миниатюра 22,4 % ширины окна. */
export const ROW_GRID = 'md:grid-cols-[minmax(0,28%)_minmax(0,1fr)_22.4vw]';

function Thumb({ event, title }: { event: CityEvent | null | undefined; title: string }) {
  const { t } = useT();

  return (
    <span
      className={cn(
        styles.thumb,
        'relative col-start-1 row-span-2 row-start-2 block size-[52px] self-start overflow-hidden rounded-full bg-surface',
        'md:col-start-3 md:row-span-1 md:row-start-1 md:h-[calc(100%-1.6svh)] md:w-full md:self-center md:rounded-md',
      )}
    >
      {event === undefined ? <Skeleton className="absolute inset-0 rounded-none" /> : null}
      {event?.image ? (
        <Image
          src={event.image}
          alt={title}
          fill
          sizes="(min-width: 768px) 23vw, 52px"
          className="object-cover"
        />
      ) : null}
      {event !== undefined && !event?.image ? (
        <span className="absolute inset-0 flex items-center justify-center text-fg-muted">
          <KuskarRing size="72%" />
          <span className="visually-hidden">{t('events.card.noImage')}</span>
        </span>
      ) : null}
    </span>
  );
}

function Row({ row, hrefBase }: { row: CityRow; hrefBase: string }) {
  const { t, lang } = useT();
  const event = row.event;
  const title = event ? (lang === 'ba' && event.titleBa ? event.titleBa : event.title) : '';

  return (
    <li data-row={row.id} className={cn(styles.row, 'border-t border-dashed border-fg/40 last:border-b md:border-solid')}>
      <Link
        href={`${hrefBase}${row.id}`}
        className={cn(
          styles.link,
          'grid grid-cols-[52px_minmax(0,1fr)] gap-x-[22px] gap-y-2 py-5 md:h-[33.4svh] md:min-h-[236px] md:gap-0 md:py-0',
          ROW_GRID,
        )}
      >
        <span className="contents md:flex md:flex-col md:py-[2.5svh]">
          <span className={cn(styles.dim, 'col-span-2 flex min-h-5 items-center justify-between')}>
            {row.count === null ? (
              <Skeleton className="h-3 w-24" />
            ) : (
              <span data-num className={cn(styles.count, 't-caps')}>
                {t('events.count', { count: row.count })}
              </span>
            )}
            <ArrowUpRight size={16} weight="bold" aria-hidden="true" className="md:hidden" />
          </span>

          <span
            className={cn(
              styles.dim,
              'col-start-2 row-start-2 block text-[clamp(26px,7.47vw,34px)] leading-[1.04] font-semibold tracking-[-0.035em] md:mt-[1.6svh] md:text-[clamp(26px,3.1vw,64px)]',
            )}
          >
            {row.name[lang]}
          </span>

          {/* Высота подписи постоянная: строка не меняет рост, когда приходит ответ API */}
          <span className={cn(styles.dim, 't-caps col-start-2 row-start-3 block h-[3.1rem] overflow-hidden md:mt-auto')}>
            {event === undefined ? (
              <Skeleton className="h-3 w-40 max-w-full" />
            ) : event ? (
              <>
                <span className="block font-medium">{t('events.popular')}</span>
                <span className="mt-1 line-clamp-2 block">{title}</span>
              </>
            ) : null}
          </span>
        </span>

        <Thumb event={event} title={title} />
      </Link>
    </li>
  );
}

export type CityRowsProps = {
  rows: readonly CityRow[];
  /** Адрес каталога для города: `${hrefBase}${slug}`. */
  hrefBase: string;
};

/**
 * Строки-города: вся строка это ссылка в каталог с выбранным городом.
 * Активна строка, через которую проходит середина окна; до списка активна первая строка.
 */
export function CityRows({ rows, hrefBase }: CityRowsProps) {
  const list = useRef<HTMLOListElement>(null);
  const order = rows.map((row) => row.id).join(',');

  useEffect(() => {
    const node = list.current;
    if (!node) return;
    const items = Array.from(node.querySelectorAll<HTMLElement>('[data-row]'));
    if (items.length === 0) return;

    let active: HTMLElement | null = null;
    const activate = (item: HTMLElement) => {
      if (item === active) return;
      active?.removeAttribute('data-active');
      item.setAttribute('data-active', '');
      active = item;
    };
    activate(items[0]);

    // Корень наблюдателя сжат в линию по середине окна: пересекает её ровно одна строка.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) activate(entry.target as HTMLElement);
        }
      },
      { rootMargin: '-50% 0px -50% 0px', threshold: 0 },
    );
    for (const item of items) observer.observe(item);

    return () => {
      observer.disconnect();
      active?.removeAttribute('data-active');
    };
  }, [order]);

  return (
    <ol ref={list}>
      {rows.map((row) => (
        <Row key={row.id} row={row} hrefBase={hrefBase} />
      ))}
    </ol>
  );
}
