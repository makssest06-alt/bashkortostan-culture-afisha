'use client';

/**
 * Язык интерфейса: провайдер и хук перевода.
 *
 *   // layout.tsx (серверный компонент)
 *   <I18nProvider initialLang={lang}>{children}</I18nProvider>
 *
 *   // клиентский компонент
 *   const { t, lang, setLang } = useT();
 *   t('nav.events');                      // «События» или «Саралар»
 *   t('events.count', { count: 5 });      // «5 событий»
 *
 * Выбранный язык хранится в cookie и localStorage. Начальное значение ru:
 * сервер и первый рендер в браузере совпадают, поэтому расхождения при гидратации нет.
 * При смене языка меняется и атрибут lang у <html>.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';

import { translate } from './dict';
import type { TFunction } from './dict';
import { DEFAULT_LANG, HTML_LANG, LANG_COOKIE, LANG_STORAGE_KEY, isLang } from './lang';
import type { Lang } from './lang';

export { translate, createT, dictionaries, hasKey, pluralForm } from './dict';
export type { DictKey, PluralKey, TFunction, TKey, TVars } from './dict';
export { DEFAULT_LANG, HTML_LANG, LANGS, LANG_COOKIE, LANG_STORAGE_KEY, isLang, parseLang, pick } from './lang';
export type { Lang, LocalizedText } from './lang';

export interface I18nValue {
  t: TFunction;
  lang: Lang;
  setLang: (lang: Lang) => void;
}

const ONE_YEAR_SECONDS = 31_536_000;

// ---------------------------------------------------------------------------
// Хранилище выбранного языка
// ---------------------------------------------------------------------------

const listeners = new Set<() => void>();

function readCookie(): Lang | null {
  const match = new RegExp(`(?:^|;\\s*)${LANG_COOKIE}=([^;]+)`).exec(document.cookie);
  return match && isLang(match[1]) ? match[1] : null;
}

/** Сохранённый язык или null. В режиме инкогнито localStorage может быть закрыт: тогда читаем cookie. */
function readStoredLang(): Lang | null {
  try {
    const stored = window.localStorage.getItem(LANG_STORAGE_KEY);
    if (isLang(stored)) return stored;
  } catch {
    // Хранилище недоступно: остаётся cookie.
  }
  return readCookie();
}

function writeStoredLang(lang: Lang): void {
  try {
    window.localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    // Хранилище недоступно: язык сохранится в cookie.
  }
  document.cookie = `${LANG_COOKIE}=${lang}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Язык сменили в другой вкладке: подхватываем и здесь.
  const onStorage = (event: StorageEvent): void => {
    if (event.key === null || event.key === LANG_STORAGE_KEY) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

// ---------------------------------------------------------------------------
// Провайдер и хуки
// ---------------------------------------------------------------------------

const FALLBACK: I18nValue = {
  lang: DEFAULT_LANG,
  t: (key, vars) => translate(DEFAULT_LANG, key, vars),
  setLang: () => {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[i18n] setLang вызван вне I18nProvider: язык не изменится');
    }
  },
};

const I18nContext = createContext<I18nValue>(FALLBACK);

export interface I18nProviderProps {
  children: ReactNode;
  /**
   * Язык для серверного рендера и первого кадра в браузере. По умолчанию ru.
   * Если layout читает cookie (см. ./server), передайте значение сюда:
   * тогда страница сразу придёт на нужном языке.
   */
  initialLang?: Lang;
}

export function I18nProvider({ children, initialLang = DEFAULT_LANG }: I18nProviderProps) {
  const lang = useSyncExternalStore(
    subscribe,
    () => readStoredLang() ?? initialLang,
    () => initialLang,
  );

  useEffect(() => {
    document.documentElement.lang = HTML_LANG[lang];
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    if (isLang(next)) writeStoredLang(next);
  }, []);

  const value = useMemo<I18nValue>(
    () => ({ lang, setLang, t: (key, vars) => translate(lang, key, vars) }),
    [lang, setLang],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** Перевод, текущий язык и его смена. Вне провайдера отдаёт русский язык. */
export function useT(): I18nValue {
  return useContext(I18nContext);
}

/** Только текущий язык: для компонентов, которым нужны подписи из справочников API. */
export function useLang(): Lang {
  return useContext(I18nContext).lang;
}
