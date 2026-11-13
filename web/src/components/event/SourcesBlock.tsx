'use client';

/**
 * Блок «Источники» (п. 6.3): все источники, из которых сведена карточка после дедупликации.
 * У каждого: подпись, вид источника, когда проверен и ссылка. По ним можно сверить каждый факт карточки.
 */

import { ArrowUpRight } from '@phosphor-icons/react';
import Link from 'next/link';
import { useId } from 'react';

import { ROUTES } from '@/content/links';
import type { EventSource } from '@/lib/api/types';
import { useT } from '@/lib/i18n';

import { copy } from './copy';
import { checkedAtAbsolute, isInternalHref } from './model';

const LINK =
  'break-all rounded-xs underline decoration-line-strong decoration-1 underline-offset-[0.3em] ' +
  'transition-[text-decoration-color] duration-(--duration-fast) ease-out hover:decoration-fg';

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function SourcesBlock({ sources, className }: { sources: readonly EventSource[]; className?: string }) {
  const { lang } = useT();
  const titleId = useId();
  if (sources.length === 0) return null;

  return (
    <section id="sources" className={className} aria-labelledby={titleId} data-sources={sources.length}>
      <h2 id={titleId} className="t-caps mb-3 text-fg">
        {copy('sourcesTitle', lang)}
      </h2>
      <p className="mb-4 max-w-[62ch] text-[0.9375rem] leading-[1.5] text-fg-soft">
        {sources.length > 1 ? copy('sourcesMerged', lang, { count: String(sources.length) }) : copy('sourcesOne', lang)}{' '}
        {sources.length > 1 ? (
          <Link href={ROUTES.aboutDedup} className={`${LINK} whitespace-nowrap text-fg`}>
            {copy('sourcesHow', lang)}
          </Link>
        ) : null}
      </p>
      <ol className="flex flex-col divide-y divide-line border-y border-line">
        {sources.map((source, index) => {
          const internal = isInternalHref(source.source_url);
          const label = source.title ?? hostOf(source.source_url);
          return (
            <li key={source.source_hash} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-baseline sm:gap-4" data-source-type={source.source_type}>
              <span className="w-6 shrink-0 text-[0.875rem] text-fg-muted tabular-nums" aria-hidden="true">
                {index + 1}.
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-fg">{label}</span>
                <span className="text-[0.875rem] text-fg-soft">
                  {copy(`sourceType_${source.source_type}` as Parameters<typeof copy>[0], lang)}
                  {source.verified_at ? ` · ${copy('sourceChecked', lang, { date: checkedAtAbsolute(source.verified_at, lang) })}` : ''}
                </span>
              </span>
              {internal ? (
                <Link href={source.source_url} className={`${LINK} text-[0.9375rem] sm:shrink-0`}>
                  {source.source_url.startsWith('/about#demo') ? copy('aboutDemo', lang) : source.source_url}
                </Link>
              ) : (
                <a href={source.source_url} target="_blank" rel="noopener noreferrer" className={`${LINK} inline-flex items-center gap-1 text-[0.9375rem] sm:shrink-0`}>
                  {hostOf(source.source_url)}
                  <ArrowUpRight size={14} weight="bold" aria-hidden="true" />
                  <span className="visually-hidden">({copy('newTab', lang)})</span>
                </a>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
