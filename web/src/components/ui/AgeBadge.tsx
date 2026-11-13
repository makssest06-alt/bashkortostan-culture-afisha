'use client';

import type { AgeRating } from '@/lib/api/types';
import { cn } from '@/lib/cn';
import { useT } from '@/lib/i18n';
import type { TKey } from '@/lib/i18n';

const LABEL_KEYS: Record<AgeRating, TKey> = {
  '0+': 'age.0',
  '6+': 'age.6',
  '12+': 'age.12',
  '16+': 'age.16',
  '18+': 'age.18',
};

export type AgeBadgeProps = {
  /** null: источник не сообщил возрастное ограничение. Это не то же самое, что 0+. */
  rating: AgeRating | null;
  className?: string;
};

/** Возрастная метка: «6+» в рамке или «Возраст не указан». */
export function AgeBadge({ rating, className }: AgeBadgeProps) {
  const { t } = useT();

  if (!rating) {
    return (
      <span data-age="unknown" title={t('age.unknownHint')} className={cn('t-caps text-fg-muted', className)}>
        {t('age.unknown')}
      </span>
    );
  }

  const label = t(LABEL_KEYS[rating]);
  return (
    <span
      data-age={rating}
      data-num
      title={label}
      aria-label={label}
      className={cn(
        't-caps inline-flex h-6 min-w-9 items-center justify-center rounded-xs border border-line-strong px-1.5 text-fg-soft',
        className,
      )}
    >
      {rating}
    </span>
  );
}
