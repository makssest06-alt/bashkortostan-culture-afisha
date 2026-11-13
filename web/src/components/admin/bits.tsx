'use client';

/** Мелкие общие части админки: плашка статуса, сообщение, пустое состояние, переключатель страниц. */

import type { ReactNode } from 'react';

import type { EventStatus } from '@/lib/api/types';
import { cn } from '@/lib/cn';

import { STATUS_LABEL, STATUS_TONE } from './format';

export function StatusPill({ status, className }: { status: EventStatus; className?: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-xs border px-2 py-0.5 text-[0.8125rem] font-medium whitespace-nowrap', STATUS_TONE[status], className)}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function DisputedPill() {
  return (
    <span className="inline-flex items-center rounded-xs border border-status-moved/60 px-2 py-0.5 text-[0.8125rem] font-medium whitespace-nowrap text-status-moved">
      Спорная
    </span>
  );
}

/** Сообщение о результате действия. Объявляется программам чтения с экрана. */
export function Notice({ tone, children }: { tone: 'ok' | 'error' | 'info'; children: ReactNode }) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'rounded-sm border px-4 py-3 text-[0.9375rem] leading-[1.45]',
        tone === 'ok' && 'border-status-ok/50 bg-status-ok/10 text-fg',
        tone === 'error' && 'border-status-cancelled/60 bg-status-cancelled/10 text-fg',
        tone === 'info' && 'border-line-strong bg-surface/60 text-fg-soft',
      )}
    >
      {children}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-sm border border-dashed border-line-strong px-6 py-10 text-center">
      <p className="t-ui text-fg">{title}</p>
      {children ? <div className="mt-2 text-[0.9375rem] text-fg-soft">{children}</div> : null}
    </div>
  );
}

export function Pager({ page, totalPages, onPage }: { page: number; totalPages: number; onPage: (page: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <nav aria-label="Страницы" className="mt-6 flex items-center gap-3">
      <button
        type="button"
        className="min-h-11 rounded-sm border border-line-strong px-4 text-[0.9375rem] hover:bg-hover disabled:opacity-45"
        onClick={() => onPage(page - 1)}
        disabled={page <= 1}
      >
        Назад
      </button>
      <span className="text-[0.9375rem] text-fg-soft" aria-live="polite">
        Страница {page} из {totalPages}
      </span>
      <button
        type="button"
        className="min-h-11 rounded-sm border border-line-strong px-4 text-[0.9375rem] hover:bg-hover disabled:opacity-45"
        onClick={() => onPage(page + 1)}
        disabled={page >= totalPages}
      >
        Дальше
      </button>
    </nav>
  );
}

/** Строки-скелеты на время загрузки таблицы. */
export function LoadingRows({ rows = 5 }: { rows?: number }) {
  return (
    <div aria-busy="true" className="flex flex-col gap-3">
      <span className="visually-hidden">Загрузка</span>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="h-14 animate-pulse rounded-sm bg-surface/70 motion-reduce:animate-none" />
      ))}
    </div>
  );
}
