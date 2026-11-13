/**
 * Содержимое страницы /about: принципы, модель «событие, сеанс, цена», сбор, проверка,
 * дедупликация с тремя исходами, ИИ-подбор, честное сравнение «как устроено / что в прототипе»,
 * демо-данные, авторы фотографий и происхождение проекта. Серверный компонент.
 *
 * Якоря, на которые ссылается остальной сайт: #verify, #dedup, #demo (src/content/links.ts), #credits.
 */

import { ArrowRight, ArrowUpRight } from '@phosphor-icons/react/ssr';
import type { CSSProperties } from 'react';

import docs from '@/components/docs/docs.module.css';
import { Bullets, DocLayout, DocSection, DocSubsection, Prose } from '@/components/docs/parts';
import { rich } from '@/components/docs/rich';
import { StatusTable } from '@/components/docs/StatusTable';
import { Toc } from '@/components/docs/Toc';
import type { TocItem } from '@/components/docs/Toc';
import { KuskarBorder } from '@/components/ornament';
import { Button, PriceTag } from '@/components/ui';
import { ROUTES, TELEGRAM_BOT_IS_SET, TELEGRAM_BOT_URL } from '@/content/links';
import type { PriceSummary } from '@/lib/api/types';
import { cn } from '@/lib/cn';
import { createT } from '@/lib/i18n/dict';
import type { TKey } from '@/lib/i18n/dict';
import { pick } from '@/lib/i18n/lang';
import type { Lang, LocalizedText } from '@/lib/i18n/lang';

import styles from './about.module.css';
import { ABOUT } from './copy';
import { OrganizerForm } from '@/components/feedback/OrganizerForm';

import { Credits } from './Credits';
import type { CreditsResult } from './manifest';

const SECTION_IDS = ['principles', 'model', 'collect', 'verify', 'dedup', 'ai', 'prototype', 'demo', 'organizers', 'credits', 'team'] as const;

const DEDUP_STEPS: readonly TKey[] = ['about.dedup.step1', 'about.dedup.step2', 'about.dedup.step3', 'about.dedup.step4'];

const PRICE_ROWS: readonly { kind: PriceSummary['kind']; price: PriceSummary }[] = [
  { kind: 'free', price: { kind: 'free' } },
  // Цена для примера плашки «от N ₽»: показывает вид подписи, а не цену события.
  { kind: 'from', price: { kind: 'from', amount_minor: 50000 } },
  { kind: 'unknown', price: { kind: 'unknown' } },
];

export type AboutDocProps = {
  lang: Lang;
  credits: CreditsResult;
};

