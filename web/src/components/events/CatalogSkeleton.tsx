'use client';

/**
 * Каркас каталога на время перехода на страницу: заголовок настоящий,
 * колонка фильтров и сетка карточек повторяют форму будущего содержимого.
 */

import { Skeleton } from '@/components/ui';
import { useT } from '@/lib/i18n';

import { GridSkeleton } from './Results';

const RAIL_GROUPS = [3, 4, 8, 3, 6] as const;

export function CatalogSkeleton() {
  const { t } = useT();

  return (
    <div role="status" data-catalog-skeleton="">
      <header className="flex flex-col gap-4 pb-8 md:pb-10">
        <h1 className="t-heading">{t('events.title')}</h1>
        <p className="t-lead max-w-[52ch] text-fg-soft">{t('events.subtitle')}</p>
      </header>

      <div className="border-t border-line pt-8 lg:grid lg:grid-cols-[288px_minmax(0,1fr)] lg:gap-x-12 xl:gap-x-14">
        <div className="hidden flex-col lg:flex" aria-hidden="true">
          <Skeleton className="mb-5 h-11 w-full" />
          {RAIL_GROUPS.map((chips, group) => (
            <div key={group} className="flex flex-col gap-3 border-t border-line py-5">
              <Skeleton className="h-3.5 w-16" />
              <div className="flex flex-wrap gap-2">
                {Array.from({ length: chips }, (_, index) => (
                  <Skeleton key={index} className="h-9" style={{ width: `${72 + ((index * 37 + group * 19) % 56)}px` }} />
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="flex min-w-0 flex-col gap-8">
          <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
            <p className="t-subtitle">{t('events.loading')}</p>
            <Skeleton className="h-11 w-full sm:w-60" />
          </div>
          <GridSkeleton />
        </div>
      </div>
    </div>
  );
}
