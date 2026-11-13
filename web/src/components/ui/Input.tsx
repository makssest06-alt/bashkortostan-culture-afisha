'use client';

import type { ComponentProps } from 'react';

import { cn } from '@/lib/cn';

import { useFieldControl } from './Field';

export type InputProps = ComponentProps<'input'>;

export const CONTROL_CLASS =
  'min-h-11 w-full rounded-sm border border-line-strong bg-surface/70 px-3.5 text-[1rem] leading-[1.3] text-fg ' +
  'placeholder:text-fg-muted transition-[border-color,background-color] duration-(--duration-fast) ease-out ' +
  'hover:border-fg-muted focus-visible:border-fg aria-invalid:border-status-cancelled disabled:opacity-45';

/** Текстовое поле. Внутри <Field> само связывается с подписью, подсказкой и ошибкой. */
export function Input({ className, ...props }: InputProps) {
  const control = useFieldControl();
  return <input {...control} {...props} className={cn(CONTROL_CLASS, className)} />;
}
