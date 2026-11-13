'use client';

import { X } from '@phosphor-icons/react';
import Link from 'next/link';
import type { MouseEventHandler, ReactNode } from 'react';

import { cn } from '@/lib/cn';
import { useT } from '@/lib/i18n';

export type ChipProps = {
  children: ReactNode;
  /** Выбранный чип: заливка. Вместе с onClick работает как переключатель (aria-pressed). */
  selected?: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  /** Чип-ссылка: быстрые подборки («На выходные» ведёт в каталог с фильтром). */
  href?: string;
  /** Удаляемый чип: справа появляется крестик. */
  onRemove?: () => void;
  /** Подпись крестика для чтения с экрана. По умолчанию «Убрать фильтр: {текст чипа}». */
  removeLabel?: string;
  disabled?: boolean;
  className?: string;
};

const BASE =
  'inline-flex min-h-9 items-center gap-1.5 rounded-sm border px-3 text-[0.9375rem] leading-[1.2] font-medium whitespace-nowrap ' +
  'transition-[scale,background-color,color,border-color] duration-(--duration-press) ease-out pointer-coarse:min-h-11';
const IDLE = 'border-line-strong text-fg-soft';
const INTERACTIVE = 'hover:bg-hover hover:text-fg active:scale-[0.97]';
const SELECTED = 'border-fg bg-fg text-bg';

/**
 * Чип: обычный, выбранный или удаляемый.
 *
 *   <Chip onClick={toggle} selected={on}>{t('filters.date.weekend')}</Chip>
 *   <Chip href="/events?date=weekend">{t('filters.date.weekend')}</Chip>
 *   <Chip onRemove={clear}>Уфа</Chip>
 */
export function Chip({ children, selected, onClick, href, onRemove, removeLabel, disabled, className }: ChipProps) {
  const { t } = useT();

  if (onRemove) {
    const label = removeLabel ?? t('filters.remove', { label: typeof children === 'string' ? children : '' });
    return (
      <span className={cn(BASE, selected ? SELECTED : IDLE, 'pr-1 pointer-coarse:pr-0', className)}>
        <span>{children}</span>
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          aria-label={label.trim()}
          className="inline-flex size-7 items-center justify-center rounded-xs transition-[scale,background-color] duration-(--duration-press) ease-out hover:bg-hover active:scale-[0.92] pointer-coarse:size-11"
        >
          <X size={14} weight="bold" aria-hidden="true" />
        </button>
      </span>
    );
  }

  if (href) {
    return (
      <Link href={href} className={cn(BASE, selected ? SELECTED : [IDLE, INTERACTIVE], className)}>
        {children}
      </Link>
    );
  }

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-pressed={selected === undefined ? undefined : selected}
        className={cn(BASE, selected ? SELECTED : [IDLE, INTERACTIVE], 'disabled:opacity-45', className)}
      >
        {children}
      </button>
    );
  }

  return <span className={cn(BASE, selected ? SELECTED : IDLE, className)}>{children}</span>;
}
