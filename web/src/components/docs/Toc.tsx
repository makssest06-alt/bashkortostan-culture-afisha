'use client';

/**
 * Оглавление страницы-документа. На широком экране стоит слева и прилипает к верху окна,
 * на телефоне сворачивается в одну строку над текстом.
 * Текущий раздел отмечается через IntersectionObserver: слушателей прокрутки нет.
 */

import { CaretRight } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';

import { pick, useLang } from '@/lib/i18n';

import styles from './docs.module.css';
import { DOCS_UI } from './ui-copy';

export type TocItem = {
  /** id раздела на странице. */
  id: string;
  label: string;
};

function TocLinks({ items, active, onNavigate }: { items: readonly TocItem[]; active: string | null; onNavigate?: () => void }) {
  return (
    <ul className={styles.tocList}>
      {items.map((item) => (
        <li key={item.id}>
          <a
            href={`#${item.id}`}
            className={styles.tocLink}
            aria-current={active === item.id ? 'location' : undefined}
            onClick={onNavigate}
          >
            {item.label}
          </a>
        </li>
      ))}
    </ul>
  );
}

export function Toc({ items }: { items: readonly TocItem[] }) {
  const lang = useLang();
  const [active, setActive] = useState<string | null>(null);
  const details = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const sections = items
      .map((item) => document.getElementById(item.id))
      .filter((node): node is HTMLElement => node !== null);
    if (sections.length === 0 || typeof IntersectionObserver === 'undefined') return;

    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        // Из разделов в верхней части окна берём первый по порядку страницы.
        const current = items.find((item) => visible.has(item.id));
        if (current) setActive(current.id);
      },
      { rootMargin: '-15% 0px -60% 0px' },
    );
    for (const section of sections) observer.observe(section);
    return () => observer.disconnect();
  }, [items]);

  const title = pick(DOCS_UI.toc, lang);

  return (
    <>
      <details ref={details} className={styles.tocMobile}>
        <summary className={styles.tocSummary}>
          <span className="t-ui">{title}</span>
          <CaretRight size={16} weight="bold" aria-hidden="true" className={styles.tocCaret} />
        </summary>
        <nav aria-label={title}>
          <TocLinks
            items={items}
            active={active}
            onNavigate={() => {
              if (details.current) details.current.open = false;
            }}
          />
        </nav>
      </details>
      <nav aria-label={title} className={styles.tocDesktop}>
        <p className={`t-caps ${styles.tocTitle}`}>{title}</p>
        <TocLinks items={items} active={active} />
      </nav>
    </>
  );
}
