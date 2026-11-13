'use client';

import { CaretDown } from '@phosphor-icons/react';
import type { ComponentProps } from 'react';

import { cn } from '@/lib/cn';

import { useFieldControl } from './Field';
import { CONTROL_CLASS } from './Input';

export type SelectProps = ComponentProps<'select'> & {
  /** Классы обёртки (ширина, отступы). className уходит самому select. */
  wrapperClassName?: string;
};

/** Выпадающий список на системном select: на телефоне открывает родной выбор. */
export function Select({ className, wrapperClassName, children, ...props }: SelectProps) {
  const control = useFieldControl();
  return (
    <span className={cn('relative block', wrapperClassName)}>
      <select {...control} {...props} className={cn(CONTROL_CLASS, 'appearance-none pr-10', className)}>
        {children}
      </select>
      <CaretDown
        size={16}
        weight="bold"
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-fg-soft"
      />
    </span>
  );
}
