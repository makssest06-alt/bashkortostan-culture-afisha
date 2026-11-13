/**
 * Схема пути события: источник, проверка, сопоставление дублей, каталог и три канала вывода.
 * Чисто типографская: слова, волосяные линии и стрелки. Чисел в схеме нет: их нечем подтвердить.
 * На телефоне шаги идут сверху вниз, с 1024px в одну строку. Серверный компонент.
 */

import { ArrowDown, ArrowRight, ArrowUpRight } from '@phosphor-icons/react/ssr';
import Link from 'next/link';
import type { CSSProperties } from 'react';

import docs from '@/components/docs/docs.module.css';
import { ROUTES, TELEGRAM_BOT_IS_SET, TELEGRAM_BOT_URL } from '@/content/links';
import { cn } from '@/lib/cn';
import type { TFunction } from '@/lib/i18n/dict';
import { pick } from '@/lib/i18n/lang';
import type { Lang } from '@/lib/i18n/lang';

import styles from './about.module.css';
import { ABOUT } from './copy';

function Rail() {
  return (
    <span className={styles.rail} aria-hidden="true">
      <span className={styles.dot} />
      <ArrowRight size={16} weight="bold" className={styles.arrowH} />
      <ArrowDown size={16} weight="bold" className={styles.arrowV} />
    </span>
  );
}

export function EventPath({ lang, t }: { lang: Lang; t: TFunction }) {
  const p = (text: Parameters<typeof pick>[0]) => pick(text, lang);
  const copy = ABOUT.path;

  return (
    <section id="path" aria-labelledby="path-title" className={styles.path}>
      <div className={styles.pathHead}>
        <h2 id="path-title" className="t-subtitle">
          {p(copy.title)}
        </h2>
        <p className={`t-lead ${styles.pathLead}`}>{p(copy.lead)}</p>
      </div>

      <ol className={styles.flow}>
        {copy.nodes.map((node, index) => (
          <li
            key={node.id}
            className={cn(styles.node, docs.rise)}
            style={{ '--i': index } as CSSProperties}
            data-node={node.id}
          >
            <Rail />
            <div className={styles.nodeBody}>
              <a href={node.href} className={styles.nodeTitle}>
                {p(node.title)}
              </a>
              <p className={`t-body ${styles.nodeText}`}>{p(node.text)}</p>
            </div>
          </li>
        ))}

        <li
          className={cn(styles.node, docs.rise)}
          style={{ '--i': copy.nodes.length } as CSSProperties}
          data-node="out"
          data-out=""
        >
          <Rail />
          <div className={styles.nodeBody}>
            <span className={styles.nodeTitle}>{p(copy.outTitle)}</span>
            <p className={`t-body ${styles.nodeText}`}>{p(copy.outText)}</p>
            <ul className={styles.outLinks}>
              <li>
                <Link href={ROUTES.events} className={styles.outLink}>
                  {p(copy.out.site)}
                </Link>
              </li>
              <li>
                {TELEGRAM_BOT_IS_SET ? (
                  <a href={TELEGRAM_BOT_URL} target="_blank" rel="noopener" className={styles.outLink}>
                    {t('common.telegram')}
                    <ArrowUpRight size={14} weight="bold" aria-hidden="true" />
                    <span className="visually-hidden"> ({p(ABOUT.team.newTab)})</span>
                  </a>
                ) : (
                  <span className={styles.outSoon}>
                    {t('common.telegram')}
                    <span className="t-caps">{p(copy.out.soon)}</span>
                  </span>
                )}
              </li>
              <li>
                <Link href={ROUTES.widget} className={styles.outLink}>
                  {p(copy.out.widget)}
                </Link>
              </li>
              <li>
                <Link href={ROUTES.apiDocs} className={styles.outLink}>
                  {p(copy.out.api)}
                </Link>
              </li>
            </ul>
          </div>
        </li>
      </ol>

      <div className={styles.honesty}>
        <p className="t-body">{p(copy.honesty)}</p>
        <a href="#prototype" className={styles.outLink}>
          {p(copy.honestyLink)}
          <ArrowDown size={14} weight="bold" aria-hidden="true" />
        </a>
      </div>
    </section>
  );
}
