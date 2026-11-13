'use client';

import { ArrowsClockwise, CheckCircle, ClockCountdown, Question, Ticket, XCircle } from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';

import { displayStatusOf } from '@/data/dictionaries';
import type { DisplayStatus, Occurrence } from '@/lib/api/types';
import { cn } from '@/lib/cn';
import { useT } from '@/lib/i18n';
import type { TKey } from '@/lib/i18n';

type StatusView = {
  labelKey: TKey;
  /** Цвет из семантических токенов статуса: не совпадает с декоративным акцентом. */
  color: string;
  icon: Icon;
};

const VIEWS: Record<DisplayStatus, StatusView> = {
  scheduled: { labelKey: 'status.scheduled', color: 'text-status-ok', icon: CheckCircle },
  cancelled: { labelKey: 'status.cancelled', color: 'text-status-cancelled', icon: XCircle },
  postponed: { labelKey: 'status.postponed', color: 'text-status-moved', icon: ClockCountdown },
  rescheduled: { labelKey: 'status.rescheduled', color: 'text-status-moved', icon: ArrowsClockwise },
  sold_out: { labelKey: 'status.soldOut', color: 'text-status-soldout', icon: Ticket },
  unverified: { labelKey: 'status.unverified', color: 'text-status-unverified', icon: Question },
};

export type StatusBadgeProps = {
  /** Готовое значение для плашки. 'unknown' из статуса сеанса показывается как «не подтверждён». */
  status?: DisplayStatus | 'unknown';
  /** Либо сеанс целиком: статус, подтверждение и наличие билетов сведутся в одно значение. */
  occurrence?: Pick<Occurrence, 'status' | 'status_is_verified' | 'availability'>;
  size?: 'sm' | 'md';
  className?: string;
};

/**
 * Статус сеанса: состоится, отменён, перенесён, билеты кончились, не подтверждён.
 * Цвет никогда не единственный признак: рядом всегда значок и подпись из словаря.
 *
 *   <StatusBadge occurrence={occurrence} />
 *   <StatusBadge status="cancelled" size="sm" />
 */
export function StatusBadge({ status, occurrence, size = 'md', className }: StatusBadgeProps) {
  const { t } = useT();
  const resolved: DisplayStatus = occurrence
    ? displayStatusOf(occurrence)
    : !status || status === 'unknown'
      ? 'unverified'
      : status;
  const view = VIEWS[resolved];
  const StatusIcon = view.icon;

  return (
    <span
      data-status={resolved}
      className={cn(
        't-caps inline-flex items-center gap-1.5 rounded-sm border border-current/45 bg-current/10',
        size === 'sm' ? 'px-1.5 py-0.5' : 'px-2 py-1',
        resolved === 'unverified' && 'border-dashed',
        view.color,
        className,
      )}
    >
      <StatusIcon size={size === 'sm' ? 12 : 14} weight="bold" aria-hidden="true" className="shrink-0" />
      {t(view.labelKey)}
    </span>
  );
}
