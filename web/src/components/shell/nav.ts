/**
 * Пункты меню сайта: одно место для шапки, мобильного меню и подвала.
 * Подписи берутся из словаря по ключу.
 */

import { ROUTES } from '@/content/links';
import type { TKey } from '@/lib/i18n/dict';

export type NavItem = {
  href: string;
  labelKey: TKey;
};

export const NAV_ITEMS: readonly NavItem[] = [
  { href: ROUTES.events, labelKey: 'nav.events' },
  { href: ROUTES.ask, labelKey: 'nav.ask' },
  { href: ROUTES.widget, labelKey: 'nav.widget' },
  { href: ROUTES.developers, labelKey: 'nav.api' },
  { href: ROUTES.about, labelKey: 'nav.about' },
];

/** Пункт активен на своём адресе и на вложенных: /events и /events/123. */
export function isNavActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
