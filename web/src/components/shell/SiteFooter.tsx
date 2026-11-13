'use client';

/** Подвал внутренних страниц. На главной свой подвал: сцена footer. */

import { ArrowUp, ArrowUpRight } from '@phosphor-icons/react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { ROUTES, TELEGRAM_BOT_URL } from '@/content/links';
import { IS_DEMO_DATA } from '@/lib/env';
import { useT } from '@/lib/i18n';

import { LangSwitch } from './LangSwitch';
import { NAV_ITEMS } from './nav';
import { scrollToTarget } from './scroll';
import { Wordmark } from './Wordmark';

function FooterGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h2 className="t-caps text-fg-muted">{title}</h2>
      <ul className="mt-3 flex flex-col">{children}</ul>
    </div>
  );
}

const linkClass =
  't-ui inline-flex min-h-11 items-center gap-1.5 text-fg-soft transition-colors duration-(--duration-fast) hover:text-fg';

export function SiteFooter() {
  const { t } = useT();

  return (
    <footer className="relative z-(--z-content) mt-24 border-t border-line">
      <div className="mx-auto grid w-full max-w-[calc(1400px+2*var(--gutter))] gap-x-8 gap-y-12 px-(--gutter) pt-16 pb-12 sm:grid-cols-2 lg:grid-cols-[1.5fr_1fr_1fr_1fr]">
        <div>
          <Link href={ROUTES.home} aria-label={t('common.brandFull')} className="inline-block">
            <Wordmark>{t('footer.wordmark')}</Wordmark>
          </Link>
          <p className="t-lead mt-4 max-w-[22ch] text-fg-soft">{t('footer.tagline')}</p>
        </div>

        <FooterGroup title={t('footer.sections')}>
          {NAV_ITEMS.map((item) => (
            <li key={item.href}>
              <Link href={item.href} className={linkClass}>
                {t(item.labelKey)}
              </Link>
            </li>
          ))}
        </FooterGroup>

        <FooterGroup title={t('footer.developers')}>
          <li>
            <Link href={ROUTES.apiDocs} className={linkClass}>
              {t('footer.api')}
            </Link>
          </li>
          <li>
            <Link href={ROUTES.widget} className={linkClass}>
              {t('footer.widget')}
            </Link>
          </li>
          <li>
            <Link href={ROUTES.aboutVerify} className={linkClass}>
              {t('footer.about')}
            </Link>
          </li>
        </FooterGroup>

        <div className="flex flex-col gap-8">
          <FooterGroup title={t('footer.channels')}>
            <li>
              <a href={TELEGRAM_BOT_URL} target="_blank" rel="noopener noreferrer" className={linkClass}>
                {t('footer.telegram')}
                <ArrowUpRight size={14} weight="bold" aria-hidden="true" />
              </a>
            </li>
          </FooterGroup>
          <div>
            <h2 className="t-caps text-fg-muted">{t('footer.language')}</h2>
            <LangSwitch size="large" className="mt-3" />
          </div>
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-[calc(1400px+2*var(--gutter))] flex-col gap-3 border-t border-line px-(--gutter) py-6 md:flex-row md:items-center md:justify-between">
        <p className="t-ui max-w-[70ch] text-fg-muted">
          {IS_DEMO_DATA ? (
            <>
              <Link href={ROUTES.aboutDemo} className="underline underline-offset-4 hover:text-fg">
                {t('footer.demoNote')}
              </Link>{' '}
            </>
          ) : null}
          {t('footer.madeFor')}
        </p>
        <button type="button" onClick={() => scrollToTarget(0)} className={linkClass}>
          {t('footer.top')}
          <ArrowUp size={14} weight="bold" aria-hidden="true" />
        </button>
      </div>
    </footer>
  );
}
