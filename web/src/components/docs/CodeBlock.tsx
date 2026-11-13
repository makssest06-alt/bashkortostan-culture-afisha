/**
 * Блок кода с подписью и кнопкой «Скопировать». Серверный компонент: клиентская здесь только кнопка.
 *
 *   <CodeBlock label="curl" language="bash" code={`curl "..."`} lang={lang} />
 *   <CodeBlock label="Ответ 200" language="json" code={json} collapsible lang={lang} />
 *
 * Свёрнутый блок сделан на <details>: раскрывается с клавиатуры и работает без скриптов.
 * Длинный код прокручивается внутри блока. Атрибут data-lenis-prevent отдаёт колесо мыши
 * самому блоку: плавная прокрутка страницы его не перехватывает.
 */

import { CaretRight } from '@phosphor-icons/react/ssr';
import { useId } from 'react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';
import { pick } from '@/lib/i18n/lang';
import type { Lang } from '@/lib/i18n/lang';

import { CopyButton } from './CopyButton';
import styles from './docs.module.css';
import { highlight } from './highlight';
import type { CodeLanguage } from './highlight';
import { DOCS_UI } from './ui-copy';

/** JSON длиннее этого числа знаков показывается без подсветки ключей. */
const PLAIN_JSON_FROM = 1600;

export type CodeBlockProps = {
  code: string;
  /** Короткая подпись в шапке блока: «curl», «Ответ 200». */
  label: string;
  language?: CodeLanguage;
  lang: Lang;
  /** Свёрнутый блок: код открывается по клику на шапку. */
  collapsible?: boolean;
  defaultOpen?: boolean;
  /** Что стоит в шапке после подписи: код ответа, число строк. */
  meta?: ReactNode;
  /** Код одной строкой крупнее обычного: для кода вставки виджета. */
  size?: 'md' | 'lg';
  className?: string;
};

export function CodeBlock({
  code,
  label,
  language = 'text',
  lang,
  collapsible = false,
  defaultOpen = false,
  meta,
  size = 'md',
  className,
}: CodeBlockProps) {
  const codeId = useId();
  // Длинный ответ остаётся простым текстом: разметка подсветки утроила бы вес страницы.
  const plain = language === 'json' && code.length > PLAIN_JSON_FROM;
  const pre = (
    <pre
      id={codeId}
      className={styles.pre}
      tabIndex={0}
      role="region"
      aria-label={pick(DOCS_UI.codeRegion, lang).replace('{label}', label)}
      data-lenis-prevent=""
      data-size={size}
    >
      <code>{plain ? code : highlight(code, language)}</code>
    </pre>
  );
  const copy = (
    <CopyButton targetId={codeId} ariaLabel={pick(DOCS_UI.copyCode, lang).replace('{label}', label)} className={styles.codeCopy} />
  );

  if (collapsible) {
    return (
      <div className={cn(styles.code, className)} data-code={language}>
        <details open={defaultOpen}>
          <summary className={cn(styles.codeBar, styles.codeSummary)}>
            <CaretRight size={14} weight="bold" aria-hidden="true" className={styles.codeCaret} />
            <span className="t-caps">{label}</span>
            {meta ? <span className={styles.codeMeta}>{meta}</span> : null}
          </summary>
          {pre}
        </details>
        {copy}
      </div>
    );
  }

  return (
    <div className={cn(styles.code, className)} data-code={language}>
      <div className={styles.codeBar}>
        <span className="t-caps">{label}</span>
        {meta ? <span className={styles.codeMeta}>{meta}</span> : null}
      </div>
      {pre}
      {copy}
    </div>
  );
}
