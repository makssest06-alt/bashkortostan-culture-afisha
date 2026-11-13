'use client';

/**
 * Заглушка страницы-документа на время загрузки (/developers, /about): повторяет форму страницы,
 * то есть заголовок, вводный текст, оглавление слева и разделы справа.
 */

import { PageShell } from '@/components/shell/PageShell';
import { Skeleton, SkeletonText } from '@/components/ui';
import { useT } from '@/lib/i18n';

import styles from './docs.module.css';

export function DocSkeleton() {
  const { t } = useT();
  return (
    <PageShell demoNotice={false}>
      <div role="status" aria-live="polite" data-doc-skeleton>
        <span className="visually-hidden">{t('common.loading')}</span>
        <Skeleton className="h-[clamp(40px,4.4vw,72px)] w-[min(560px,80%)]" />
        <SkeletonText lines={2} className="mt-6 max-w-[56ch]" />
        <div className={`${styles.layout} mt-16`}>
          <div className="hidden flex-col gap-4 lg:flex">
            {Array.from({ length: 7 }, (_, index) => (
              <Skeleton key={index} className="h-4 w-36" />
            ))}
          </div>
          <div className="flex flex-col gap-14">
            {Array.from({ length: 3 }, (_, index) => (
              <div key={index} className="flex flex-col gap-5">
                <Skeleton className="h-9 w-[min(420px,70%)]" />
                <SkeletonText lines={3} className="max-w-[68ch]" />
                <Skeleton className="h-28 w-full max-w-[920px] rounded-md" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </PageShell>
  );
}
