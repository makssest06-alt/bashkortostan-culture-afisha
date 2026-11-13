'use client';

/**
 * Шапка сайта. Логотип слева на 3 % ширины, меню справа мелкими прописными, активный пункт подчёркнут.
 * На главной шапка прозрачная и лежит поверх сцен; цвет переключается атрибутом
 * data-header-tone на <html> ('light' светлая на тёмном, 'dark' тёмная на светлой секции).
 * Уже 1024px меню прячется за кнопку и открывается оверлеем на весь экран.
 */

import { ArrowUpRight, List } from '@phosphor-icons/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ROUTES, TELEGRAM_BOT_URL } from '@/content/links';
import { useT } from '@/lib/i18n';

import { LangSwitch } from './LangSwitch';
import { MobileMenu } from './MobileMenu';
import { NAV_ITEMS, isNavActive } from './nav';
import { Wordmark } from './Wordmark';

const MENU_ID = 'site-menu';

export function Header() {
  const { t } = useT();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const header = useRef<HTMLElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const home = pathname === ROUTES.home;

  const closeMenu = useCallback(() => setMenuOpen(false), []);

  // Страница прокручена: на внутренних страницах шапка получает подложку.
  useEffect(() => {
    const node = sentinel.current;
    const target = header.current;
    if (!node || !target) return;
    const observer = new IntersectionObserver(([entry]) => {
      target.toggleAttribute('data-scrolled', !entry.isIntersecting);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <div ref={sentinel} className="pointer-events-none absolute top-0 left-0 h-3 w-px" aria-hidden="true" />
      <header ref={header} className="site-header" data-home={home ? '' : undefined}>
        <Link
          href={ROUTES.home}
          className="site-header__logo"
          aria-label={t('common.brandFull')}
          aria-current={home ? 'page' : undefined}
        >
          <Wordmark>{t('common.brand')}</Wordmark>
        </Link>

        <nav className="site-header__nav" aria-label={t('nav.main')}>
          <ul className="site-header__list">
            {NAV_ITEMS.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="site-nav-link"
                  aria-current={isNavActive(pathname, item.href) ? 'page' : undefined}
                >
                  {t(item.labelKey)}
                </Link>
              </li>
            ))}
          </ul>
          <LangSwitch />
          <a className="site-nav-link" href={TELEGRAM_BOT_URL} target="_blank" rel="noopener noreferrer">
            {t('common.telegram')}
            <ArrowUpRight size={12} weight="bold" aria-hidden="true" />
          </a>
        </nav>

        <div className="site-header__compact">
          <LangSwitch />
          <button
            ref={menuButton}
            type="button"
            className="site-header__menu-button"
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
            aria-controls={MENU_ID}
            onClick={() => setMenuOpen(true)}
          >
            <List size={24} weight="bold" aria-hidden="true" />
            <span className="visually-hidden">{t('nav.openMenu')}</span>
          </button>
        </div>
      </header>
      <MobileMenu id={MENU_ID} open={menuOpen} onClose={closeMenu} returnFocusRef={menuButton} />
    </>
  );
}
