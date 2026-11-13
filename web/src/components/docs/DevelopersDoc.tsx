/**
 * Содержимое страницы /developers: подключение к сайту министерства, правила API, методы с параметрами,
 * настоящие примеры ответов, ошибки, CORS, словари и статусы. Серверный компонент.
 */

import { ArrowRight } from '@phosphor-icons/react/ssr';

import { KuskarBorder } from '@/components/ornament';
import { Button, PriceTag } from '@/components/ui';
import { iframeSnippet, scriptSnippet, defaultWidgetSettings } from '@/components/widget/settings';
import { ROUTES } from '@/content/links';
import type { Dictionaries } from '@/lib/api/types';
import { createT } from '@/lib/i18n/dict';
import { pick } from '@/lib/i18n/lang';
import type { Lang } from '@/lib/i18n/lang';

import { CodeBlock } from './CodeBlock';
import { DOCS } from './copy';
import styles from './docs.module.css';
import type { ApiExamples } from './examples';
import { ASSISTANT_PATH } from './examples';
import { Bullets, DocLayout, DocSection, DocSubsection, DocTable, Endpoint, Example, MethodBadge, Prose, TryLink } from './parts';
import { rich } from './rich';
import { StatusTable } from './StatusTable';
import { Toc } from './Toc';
import type { TocItem } from './Toc';

const SECTION_IDS = [
  'connect',
  'api',
  'methods',
  'events',
  'event',
  'facets',
  'dictionaries',
  'assistant',
  'service',
  'errors',
  'cors',
  'statuses',
  'demo',
] as const;

/** Заголовки CORS в том порядке, в каком их удобно читать. */
const CORS_HEADER_NAMES = [
  'access-control-allow-origin',
  'access-control-allow-methods',
  'access-control-allow-headers',
  'access-control-max-age',
];

function headerCase(name: string): string {
  return name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('-');
}

function firstItemId(examples: ApiExamples): string | null {
  const value = examples.event?.value;
  if (typeof value === 'object' && value !== null && 'id' in value && typeof value.id === 'string') return value.id;
  return null;
}

export type DevelopersDocProps = {
  lang: Lang;
  /** Адрес сайта, по которому открыта страница: подставляется в примеры. */
  origin: string;
  examples: ApiExamples;
  dictionaries: Dictionaries;
};

