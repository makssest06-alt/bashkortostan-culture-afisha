'use client';

/**
 * Блок доверия: откуда взята запись, когда её сверяли с источником и из скольких источников она сведена.
 * «Проверено 2 часа назад» считается в браузере. Сервер и первый кадр показывают точную дату проверки,
 * поэтому разметка при гидратации совпадает, а относительное время подставляется следом.
 */

import { ArrowUpRight, Info } from '@phosphor-icons/react';
import Link from 'next/link';
import { useId, useSyncExternalStore } from 'react';

import { Button } from '@/components/ui';
import { ROUTES } from '@/content/links';
import { formatAgo } from '@/lib/api/format';
import type { AfishaEvent } from '@/lib/api/types';
import { cn } from '@/lib/cn';
import { useT } from '@/lib/i18n';

import { copy } from './copy';
import { Fact, FactList } from './Facts';
import { checkedAtAbsolute, isInternalHref } from './model';

const MINUTE_MS = 60_000;
const TICK_MS = 30_000;

const listeners = new Set<() => void>();
let ticker: number | null = null;

function subscribeMinute(listener: () => void): () => void {
  listeners.add(listener);
  if (ticker === null) {
    ticker = window.setInterval(() => {
      for (const notify of listeners) notify();
    }, TICK_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && ticker !== null) {
      window.clearInterval(ticker);
      ticker = null;
    }
  };
}

const currentMinute = (): number => Math.floor(Date.now() / MINUTE_MS);
const noMinute = (): null => null;

/** Текущая минута в браузере. На сервере и при гидратации null: время клиента ещё не известно. */
function useCurrentMinute(): number | null {
  return useSyncExternalStore(subscribeMinute, currentMinute, noMinute);
}

export type TrustBlockProps = {
  event: Pick<AfishaEvent, 'source' | 'synthetic'>;
  className?: string;
};

const TEXT_LINK =
  'rounded-xs underline decoration-line-strong decoration-1 underline-offset-[0.3em] ' +
  'transition-[text-decoration-color] duration-(--duration-fast) ease-out hover:decoration-fg';

export function TrustBlock({ event, className }: TrustBlockProps) {
  const { t, lang } = useT();
  const titleId = useId();
  const minute = useCurrentMinute();
  const { source } = event;

  const exact = checkedAtAbsolute(source.checked_at, lang);
  const ago = minute === null ? null : formatAgo(source.checked_at, new Date(minute * MINUTE_MS), lang);
  const sourceInternal = isInternalHref(source.url);
  const merged = source.sources_count > 1;

  return (
    <section className={className} aria-labelledby={titleId} data-trust="">
      <h2 id={titleId} className="t-caps mb-3 text-fg">
        {copy('trustTitle', lang)}
      </h2>

      <FactList>
        <Fact label={t('event.source')}>
          <span className="flex flex-wrap items-center gap-x-5">
            <span data-trust-source="">{source.name}</span>
            <Button
              variant="link"
              size="sm"
              href={source.url}
              external={!sourceInternal}
              className="-my-3"
              data-trust-link=""
            >
              {t('event.sourceLink')}
              {sourceInternal ? null : <ArrowUpRight size={14} weight="bold" aria-hidden="true" />}
            </Button>
          </span>
        </Fact>

        <Fact label={copy('checkedLabel', lang)}>
          <time dateTime={source.checked_at} data-trust-checked={ago === null ? 'exact' : 'relative'}>
            {ago === null ? copy('checkedAt', lang, { date: exact }) : t('event.checked', { ago })}
          </time>
          {ago === null ? null : <span className="text-fg-muted">, {exact}</span>}
        </Fact>

        <Fact label={copy('sourcesLabel', lang)}>
          <span data-trust-sources={source.sources_count}>
            {merged ? (
              <Link href={ROUTES.aboutDedup} className={cn(TEXT_LINK, '-my-3 inline-flex min-h-11 items-center')}>
                {t('event.sources', { count: source.sources_count })}
              </Link>
            ) : (
              copy('sourcesSingle', lang)
            )}
          </span>
        </Fact>
      </FactList>

      {event.synthetic ? (
        <p
          className="mt-4 flex max-w-[62ch] items-start gap-2.5 text-[0.875rem] leading-[1.5] text-fg-soft"
          data-trust-demo=""
        >
          <Info size={18} weight="bold" aria-hidden="true" className="mt-px shrink-0 text-fg-muted" />
          <span>
            {t('event.demoNote')}{' '}
            {/* Отрицательные поля держат строку абзаца прежней, а цель касания остаётся высотой 44px. */}
            <Link
              href={ROUTES.aboutDemo}
              className={cn(TEXT_LINK, '-my-3 inline-flex min-h-11 items-center whitespace-nowrap text-fg')}
            >
              {copy('aboutDemo', lang)}
            </Link>
          </span>
        </p>
      ) : null}
    </section>
  );
}
