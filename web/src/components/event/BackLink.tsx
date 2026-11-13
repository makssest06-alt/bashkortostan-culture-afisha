'use client';

/**
 * Ссылка назад в каталог. Если пользователь пришёл из каталога, она возвращает в ту же выдачу:
 * с теми же фильтрами, догруженными страницами и местом прокрутки (шаг назад по истории).
 *
 * Откуда берётся адрес каталога, по порядку:
 *   1. прошлая запись истории этой вкладки (Navigation API): работает и при переходе без перезагрузки;
 *   2. document.referrer: переход с полной загрузкой страницы в браузере без Navigation API;
 *   3. параметр ?from=... в адресе события (его проверяет сервер и передаёт сюда готовой ссылкой);
 *   4. каталог без условий.
 */

import { ArrowLeft } from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSyncExternalStore } from 'react';
import type { MouseEvent } from 'react';

import { cn } from '@/lib/cn';
import { useT } from '@/lib/i18n';

import { copy } from './copy';
import { catalogHrefFromUrl, hasFilters } from './model';

type HistoryEntry = { url: string | null; index: number };
type NavigationLike = { currentEntry: HistoryEntry | null; entries: () => HistoryEntry[] };

/** Адрес каталога, из которого открыли событие, или null. Значение за время жизни страницы не меняется. */
function readCatalogOrigin(): string | null {
  try {
    const navigation = (window as unknown as { navigation?: NavigationLike }).navigation;
    if (navigation?.currentEntry && typeof navigation.entries === 'function') {
      const previous = navigation.entries()[navigation.currentEntry.index - 1];
      return previous?.url ? catalogHrefFromUrl(previous.url, window.location.origin) : null;
    }
    return document.referrer ? catalogHrefFromUrl(document.referrer, window.location.origin) : null;
  } catch {
    return null;
  }
}

const subscribe = (): (() => void) => () => {};
const serverSnapshot = (): null => null;

export type BackLinkProps = {
  /** Адрес каталога, известный серверу: из параметра ?from=... или каталог без условий. */
  fallbackHref: string;
  className?: string;
};

export function BackLink({ fallbackHref, className }: BackLinkProps) {
  const { t, lang } = useT();
  const router = useRouter();
  // На сервере и при гидратации null: разметка совпадает, адрес из истории подставляется следом.
  const fromHistory = useSyncExternalStore(subscribe, readCatalogOrigin, serverSnapshot);
  const href = fromHistory ?? fallbackHref;

  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!fromHistory) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    // Каталог стоит прямо перед этой страницей в истории: шаг назад вернёт выдачу и прокрутку как были.
    event.preventDefault();
    router.back();
  };

  return (
    <Link
      href={href}
      onClick={onClick}
      data-back-link={fromHistory ? 'history' : 'link'}
      className={cn(
        't-caps group -ml-1 inline-flex min-h-11 items-center gap-2 rounded-xs px-1 text-fg-soft',
        'transition-colors duration-(--duration-fast) ease-out hover:text-fg',
        className,
      )}
    >
      <ArrowLeft
        size={16}
        weight="bold"
        aria-hidden="true"
        className="shrink-0 transition-transform duration-(--duration-fast) ease-out group-hover:-translate-x-0.5 motion-reduce:transition-none"
      />
      {hasFilters(href) ? copy('backToResults', lang) : t('event.backToCatalog')}
    </Link>
  );
}
