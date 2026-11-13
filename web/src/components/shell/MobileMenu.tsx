'use client';

/**
 * Мобильное меню: оверлей на весь экран с крупными пунктами (цели касания от 44px).
 * Закрывается кнопкой, клавишей Escape и переходом по ссылке. Фокус не выходит за пределы меню,
 * после закрытия возвращается на кнопку, прокрутка страницы под меню заперта.
 */

import { ArrowUpRight, X } from '@phosphor-icons/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import type { CSSProperties, RefObject } from 'react';

import { ROUTES, TELEGRAM_BOT_URL } from '@/content/links';
import { useT } from '@/lib/i18n';

import { LangSwitch } from './LangSwitch';
import { NAV_ITEMS, isNavActive } from './nav';
import { lockScroll, unlockScroll } from './scroll';
import { Wordmark } from './Wordmark';

export type MobileMenuProps = {
  id: string;
  open: boolean;
  onClose: () => void;
  /** Куда вернуть фокус после закрытия: кнопка, открывшая меню. */
  returnFocusRef?: RefObject<HTMLElement | null>;
};

const FOCUSABLE = 'a[href], button:not([disabled])';

export function MobileMenu({ id, open, onClose, returnFocusRef }: MobileMenuProps) {
  const { t } = useT();
  const pathname = usePathname();
  const panel = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const returnTo = returnFocusRef?.current ?? null;
    lockScroll();
    closeButton.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !panel.current) return;
      const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      unlockScroll();
      returnTo?.focus();
    };
  }, [open, onClose, returnFocusRef]);

  const links = [{ href: ROUTES.home, labelKey: 'nav.home' as const }, ...NAV_ITEMS];

  return (
    <div
      id={id}
      ref={panel}
      className="mobile-menu"
      role="dialog"
      aria-modal="true"
      aria-label={t('nav.menu')}
      data-open={open ? '' : undefined}
      inert={!open}
    >
      <div className="mobile-menu__top">
        <Wordmark>{t('common.brand')}</Wordmark>
        <button ref={closeButton} type="button" className="site-header__menu-button" onClick={onClose}>
          <X size={24} weight="bold" aria-hidden="true" />
          <span className="visually-hidden">{t('nav.closeMenu')}</span>
        </button>
      </div>

      <nav aria-label={t('nav.main')} className="mobile-menu__nav">
        <ul>
          {links.map((item, index) => {
            const active = item.href === ROUTES.home ? pathname === ROUTES.home : isNavActive(pathname, item.href);
            return (
              <li key={item.href} className="mobile-menu__item" style={{ '--i': index } as CSSProperties}>
                <Link
                  href={item.href}
                  className="mobile-menu__link"
                  aria-current={active ? 'page' : undefined}
                  onClick={onClose}
                >
                  {t(item.labelKey)}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="mobile-menu__bottom" style={{ '--i': links.length } as CSSProperties}>
        <LangSwitch size="large" />
        <a className="mobile-menu__telegram t-ui" href={TELEGRAM_BOT_URL} target="_blank" rel="noopener noreferrer">
          {t('common.telegram')}
          <ArrowUpRight size={18} weight="bold" aria-hidden="true" />
        </a>
      </div>
    </div>
  );
}