export function DevelopersDoc({ lang, origin, examples, dictionaries }: DevelopersDocProps) {
  const t = createT(lang);
  const p = (text: Parameters<typeof pick>[0]) => pick(text, lang);

  const toc: TocItem[] = SECTION_IDS.map((id) => ({ id, label: p(DOCS.toc[id]) }));
  const widgetSettings = { ...defaultWidgetSettings(lang), city: 'ufa' as const };
  const eventId = firstItemId(examples);

  const methods = [
    { method: 'GET', path: '/api/v1/events', anchor: 'events', text: t('developers.endpoint.events'), tryHref: examples.events?.path },
    {
      method: 'GET',
      path: '/api/v1/events/{id}',
      anchor: 'event',
      text: t('developers.endpoint.event'),
      tryHref: eventId ? `/api/v1/events/${eventId}` : undefined,
    },
    { method: 'GET', path: '/api/v1/facets', anchor: 'facets', text: t('developers.endpoint.facets'), tryHref: '/api/v1/facets' },
    {
      method: 'GET',
      path: '/api/v1/dictionaries',
      anchor: 'dictionaries',
      text: t('developers.endpoint.dictionaries'),
      tryHref: '/api/v1/dictionaries',
    },
    { method: 'POST', path: ASSISTANT_PATH, anchor: 'assistant', text: t('developers.endpoint.assistant'), tryHref: undefined },
    { method: 'GET', path: '/api/v1/health', anchor: 'service', text: t('developers.endpoint.health'), tryHref: '/api/v1/health' },
    { method: 'GET', path: '/api/v1', anchor: 'service', text: p(DOCS.methods.index), tryHref: '/api/v1' },
  ];

  const corsSource = examples.events ?? examples.health;
  const corsHeaders = corsSource
    ? CORS_HEADER_NAMES.filter((name) => corsSource.headers[name]).map((name) => `${headerCase(name)}: ${corsSource.headers[name]}`)
    : [];

  return (
    <DocLayout toc={<Toc items={toc} />}>
      {/* ------------------------------------------------------- Подключение */}
      <DocSection id="connect" title={t('developers.connect.title')} order={0}>
        <p className={`t-lead ${styles.lead}`}>{p(DOCS.connect.lead)}</p>
        <ol className={styles.steps}>
          <li className={styles.step}>
            <span className={`t-subtitle ${styles.stepNum}`} aria-hidden="true">
              1
            </span>
            <h3 className="t-subtitle">{p(DOCS.connect.steps[0].title)}</h3>
            <div className={styles.stepBody}>
              <Prose>{p(DOCS.connect.steps[0].text)}</Prose>
              <CodeBlock
                label={p(DOCS.connect.scriptLabel)}
                language="html"
                code={scriptSnippet(origin, widgetSettings)}
                lang={lang}
              />
              <Prose>{p(DOCS.connect.iframeIntro)}</Prose>
              <CodeBlock
                label={p(DOCS.connect.iframeLabel)}
                language="html"
                code={iframeSnippet(origin, widgetSettings, t('widget.heading'))}
                lang={lang}
                collapsible
              />
            </div>
          </li>
          <li className={styles.step}>
            <span className={`t-subtitle ${styles.stepNum}`} aria-hidden="true">
              2
            </span>
            <h3 className="t-subtitle">{p(DOCS.connect.steps[1].title)}</h3>
            <div className={styles.stepBody}>
              <Prose>{p(DOCS.connect.steps[1].text)}</Prose>
              <div>
                <Button href={ROUTES.widget} variant="ghost">
                  {p(DOCS.connect.configurator)}
                  <ArrowRight size={16} weight="bold" aria-hidden="true" />
                </Button>
              </div>
              <DocTable
                rows={DOCS.connect.attrs}
                lang={lang}
                nameLabel={p(DOCS.ui.attrColumn)}
                caption={p(DOCS.connect.attrsCaption)}
              />
            </div>
          </li>
          <li className={styles.step}>
            <span className={`t-subtitle ${styles.stepNum}`} aria-hidden="true">
              3
            </span>
            <h3 className="t-subtitle">{p(DOCS.connect.steps[2].title)}</h3>
            <div className={styles.stepBody}>
              <Prose>{rich(p(DOCS.connect.steps[2].text))}</Prose>
              <div>
                <TryLink href="/api/v1/health" lang={lang} label={p(DOCS.connect.checkAction)} />
              </div>
            </div>
          </li>
        </ol>
        <DocSubsection title={p(DOCS.connect.safeTitle)}>
          <Bullets items={DOCS.connect.safe} lang={lang} />
        </DocSubsection>
      </DocSection>

      {/* ----------------------------------------------------- Общие правила */}
      <DocSection id="api" title={p(DOCS.toc.api)}>
        <CodeBlock label={t('developers.baseUrl')} code={`${origin}/api/v1`} lang={lang} size="lg" />
        <Prose>{p(DOCS.rules.baseUrlNote)}</Prose>
        <dl className={styles.defs}>
          {DOCS.rules.rows.map((row) => (
            <div key={row.name.ru} className={styles.defRow}>
              <dt>{p(row.name)}</dt>
              <dd>{rich(p(row.text))}</dd>
            </div>
          ))}
        </dl>
        <DocSubsection title={p(DOCS.rules.trustTitle)}>
          <Bullets items={DOCS.rules.trust} lang={lang} numbered />
        </DocSubsection>
      </DocSection>

      {/* ------------------------------------------------------------ Методы */}
      <DocSection id="methods" title={t('developers.endpoints')}>
        <table className={`${styles.table} ${styles.methodsTable}`} role="table" data-methods>
          <thead role="rowgroup">
            <tr role="row">
              <th scope="col" role="columnheader" className="t-caps">
                {p(DOCS.methods.columns.path)}
              </th>
              <th scope="col" role="columnheader" className="t-caps">
                {p(DOCS.methods.columns.what)}
              </th>
              <th scope="col" role="columnheader" className="t-caps">
                <span className="visually-hidden">{t('developers.try')}</span>
              </th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            {methods.map((row) => (
              <tr key={row.path} role="row">
                <td role="cell" className={styles.cellName}>
                  <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
                    <MethodBadge method={row.method} />
                    <a
                      href={`#${row.anchor}`}
                      className="inline-flex min-h-9 items-center underline pointer-coarse:min-h-11 decoration-line-strong decoration-1 underline-offset-[0.3em]"
                    >
                      <code>{row.path}</code>
                    </a>
                  </span>
                </td>
                <td role="cell">{row.text}</td>
                <td role="cell">
                  {row.tryHref ? (
                    <TryLink href={row.tryHref} lang={lang} />
                  ) : (
                    <span className="text-fg-muted">{p(DOCS.methods.postNote)}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </DocSection>

      {/* ---------------------------------------------------- Список событий */}
      <DocSection id="events" title={p(DOCS.toc.events)}>
        <Endpoint method="GET" path="/api/v1/events" tryHref={examples.events?.path} lang={lang} />
        <Prose>{rich(p(DOCS.events.lead))}</Prose>
        <DocTable rows={DOCS.events.params} lang={lang} nameLabel={t('developers.param.name')} caption={t('developers.params')} />
        <DocSubsection title={p(DOCS.events.periodsTitle)}>
          <Bullets items={DOCS.events.periods} lang={lang} />
        </DocSubsection>
        <DocSubsection title={t('developers.request')}>
          <Example example={examples.events} origin={origin} lang={lang} />
        </DocSubsection>
        <DocSubsection title={p(DOCS.events.fieldsTitle)}>
          <DocTable rows={DOCS.events.fields} lang={lang} nameLabel={p(DOCS.ui.fieldColumn)} />
        </DocSubsection>
        <DocSubsection title={p(DOCS.events.emptyTitle)}>
          <Prose>{rich(p(DOCS.events.emptyText))}</Prose>
          {examples.eventsEmpty ? (
            <>
              <div>
                <TryLink href={examples.eventsEmpty.path} lang={lang} />
              </div>
              <Example example={examples.eventsEmpty} origin={origin} lang={lang} />
            </>
          ) : (
            <Prose>{p(DOCS.events.emptyMissing)}</Prose>
          )}
        </DocSubsection>
      </DocSection>

      {/* -------------------------------------------------- Карточка события */}
      <DocSection id="event" title={p(DOCS.toc.event)}>
        <Endpoint
          method="GET"
          path="/api/v1/events/{id}"
          tryHref={eventId ? `/api/v1/events/${eventId}` : undefined}
          lang={lang}
        />
        <Prose>{p(DOCS.event.lead)}</Prose>
        <Example example={examples.event} origin={origin} lang={lang} />
        <Prose>{p(DOCS.event.notFound)}</Prose>
        <Example example={examples.eventNotFound} origin={origin} lang={lang} open />
      </DocSection>

      {/* ---------------------------------------------------------- Счётчики */}
      <DocSection id="facets" title={p(DOCS.toc.facets)}>
        <Endpoint method="GET" path="/api/v1/facets" tryHref={examples.facets?.path ?? '/api/v1/facets'} lang={lang} />
        <Prose>{p(DOCS.facets.lead)}</Prose>
        <Example example={examples.facets} origin={origin} lang={lang} />
        <Prose>{p(DOCS.facets.note)}</Prose>
      </DocSection>

      {/* -------------------------------------------------------- Справочники */}
      <DocSection id="dictionaries" title={p(DOCS.toc.dictionaries)}>
        <Endpoint method="GET" path="/api/v1/dictionaries" tryHref="/api/v1/dictionaries" lang={lang} />
        <Prose>{rich(p(DOCS.dictionaries.lead))}</Prose>
        <Example example={examples.dictionaries} origin={origin} lang={lang} />
      </DocSection>

      {/* --------------------------------------------------- Подбор по фразе */}
      <DocSection id="assistant" title={p(DOCS.toc.assistant)}>
        <Endpoint method="POST" path={ASSISTANT_PATH} lang={lang} />
        <Prose>{p(DOCS.assistant.lead)}</Prose>
        <Prose>{rich(p(DOCS.assistant.prototype))}</Prose>
        <Prose>{rich(p(DOCS.assistant.stateless))}</Prose>
        <DocSubsection title={p(DOCS.assistant.bodyTitle)}>
          <DocTable rows={DOCS.assistant.body} lang={lang} nameLabel={p(DOCS.ui.fieldColumn)} />
        </DocSubsection>
        <DocSubsection title={p(DOCS.assistant.firstTitle)}>
          <Example example={examples.assistantClarify} origin={origin} lang={lang} />
        </DocSubsection>
        <DocSubsection title={p(DOCS.assistant.secondTitle)}>
          <Prose>{rich(p(DOCS.assistant.secondText))}</Prose>
          <Example example={examples.assistantSearch} origin={origin} lang={lang} />
        </DocSubsection>
        <DocSubsection title={p(DOCS.assistant.responseTitle)}>
          <DocTable rows={DOCS.assistant.response} lang={lang} nameLabel={p(DOCS.ui.fieldColumn)} />
        </DocSubsection>
      </DocSection>

      {/* -------------------------------------------------- Служебные методы */}
      <DocSection id="service" title={p(DOCS.toc.service)}>
        <Endpoint method="GET" path="/api/v1/health" tryHref="/api/v1/health" lang={lang} />
        <Prose>{rich(p(DOCS.service.health))}</Prose>
        <Example example={examples.health} origin={origin} lang={lang} open />
        <Endpoint method="GET" path="/api/v1" tryHref="/api/v1" lang={lang} />
        <Prose>{rich(p(DOCS.service.index))}</Prose>
        <Example example={examples.index} origin={origin} lang={lang} />
      </DocSection>

      {/* ------------------------------------------------------------ Ошибки */}
      <DocSection id="errors" title={t('developers.errors')}>
        <Prose>{rich(p(DOCS.errors.lead))}</Prose>
        {examples.validationError ? (
          <div>
            <TryLink href={examples.validationError.path} lang={lang} />
          </div>
        ) : null}
        <Example example={examples.validationError} origin={origin} lang={lang} open />
        <table className={styles.table} role="table" data-errors>
          <thead role="rowgroup">
            <tr role="row">
              <th scope="col" role="columnheader" className="t-caps">
                {p(DOCS.errors.columns.code)}
              </th>
              <th scope="col" role="columnheader" className="t-caps">
                {p(DOCS.errors.columns.status)}
              </th>
              <th scope="col" role="columnheader" className="t-caps">
                {p(DOCS.errors.columns.when)}
              </th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            {DOCS.errors.rows.map((row) => (
              <tr key={row.code} role="row">
                <td role="cell" className={styles.cellName}>
                  <code>{row.code}</code>
                </td>
                <td role="cell" className={styles.cellType} data-num>
                  {row.status}
                </td>
                <td role="cell">{rich(p(row.when))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Prose>{p(DOCS.errors.ignored)}</Prose>
      </DocSection>

      {/* -------------------------------------------------------------- CORS */}
      <DocSection id="cors" title={t('developers.cors')}>
        <Prose>{p(DOCS.cors.lead)}</Prose>
        {corsHeaders.length > 0 ? (
          <CodeBlock label={p(DOCS.cors.headersLabel)} code={corsHeaders.join('\n')} lang={lang} />
        ) : null}
        {examples.preflight ? (
          <Prose>{rich(p(DOCS.cors.preflight).replace('{status}', `\`${examples.preflight.status}\``))}</Prose>
        ) : null}
      </DocSection>

      {/* ------------------------------------------------- Словари и статусы */}
      <DocSection id="statuses" title={p(DOCS.toc.statuses)}>
        <Prose>{p(DOCS.statuses.lead)}</Prose>
        <DocSubsection title={p(DOCS.statuses.ruleTitle)}>
          <Prose>{p(DOCS.statuses.ruleNote)}</Prose>
          <StatusTable lang={lang} withRule />
        </DocSubsection>
        <DocSubsection title={p(DOCS.statuses.priceTitle)}>
          <Prose>{rich(p(DOCS.statuses.priceNote))}</Prose>
          <table className={styles.table} role="table" data-prices>
            <thead role="rowgroup">
              <tr role="row">
                <th scope="col" role="columnheader" className="t-caps">
                  kind
                </th>
                <th scope="col" role="columnheader" className="t-caps">
                  {t('event.price')}
                </th>
                <th scope="col" role="columnheader" className="t-caps">
                  {p(DOCS.statuses.columns.meaning)}
                </th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              <tr role="row">
                <td role="cell" className={styles.cellName}>
                  <code>free</code>
                </td>
                <td role="cell">
                  <PriceTag price={{ kind: 'free' }} />
                </td>
                <td role="cell">{p(DOCS.statuses.price.free)}</td>
              </tr>
              <tr role="row">
                <td role="cell" className={styles.cellName}>
                  <code>from</code>
                </td>
                <td role="cell">
                  <PriceTag price={{ kind: 'from', amount_minor: 50000 }} />
                </td>
                <td role="cell">{rich(p(DOCS.statuses.price.from))}</td>
              </tr>
              <tr role="row">
                <td role="cell" className={styles.cellName}>
                  <code>unknown</code>
                </td>
                <td role="cell">
                  <PriceTag price={{ kind: 'unknown' }} />
                </td>
                <td role="cell">{p(DOCS.statuses.price.unknown)}</td>
              </tr>
            </tbody>
          </table>
        </DocSubsection>
        <DocSubsection title={p(DOCS.statuses.idsTitle)}>
          <Prose>{rich(p(DOCS.statuses.idsNote))}</Prose>
          <div className="grid gap-x-12 gap-y-8 sm:grid-cols-2">
            <div>
              <h4 className="t-caps text-fg-muted">{p(DOCS.statuses.cities)}</h4>
              <ul className="mt-3 flex flex-col gap-2">
                {dictionaries.cities.map((city) => (
                  <li key={city.slug} className="flex items-baseline gap-3">
                    <code className={styles.icode}>{city.slug}</code>
                    <span className="text-fg-soft">{p(city.name)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="t-caps text-fg-muted">{p(DOCS.statuses.categories)}</h4>
              <ul className="mt-3 flex flex-col gap-2">
                {dictionaries.categories.map((category) => (
                  <li key={category.id} className="flex items-baseline gap-3">
                    <code className={styles.icode}>{category.id}</code>
                    <span className="text-fg-soft">{p(category.name)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </DocSubsection>
      </DocSection>

      {/* ------------------------------------------------------- Демо-данные */}
      <DocSection id="demo" title={t('developers.demo')}>
        <Prose>{rich(t('developers.demo.text').replace('synthetic: true', '`synthetic: true`'))}</Prose>
        <div>
          <Button href={ROUTES.aboutDemo} variant="link">
            {p(DOCS.demo.link)}
            <ArrowRight size={16} weight="bold" aria-hidden="true" />
          </Button>
        </div>
        <KuskarBorder height={16} variant="row" className="mt-6 text-fg-muted opacity-60" />
      </DocSection>
    </DocLayout>
  );
}
