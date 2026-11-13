'use client';

/**
 * Каркас страницы события на время загрузки: та же сетка, что у настоящей страницы,
 * плашки повторяют заголовок, картинку 3:4, список сеансов и цену.
 */

import { Skeleton, SkeletonText } from '@/components/ui';
import { cn } from '@/lib/cn';
import { useT } from '@/lib/i18n';

import styles from './event.module.css';

export function EventSkeleton() {
  const { t } = useT();

  return (
    <div className={styles.page} role="status" data-event-skeleton="">
      <span className="visually-hidden">{t('common.loading')}</span>

      <div className="mb-5 flex min-h-11 items-center md:mb-8" aria-hidden="true">
        <Skeleton className="h-3.5 w-32" />
      </div>

      <div className={styles.layout} aria-hidden="true">
        <div className={styles.head}>
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="mt-4 h-10 w-11/12 max-w-170 md:h-16" />
          <Skeleton className="mt-3 h-10 w-3/5 max-w-110 md:h-16" />
          <Skeleton className="mt-6 h-5 w-52" />
          <Skeleton className="mt-2 h-5 w-72 max-w-full" />
        </div>

        <div className={styles.media}>
          <Skeleton className={cn(styles.frame, 'w-full')} />
        </div>

        <div className={styles.aside}>
          <div className={cn(styles.asideInner, 'flex flex-col gap-8')}>
            <div className="flex flex-col gap-4">
              <Skeleton className="h-3.5 w-20" />
              {[0, 1, 2].map((row) => (
                <div key={row} className="flex items-start justify-between gap-4 border-t border-line pt-4 first:border-t-0">
                  <div className="flex flex-col gap-2">
                    <Skeleton className="h-3.5 w-28" />
                    <Skeleton className="h-7 w-20" />
                  </div>
                  <Skeleton className="h-6 w-24" />
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-3">
              <Skeleton className="h-3.5 w-16" />
              <Skeleton className="h-8 w-32" />
            </div>
            <div className="flex flex-col gap-3">
              <Skeleton className={cn(styles.panelOnly, 'h-13 w-full')} />
              <Skeleton className="h-11 w-full" />
            </div>
          </div>
        </div>

        <div className={styles.desc}>
          <SkeletonText lines={5} className="max-w-[62ch]" />
        </div>

        <div className={styles.venue}>
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="mt-4 h-8 w-4/5 max-w-110" />
          <Skeleton className="mt-4 h-5 w-64 max-w-full" />
        </div>
      </div>
    </div>
  );
}
