'use client';

import styles from '@/components/ask/ask.module.css';
import { ASK_GLOW } from '@/components/ask/constants';
import { PageShell } from '@/components/shell/PageShell';
import { Skeleton } from '@/components/ui/Skeleton';
import { useT } from '@/lib/i18n';

/**
 * Заглушка на время перехода на /ask: заголовок слева, строки примеров справа.
 * Форма повторяет начальный экран, поэтому при появлении страницы ничего не прыгает.
 */
export default function AskLoading() {
  const { t } = useT();

  return (
    <div className={styles.page}>
      <PageShell demoNotice={false} glow={ASK_GLOW} className={styles.main}>
        <div className={styles.root} aria-busy="true">
          <div className={styles.dialog}>
            <div className={styles.head}>
              <p className="visually-hidden" role="status">
                {t('common.loading')}
              </p>
              <Skeleton className="h-[clamp(32px,8.4vw,56px)] w-3/5 lg:h-16" />
              <Skeleton className="mt-6 h-5 w-full max-w-[34ch]" />
              <Skeleton className="mt-2.5 h-5 w-4/5 max-w-[28ch]" />
            </div>
          </div>
          <div className={styles.workspace}>
            <div className={styles.results} aria-hidden="true">
              <Skeleton className="h-3.5 w-32" />
              <div className="mt-6 flex flex-col gap-3">
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
              </div>
            </div>
          </div>
        </div>
      </PageShell>
    </div>
  );
}
