/**
 * Кирпичи страниц-документов: раздел, таблица параметров, адрес метода, пример запроса и ответа.
 * Все компоненты серверные: клиентского кода здесь нет.
 */

import { ArrowUpRight } from '@phosphor-icons/react/ssr';
import type { CSSProperties, ReactNode } from 'react';

import { cn } from '@/lib/cn';
import { pick } from '@/lib/i18n/lang';
import type { Lang, LocalizedText } from '@/lib/i18n/lang';

import { CodeBlock } from './CodeBlock';
import type { DocRow } from './copy';
import { DOCS } from './copy';
import styles from './docs.module.css';
import type { ApiExample } from './examples';
import { curlOf } from './examples';
import { rich } from './rich';
import { DOCS_UI } from './ui-copy';

/** Раскладка: оглавление слева, колонка текста справа. */
export function DocLayout({ toc, children }: { toc: ReactNode; children: ReactNode }) {
  return (
    <div className={styles.layout}>
      {toc}
      <div className={styles.content}>{children}</div>
    </div>
  );
}

export function DocSection({
  id,
  title,
  children,
  order,
}: {
  id: string;
  title: ReactNode;
  children: ReactNode;
  /** Номер в каскаде появления: только у разделов первого экрана. */
  order?: number;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={cn(styles.section, order !== undefined && styles.rise)}
      style={order !== undefined ? ({ '--i': order } as CSSProperties) : undefined}
    >
      <h2 id={`${id}-title`} className="t-subtitle">
        {title}
      </h2>
      <div className={styles.sectionBody}>{children}</div>
    </section>
  );
}

export function DocSubsection({ id, title, children }: { id?: string; title: ReactNode; children: ReactNode }) {
  return (
    <div id={id} className={styles.subsection}>
      <h3 className={styles.subheading}>{title}</h3>
      {children}
    </div>
  );
}

export function Prose({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('t-body', styles.prose, className)}>{children}</p>;
}

export function Bullets({ items, lang, numbered = false }: { items: readonly LocalizedText[]; lang: Lang; numbered?: boolean }) {
  const List = numbered ? 'ol' : 'ul';
  return (
    <List className={cn('t-body', styles.bullets, numbered && styles.numbered)}>
      {items.map((item) => (
        <li key={item.ru}>{rich(pick(item, lang))}</li>
      ))}
    </List>
  );
}

/** Таблица параметров или полей. На телефоне строки складываются в блоки: имя, тип, описание. */
export function DocTable({
  rows,
  lang,
  nameLabel,
  caption,
}: {
  rows: readonly DocRow[];
  lang: Lang;
  nameLabel: string;
  caption?: string;
}) {
  const withType = rows.some((row) => row.type);
  return (
    // Роли заданы явно: на телефоне строки таблицы переводятся в блоки, и без ролей таблица перестала бы читаться как таблица.
    <table className={styles.table} role="table">
      {caption ? <caption className="visually-hidden">{caption}</caption> : null}
      <thead role="rowgroup">
        <tr role="row">
          <th scope="col" role="columnheader" className="t-caps">
            {nameLabel}
          </th>
          {withType ? (
            <th scope="col" role="columnheader" className="t-caps">
              {pick(DOCS.ui.typeColumn, lang)}
            </th>
          ) : null}
          <th scope="col" role="columnheader" className="t-caps">
            {pick(DOCS.ui.textColumn, lang)}
          </th>
        </tr>
      </thead>
      <tbody role="rowgroup">
        {rows.map((row) => (
          <tr key={row.name} role="row">
            <td role="cell" className={styles.cellName}>
              {row.name.split(', ').map((name, index) => (
                <span key={name}>
                  {index > 0 ? <br /> : null}
                  <code>{name}</code>
                </span>
              ))}
            </td>
            {withType ? (
              <td role="cell" className={styles.cellType}>
                {row.type ? pick(row.type, lang) : ''}
              </td>
            ) : null}
            <td role="cell">{rich(pick(row.text, lang))}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function MethodBadge({ method }: { method: string }) {
  return (
    <span className={cn('t-caps', styles.method)} data-method={method}>
      {method}
    </span>
  );
}

/** Ссылка «Попробовать»: открывает живой GET-запрос в новой вкладке. */
export function TryLink({ href, lang, label }: { href: string; lang: Lang; label?: string }) {
  return (
    <a href={href} target="_blank" rel="noopener" className={styles.try} data-try>
      {label ?? pick(DOCS_UI.tryIt, lang)}
      <ArrowUpRight size={14} weight="bold" aria-hidden="true" />
      <span className="visually-hidden"> ({pick(DOCS_UI.newTab, lang)})</span>
    </a>
  );
}

/** Строка с адресом метода: GET /api/v1/events и ссылка на живой запрос. */
export function Endpoint({ method, path, tryHref, lang }: { method: string; path: string; tryHref?: string; lang: Lang }) {
  return (
    <p className={styles.endpoint}>
      <MethodBadge method={method} />
      <code className={styles.path}>{path}</code>
      {tryHref ? <TryLink href={tryHref} lang={lang} /> : null}
    </p>
  );
}

/** Пример: команда curl и настоящий ответ сервера в свёрнутом блоке. */
export function Example({
  example,
  origin,
  lang,
  open = false,
  showRequest = true,
}: {
  example: ApiExample | null;
  origin: string;
  lang: Lang;
  open?: boolean;
  showRequest?: boolean;
}) {
  if (!example) return <Prose>{pick(DOCS.ui.exampleMissing, lang)}</Prose>;
  const responseLabel = `${pick(DOCS.ui.response, lang)} ${example.status}`;
  return (
    <div className="flex flex-col gap-3" data-example={example.path}>
      {showRequest ? (
        <CodeBlock label={`${pick(DOCS.ui.request, lang)}: curl`} language="bash" code={curlOf(example, origin)} lang={lang} />
      ) : null}
      {example.body ? (
        <CodeBlock
          label={responseLabel}
          language="json"
          code={example.body}
          lang={lang}
          collapsible
          defaultOpen={open}
          meta={pick(DOCS_UI.lines, lang).replace('{count}', String(example.lines))}
        />
      ) : null}
    </div>
  );
}
