'use client';

/**
 * Активные условия чипами. У чипа два действия: нажатие на подпись открывает нужную группу
 * фильтров (условие можно поменять на месте), крестик снимает условие.
 */

import { X } from '@phosphor-icons/react';

import { Button } from '@/components/ui';
import type { EventsQuery } from '@/lib/api/types';
import { useT } from '@/lib/i18n';

import type { ActiveChip, FilterGroup } from './query';

export type ActiveFiltersProps = {
  chips: ActiveChip[];
  onEdit: (group: FilterGroup) => void;
  onRemove: (next: EventsQuery) => void;
  onReset: () => void;
};

const PART =
  'inline-flex min-h-9 items-center transition-[background-color,scale] duration-(--duration-press) ease-out ' +
  'hover:bg-hover active:scale-[0.97] pointer-coarse:min-h-11';

export function ActiveFilters({ chips, onEdit, onRemove, onReset }: ActiveFiltersProps) {
  const { t } = useT();
  if (chips.length === 0) return null;

  // На телефоне условия идут одной прокручиваемой строкой: девять чипов не отодвигают выдачу на экран вниз.
  // На компьютере строка переносится как обычно.
  return (
    <ul
      className="-mx-(--gutter) flex items-center gap-2 overflow-x-auto overscroll-x-contain px-(--gutter) py-1 [scrollbar-width:none] lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0 lg:py-0 [&::-webkit-scrollbar]:hidden"
      data-active-filters=""
    >
      {chips.map((chip) => (
        <li
          key={chip.id}
          data-chip={chip.id}
          className="inline-flex shrink-0 items-stretch rounded-sm border border-line-strong text-[0.9375rem] leading-[1.2] font-medium text-fg"
        >
          {chip.group ? (
            <button
              type="button"
              onClick={() => chip.group && onEdit(chip.group)}
              aria-label={t('ask.chipEdit', { label: chip.label })}
              className={`${PART} max-w-[60vw] truncate rounded-l-sm pr-1.5 pl-3 whitespace-nowrap`}
            >
              <span className="truncate">{chip.label}</span>
            </button>
          ) : (
            <span className="inline-flex min-h-9 items-center pr-1.5 pl-3 whitespace-nowrap pointer-coarse:min-h-11">
              {chip.label}
            </span>
          )}
          <button
            type="button"
            onClick={() => onRemove(chip.without)}
            aria-label={t('filters.remove', { label: chip.label })}
            className={`${PART} w-8 justify-center rounded-r-sm text-fg-soft hover:text-fg pointer-coarse:w-11`}
          >
            <X size={14} weight="bold" aria-hidden="true" />
          </button>
        </li>
      ))}
      <li className="ml-1 shrink-0">
        <Button variant="link" size="sm" onClick={onReset} data-reset-filters="">
          {t('filters.reset')}
        </Button>
      </li>
    </ul>
  );
}
