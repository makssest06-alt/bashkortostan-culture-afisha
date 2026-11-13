'use client';

import { ArrowRight, Info } from '@phosphor-icons/react';
import Link from 'next/link';

import { ROUTES } from '@/content/links';
import { cn } from '@/lib/cn';
import { IS_DEMO_DATA } from '@/lib/env';
import { useT } from '@/lib/i18n';

export type DemoDataNoticeProps = {
  /** Только подпись «Демо-данные» без пояснения: для тесных мест (виджет, карточка). */
  compact?: boolean;
  className?: string;
};

/**
 * Пометка «Демо-данные» со ссылкой на объяснение (/about#demo).
 * Показывается, пока NEXT_PUBLIC_DATA_MODE не равен live. В боевом режиме ничего не рендерит.
 */
export function DemoDataNotice({ compact = false, className }: DemoDataNoticeProps) {
  const { t } = useT();
  if (!IS_DEMO_DATA) return null;

  return (
    <Link href={ROUTES.aboutDemo} className={cn('demo-notice', className)} data-compact={compact ? '' : undefined}>
      <Info size={18} weight="bold" aria-hidden="true" className="shrink-0" />
      <span className="demo-notice__text">
        <span className="t-caps">{t('common.demoData')}</span>
        {compact ? null : <span className="demo-notice__hint">{t('common.demoDataHint')}</span>}
      </span>
      <ArrowRight size={14} weight="bold" aria-hidden="true" className="shrink-0" />
    </Link>
  );
}
