'use client';

/**
 * Оболочка сайта вокруг страниц: плавная прокрутка, шапка, полоса прогресса, зерно, ссылка к содержанию.
 * Для /embed (страница внутри чужого iframe) оболочка не рендерится: только сама страница.
 */

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { useT } from '@/lib/i18n';

import { PerfHud } from './PerfHud';
import { Header } from './Header';
import { ScrollProgress } from './ScrollProgress';
import { SmoothScroll } from './SmoothScroll';

/** Адреса без оболочки сайта. */
const BARE_PREFIXES = ['/embed'];

export function isBareRoute(pathname: string): boolean {
  return BARE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function SiteChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { t } = useT();

  if (isBareRoute(pathname)) return <>{children}</>;

  return (
    <>
      <a href="#content" className="skip-link t-ui">
        {t('nav.skipToContent')}
      </a>
      <SmoothScroll />
      <Header />
      <ScrollProgress />
      {children}
      <div className="grain" aria-hidden="true" />
      <PerfHud />
    </>
  );
}
