'use client';

/**
 * «Ещё N событий без указанной цены: в фильтр по цене они не попали».
 * Неизвестное не считается подходящим, но и не теряется молча: по кнопке такие события
 * показываются отдельным списком под выдачей.
 */

import { Info } from '@phosphor-icons/react';

import { Button } from '@/components/ui';
import { useT } from '@/lib/i18n';

import type { UnknownKind, UnknownList } from './store';

export type HiddenNoticeProps = {
  kind: UnknownKind;
  count: number;
  /** Состояние списка скрытых событий: нет значения, пока его не просили показать. */
  list: UnknownList | undefined;
  onShow: () => void;
  onHide: () => void;
};

export function HiddenNotice({ kind, count, list, onShow, onHide }: HiddenNoticeProps) {
  const { t } = useT();
  if (count <= 0) return null;

  const shown = Boolean(list);
  const text =
    kind === 'price' ? t('events.hiddenUnknownPrice', { count }) : t('events.hiddenUnknownAge', { count });

  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.9375rem] leading-[1.4] text-fg-soft"
      data-hidden-notice={kind}
    >
      <p className="flex min-w-0 items-start gap-2">
        <Info size={18} weight="bold" aria-hidden="true" className="mt-0.5 shrink-0 text-status-unverified" />
        <span>{text}</span>
      </p>
      <Button
        variant="link"
        size="sm"
        aria-expanded={shown}
        onClick={shown ? onHide : onShow}
        data-hidden-toggle={kind}
      >
        {t(shown ? 'events.hidden.hide' : 'events.hidden.show')}
      </Button>
    </div>
  );
}
