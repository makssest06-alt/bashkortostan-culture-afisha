'use client';

/**
 * Место кнопки «Купить билет». Кнопка появляется, только когда есть ссылка и сеанс, на который
 * можно идти. Иначе на её месте честная подпись: билеты кончились, сеанс отменён, вход свободный
 * или «ссылка на билеты не указана» со ссылкой на первоисточник.
 */

import { ArrowUpRight, CalendarX, ClockCountdown, DoorOpen, LinkBreak, Ticket, XCircle } from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';

import { Button } from '@/components/ui';
import type { AfishaEvent } from '@/lib/api/types';
import { cn } from '@/lib/cn';
import { useT } from '@/lib/i18n';
import type { TKey } from '@/lib/i18n';

import { buyStateOf, isInternalHref } from './model';
import type { BuyState } from './model';

type Notice = { labelKey: TKey; color: string; icon: Icon };

const NOTICES: Record<Exclude<BuyState['kind'], 'buy'>, Notice> = {
  sold_out: { labelKey: 'event.buy.soldOut', color: 'text-status-soldout', icon: Ticket },
  cancelled: { labelKey: 'event.buy.cancelled', color: 'text-status-cancelled', icon: XCircle },
  postponed: { labelKey: 'status.postponed', color: 'text-status-moved', icon: ClockCountdown },
  free: { labelKey: 'event.buy.free', color: 'text-status-ok', icon: DoorOpen },
  no_link: { labelKey: 'event.buy.noLink', color: 'text-fg-soft', icon: LinkBreak },
  no_sessions: { labelKey: 'event.sessions.none', color: 'text-fg-soft', icon: CalendarX },
};

export type BuyActionProps = {
  event: Pick<AfishaEvent, 'occurrences' | 'ticket_url' | 'price_summary' | 'source' | 'synthetic'>;
  /** panel: правая колонка на десктопе. bar: нижняя полоса на телефоне, без пояснений. */
  variant: 'panel' | 'bar';
  className?: string;
};

export function BuyAction({ event, variant, className }: BuyActionProps) {
  const { t } = useT();
  const state = buyStateOf(event);
  const compact = variant === 'bar';

  if (state.kind === 'buy') {
    const internal = isInternalHref(state.url);
    return (
      <div className={cn('flex flex-col gap-2', className)} data-buy="buy">
        <Button href={state.url} external={!internal} size={compact ? 'md' : 'lg'} fullWidth={!compact}>
          {t('event.buy')}
          {internal ? null : <ArrowUpRight size={18} weight="bold" aria-hidden="true" />}
        </Button>
        {compact ? null : (
          <p className="text-[0.8125rem] leading-[1.45] text-fg-muted">
            {internal && event.synthetic ? t('common.demoDataHint') : t('event.buy.external')}
          </p>
        )}
      </div>
    );
  }

  // В правой колонке о том, что сеансов нет, уже сказал список сеансов прямо над ценой.
  if (state.kind === 'no_sessions' && !compact) return null;

  const notice = NOTICES[state.kind];
  const NoticeIcon = notice.icon;
  const sourceInternal = isInternalHref(event.source.url);

  return (
    <div className={cn('flex flex-col gap-2', compact && 'items-end', className)} data-buy={state.kind}>
      <p
        className={cn(
          'flex items-center gap-2 font-medium',
          compact
            ? 'max-w-[20ch] justify-end text-right text-[0.875rem] leading-[1.25]'
            : 'min-h-13 rounded-sm border border-line-strong px-4 py-3 text-[1rem] leading-[1.3]',
          notice.color,
        )}
      >
        <NoticeIcon size={compact ? 18 : 20} weight="bold" aria-hidden="true" className="shrink-0" />
        {t(notice.labelKey)}
      </p>
      {state.kind === 'no_link' && !compact ? (
        <Button variant="link" size="sm" href={event.source.url} external={!sourceInternal} className="self-start">
          {t('event.sourceLink')}
          {sourceInternal ? null : <ArrowUpRight size={16} weight="bold" aria-hidden="true" />}
        </Button>
      ) : null}
    </div>
  );
}
