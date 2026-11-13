'use client';

import { createContext, useContext, useId } from 'react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

type FieldControl = {
  id: string;
  describedBy?: string;
  invalid: boolean;
};

const FieldContext = createContext<FieldControl | null>(null);

/** Атрибуты для поля ввода внутри <Field>: id, связь с подсказкой и ошибкой. Вне Field вернёт пустой объект. */
export function useFieldControl(): { id?: string; 'aria-describedby'?: string; 'aria-invalid'?: true } {
  const field = useContext(FieldContext);
  if (!field) return {};
  return {
    id: field.id,
    'aria-describedby': field.describedBy,
    'aria-invalid': field.invalid ? true : undefined,
  };
}

export type FieldProps = {
  /** Подпись над полем. Плейсхолдер подпись не заменяет. */
  label: ReactNode;
  /** Подсказка под полем. */
  hint?: ReactNode;
  /** Текст ошибки под полем. Пока он есть, поле помечено как неверное. */
  error?: ReactNode;
  /** Подпись остаётся для чтения с экрана, но не видна (когда смысл поля ясен из окружения). */
  hideLabel?: boolean;
  children: ReactNode;
  className?: string;
};

/**
 * Поле формы: подпись сверху, элемент ввода, подсказка и ошибка снизу.
 * Input и Select внутри сами получают id и aria-атрибуты.
 *
 *   <Field label={t('filters.city')} hint="..." error={error}>
 *     <Select>...</Select>
 *   </Field>
 */
export function Field({ label, hint, error, hideLabel = false, children, className }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <label htmlFor={id} className={cn('t-ui text-fg', hideLabel && 'visually-hidden')}>
        {label}
      </label>
      <FieldContext value={{ id, describedBy, invalid: Boolean(error) }}>{children}</FieldContext>
      {hint ? (
        <p id={hintId} className="text-[0.875rem] leading-[1.4] text-fg-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-[0.875rem] leading-[1.4] font-medium text-status-cancelled">
          {error}
        </p>
      ) : null}
    </div>
  );
}