export function AboutDoc({ lang, credits }: AboutDocProps) {
  const t = createT(lang);
  const p = (text: LocalizedText) => pick(text, lang);
  const toc: TocItem[] = SECTION_IDS.map((id) => ({ id, label: p(ABOUT.toc[id]) }));

  const compareRows = [
    ...ABOUT.prototype.rows,
    {
      topic: ABOUT.prototype.channelsTopic,
      design: ABOUT.prototype.channelsDesign,
      now: TELEGRAM_BOT_IS_SET ? ABOUT.prototype.channelsNowBot : ABOUT.prototype.channelsNowNoBot,
    },
  ];
  const columns = ABOUT.prototype.columns;

  return (
    <DocLayout toc={<Toc items={toc} />}>
      {/* --------------------------------------------------------- Принципы */}
      <DocSection id="principles" title={p(ABOUT.toc.principles)} order={0}>
        <dl className={cn(docs.defs, styles.principles)}>
          {ABOUT.principles.rows.map((row) => (
            <div key={row.name.ru} className={docs.defRow}>
              <dt>{p(row.name)}</dt>
              <dd>{p(row.text)}</dd>
            </div>
          ))}
        </dl>
      </DocSection>

      {/* ----------------------------------------------- Событие, сеанс, цена */}
      <DocSection id="model" title={p(ABOUT.toc.model)}>
        <p className={`t-lead ${docs.lead}`}>{p(ABOUT.model.lead)}</p>
        <ol className={styles.tree}>
          {ABOUT.model.levels.map((level, depth) => (
            <li
              key={level.id}
              className={styles.level}
              style={{ '--depth': depth } as CSSProperties}
              data-depth={depth > 0 ? depth : undefined}
            >
              <span className={styles.levelName}>{p(level.name)}</span>
              <span className={`t-body ${styles.levelText}`}>{p(level.text)}</span>
            </li>
          ))}
        </ol>
        <DocSubsection title={p(ABOUT.model.relatedTitle)}>
          <Bullets items={ABOUT.model.related} lang={lang} />
        </DocSubsection>
      </DocSection>

      {/* ------------------------------------------------------ Сбор событий */}
      <DocSection id="collect" title={t('about.collect.title')}>
        <Prose>{t('about.collect.text')}</Prose>
        <Bullets items={ABOUT.collect.points} lang={lang} />
      </DocSection>

      {/* ---------------------------------------------------------- Проверка */}
      <DocSection id="verify" title={t('about.verify.title')}>
        <Prose>{t('about.verify.text')}</Prose>
        <DocSubsection id="statuses" title={p(ABOUT.verify.statusesTitle)}>
          <Prose>{p(ABOUT.verify.statusesNote)}</Prose>
          <StatusTable lang={lang} />
        </DocSubsection>
        <DocSubsection id="prices" title={p(ABOUT.verify.pricesTitle)}>
          <Prose>{t('about.verify.unknown')}</Prose>
          <table className={docs.table} role="table" data-about-prices>
            <thead role="rowgroup">
              <tr role="row">
                <th scope="col" role="columnheader" className="t-caps">
                  {p(ABOUT.verify.columns.label)}
                </th>
                <th scope="col" role="columnheader" className="t-caps">
                  {p(ABOUT.verify.columns.meaning)}
                </th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {PRICE_ROWS.map((row) => (
                <tr key={row.kind} role="row">
                  <td role="cell" className={docs.cellName}>
                    <PriceTag price={row.price} />
                  </td>
                  <td role="cell">{p(ABOUT.verify.price[row.kind])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </DocSubsection>
        <DocSubsection title={p(ABOUT.verify.freshnessTitle)}>
          <Prose>{p(ABOUT.verify.freshness)}</Prose>
        </DocSubsection>
      </DocSection>

      {/* ------------------------------------------------------ Дедупликация */}
      <DocSection id="dedup" title={t('about.dedup.title')}>
        <Prose>{t('about.dedup.text')}</Prose>
        <DocSubsection title={p(ABOUT.dedup.stepsTitle)}>
          <ol className={cn('t-body', docs.bullets, docs.numbered)}>
            {DEDUP_STEPS.map((key) => (
              <li key={key}>{t(key)}</li>
            ))}
          </ol>
        </DocSubsection>
        <DocSubsection id="outcomes" title={p(ABOUT.dedup.outcomesTitle)}>
          <Prose>{p(ABOUT.dedup.outcomesLead)}</Prose>
          <ol className={styles.outcomes}>
            {ABOUT.dedup.outcomes.map((outcome) => (
              <li key={outcome.id} className={styles.outcome} data-outcome={outcome.id}>
                <span className={styles.glyph} aria-hidden="true">
                  {outcome.glyph}
                </span>
                <div className={styles.outcomeBody}>
                  <h4 className={styles.outcomeTitle}>{p(outcome.title)}</h4>
                  <dl className={styles.outcomeFacts}>
                    <div>
                      <dt className="t-caps">{p(ABOUT.dedup.whenLabel)}</dt>
                      <dd className="t-body">{p(outcome.when)}</dd>
                    </div>
                    <div>
                      <dt className="t-caps">{p(ABOUT.dedup.resultLabel)}</dt>
                      <dd className="t-body">{p(outcome.result)}</dd>
                    </div>
                  </dl>
                </div>
              </li>
            ))}
          </ol>
        </DocSubsection>
        <p className={styles.principle}>{t('about.dedup.principle')}</p>
        <DocSubsection title={p(ABOUT.dedup.undoTitle)}>
          <Prose>{p(ABOUT.dedup.undo)}</Prose>
        </DocSubsection>
        <DocSubsection id="sources-count" title={p(ABOUT.dedup.counterTitle)}>
          <Prose>{p(ABOUT.dedup.counter)}</Prose>
        </DocSubsection>
      </DocSection>

      {/* --------------------------------------------------------- ИИ-подбор */}
      <DocSection id="ai" title={t('about.ai.title')}>
        <Prose>{t('about.ai.text')}</Prose>
        <Prose>{p(ABOUT.ai.clarify)}</Prose>
        <Prose>{rich(p(ABOUT.ai.prototype))}</Prose>
        <div>
          <Button href={ROUTES.ask} variant="ghost">
            {p(ABOUT.ai.action)}
            <ArrowRight size={16} weight="bold" aria-hidden="true" />
          </Button>
        </div>
      </DocSection>

      {/* -------------------------------------------- Устройство и прототип */}
      <DocSection id="prototype" title={p(ABOUT.toc.prototype)}>
        <Prose>{p(ABOUT.prototype.lead)}</Prose>
        <table className={cn(docs.table, styles.compare)} role="table" data-compare>
          <thead role="rowgroup">
            <tr role="row">
              <th scope="col" role="columnheader" className="t-caps">
                {p(columns.topic)}
              </th>
              <th scope="col" role="columnheader" className="t-caps">
                {p(columns.design)}
              </th>
              <th scope="col" role="columnheader" className="t-caps">
                {p(columns.now)}
              </th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            {compareRows.map((row) => (
              <tr key={row.topic.ru} role="row">
                <th scope="row" role="rowheader" className={styles.compareTopic}>
                  {p(row.topic)}
                </th>
                <td role="cell" data-label={p(columns.design)}>
                  {rich(p(row.design))}
                </td>
                <td role="cell" data-label={p(columns.now)}>
                  {rich(p(row.now))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </DocSection>

      {/* ------------------------------------------------------- Демо-данные */}
      <DocSection id="demo" title={t('about.demo.title')}>
        <Prose>{t('about.demo.text')}</Prose>
        <div className={styles.split}>
          <div>
            <h3 className={`t-caps ${styles.splitTitle}`}>{p(ABOUT.demo.realTitle)}</h3>
            <Bullets items={ABOUT.demo.real} lang={lang} />
          </div>
          <div>
            <h3 className={`t-caps ${styles.splitTitle}`}>{p(ABOUT.demo.fakeTitle)}</h3>
            <Bullets items={ABOUT.demo.fake} lang={lang} />
          </div>
        </div>
        <Prose>{t('about.demo.source')}</Prose>
        <Prose>{p(ABOUT.demo.links)}</Prose>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <Button href={ROUTES.events} variant="ghost">
            {p(ABOUT.demo.action)}
            <ArrowRight size={16} weight="bold" aria-hidden="true" />
          </Button>
          <Button href={`${ROUTES.developers}#demo`} variant="link">
            {p(ABOUT.demo.apiLink)}
          </Button>
        </div>
      </DocSection>

      {/* -------------------------------------------------- Организаторам */}
      <DocSection id="organizers" title={p(ABOUT.toc.organizers)}>
        <Prose>{p(ABOUT.organizers.text)}</Prose>
        <OrganizerForm defaultKind="organizer_application" className="mt-6" />
      </DocSection>

      {/* ------------------------------------------------- Фото и графика */}
      <DocSection id="credits" title={p(ABOUT.toc.credits)}>
        <Credits credits={credits} lang={lang} />
      </DocSection>

      {/* ---------------------------------------------------- Откуда проект */}
      <DocSection id="team" title={t('about.team.title')}>
        <Prose>{t('about.team.text')}</Prose>
        <DocSubsection title={p(ABOUT.team.channels)}>
          <ul className={styles.channels}>
            <li>
              {TELEGRAM_BOT_IS_SET ? (
                <a href={TELEGRAM_BOT_URL} target="_blank" rel="noopener" className={styles.outLink}>
                  {t('footer.telegram')}
                  <ArrowUpRight size={14} weight="bold" aria-hidden="true" />
                  <span className="visually-hidden"> ({p(ABOUT.team.newTab)})</span>
                </a>
              ) : (
                <span className={styles.outSoon}>{p(ABOUT.team.botSoon)}</span>
              )}
            </li>
            <li>
              <a href={ROUTES.widget} className={styles.outLink}>
                {t('footer.widget')}
              </a>
            </li>
            <li>
              <a href={ROUTES.apiDocs} className={styles.outLink}>
                {t('footer.api')}
              </a>
            </li>
          </ul>
        </DocSubsection>
        <KuskarBorder height={16} variant="row" className="mt-6 text-fg-muted opacity-60" />
      </DocSection>
    </DocLayout>
  );
}
