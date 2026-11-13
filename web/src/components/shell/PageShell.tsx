import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

import { DemoDataNotice } from './DemoDataNotice';
import { GlowBackground } from './GlowBackground';
import { SiteFooter } from './SiteFooter';

export type PageShellProps = {
  /** Заголовок страницы (h1). Строка из словаря. */
  title?: ReactNode;
  /** Короткий вводный текст под заголовком. */
  lead?: ReactNode;
  /** Что стоит справа от заголовка: кнопка, переключатель. */
  actions?: ReactNode;
  children?: ReactNode;
  /** 'wide' контейнер 1400px (по умолчанию), 'text' узкая колонка для чтения. */
  width?: 'wide' | 'text';
  /** Пометка «Демо-данные» под заголовком. По умолчанию показывается. */
  demoNotice?: boolean;
  /** Подвал сайта. По умолчанию есть. */
  footer?: boolean;
  /** Яркость фонового свечения 0..1. */
  glow?: number;
  className?: string;
};

/**
 * Обёртка внутренней страницы: фон со свечением, отступ под шапку, контейнер до 1400px, подвал.
 * Левый край содержимого стоит на той же линии, что логотип в шапке (поле --gutter).
 * Без хуков: можно использовать и в серверном, и в клиентском компоненте.
 *
 *   <PageShell title={t('events.title')} lead={t('events.subtitle')}>...</PageShell>
 */
export function PageShell({
  title,
  lead,
  actions,
  children,
  width = 'wide',
  demoNotice = true,
  footer = true,
  glow = 0.55,
  className,
}: PageShellProps) {
  return (
    <>
      <GlowBackground intensity={glow} />
      <main
        id="content"
        className={cn(
          'relative z-(--z-content) mx-auto w-full px-(--gutter) pt-[calc(var(--header-h)+var(--space-2xl))] pb-24',
          width === 'text' ? 'max-w-[calc(760px+2*var(--gutter))]' : 'max-w-[calc(1400px+2*var(--gutter))]',
          className,
        )}
      >
        {title || lead || actions ? (
          <header className="mb-12 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div>
              {title ? <h1 className="t-heading max-w-[18ch]">{title}</h1> : null}
              {lead ? <p className="t-lead mt-5 max-w-[56ch] text-fg-soft">{lead}</p> : null}
              {demoNotice ? <DemoDataNotice className="mt-6" /> : null}
            </div>
            {actions ? <div className="shrink-0">{actions}</div> : null}
          </header>
        ) : demoNotice ? (
          <DemoDataNotice className="mb-8" />
        ) : null}
        {children}
      </main>
      {footer ? <SiteFooter /> : null}
    </>
  );
}
