'use client';

import { formatNumber } from '@/lib/api/format';
import type { PriceSummary } from '@/lib/api/types';
import { cn } from '@/lib/cn';
import { useT } from '@/lib/i18n';

export type PriceTagProps = {
  price: PriceSummary;
  className?: string;
};

/**
 * Цена на карточке. Три разных состояния, которые нельзя путать:
 * «Бесплатно», «от N ₽» и «Цена не указана» (неизвестная цена не значит бесплатно).
 */
export function PriceTag({ price, className }: PriceTagProps) {
  const { t } = useT();

  if (price.kind === 'free') {
    return (
      <span data-price="free" className={cn('font-semibold text-status-ok', className)}>
        {t('price.free')}
      </span>
    );
  }

  if (price.kind === 'unknown') {
    return (
      <span
        data-price="unknown"
        title={t('price.unknownHint')}
        className={cn(
          'text-fg-muted underline decoration-current/50 decoration-dotted underline-offset-[0.3em]',
          className,
        )}
      >
        {t('price.unknown')}
      </span>
    );
  }

  return (
    <span data-price="from" data-num className={cn('font-semibold whitespace-nowrap text-fg', className)}>
      {t('price.from', { amount: formatNumber((price.amount_minor ?? 0) / 100) })}
    </span>
  );
}
