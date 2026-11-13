'use client';

import type { ComponentProps } from 'react';

import { cn } from '@/lib/cn';

import { useFieldControl } from './Field';
import { CONTROL_CLASS } from './Input';

export type TextareaProps = ComponentProps<'textarea'>;

/** Многострочное поле. Внутри <Field> само связывается с подписью, подсказкой и ошибкой. */
export function Textarea({ className, ...props }: TextareaProps) {
  const control = useFieldControl();
  return <textarea {...control} {...props} className={cn(CONTROL_CLASS, 'py-3 leading-[1.5]', className)} />;
}
