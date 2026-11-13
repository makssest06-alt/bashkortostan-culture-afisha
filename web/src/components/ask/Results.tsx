'use client';

/**
 * Правая часть рабочей области: карточки с причинами, варианты ослабления условий
 * при пустой выдаче, скелетоны на время первого подбора и примеры запросов в начале.
 */

import { ArrowRight } from '@phosphor-icons/react';
import { useId } from 'react';
import type { CSSProperties } from 'react';

import { KuskarBorder } from '@/components/ornament';
import { DemoDataNotice } from '@/components/shell/DemoDataNotice';
import { Button } from '@/components/ui';
import { eventsHref } from '@/lib/api/params';
import type { Relaxation } from '@/lib/api/types';
import { pick, useT } from '@/lib/i18n';
import type { TKey } from '@/lib/i18n';

import styles from './ask.module.css';
import { askText } from './copy';
import type { AskCopyKey } from './copy';
import { ResultCard, ResultCardSkeleton } from './ResultCard';
import type { SearchView } from './useAskDialog';

const EXAMPLE_KEYS: readonly TKey[] = ['ask.example1', 'ask.example2', 'ask.example3', 'ask.example4'];

export type ResultsMode = 'examples' | 'loading' | 'waiting' | 'view';

/** Заголовок ожидания по числу оставшихся вопросов ассистента. */
function waitingKey(pending: number): AskCopyKey {
  if (pending >= 3) return 'waitingThree';
  if (pending === 2) return 'waitingTwo';
  return 'waitingOne';
}

export type ResultsProps = {
  mode: ResultsMode;
  view: SearchView | null;
  today: string | null;
  /** Сколько сведений ещё не хватает ассистенту (clarify.pending). */
  pendingQuestions: number;
  /** Идёт запрос: выдача притухает, кнопки ждут. */
  busy: boolean;
  onExample: (text: string) => void;
  onRelax: (relaxation: Relaxation) => void;
};

export function Results({ mode, view, today, pendingQuestions, busy, onExample, onRelax }: ResultsProps) {
  const { t, lang } = useT();
  const titleId = useId();

  if (mode === 'examples') {
    return (
      <section className={styles.results} aria-labelledby={titleId} data-ask-examples="">
        <h2 id={titleId} className="t-caps text-fg-muted">
          {t('ask.examples')}
        </h2>
        <p className="mt-2 mb-5 text-[0.9375rem] leading-[1.4] text-fg-soft">{askText('examplesHint', lang)}</p>
        <ul className="border-b border-line">
          {EXAMPLE_KEYS.map((key, index) => {
            const text = t(key);
            return (
              <li key={key}>
                <button
                  type="button"
                  className={styles.example}
                  style={{ '--i': index } as CSSProperties}
                  disabled={busy}
                  // Примеры написаны по-русски: ассистент пока понимает только русский.
                  lang="ru"
                  onClick={() => onExample(text)}
                >
                  <span>{text}</span>
                  <ArrowRight size={22} weight="bold" aria-hidden="true" className={styles.exampleArrow} />
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    );
  }

  if (mode === 'loading') {
    return (
      <section className={styles.results} aria-busy="true" aria-labelledby={titleId} data-ask-loading="">
        <h2 id={titleId} className="visually-hidden">
          {t('common.loading')}
        </h2>
        <ul className={styles.cards}>
          <ResultCardSkeleton />
          <ResultCardSkeleton />
          <ResultCardSkeleton />
        </ul>
      </section>
    );
  }

  if (mode === 'waiting' || !view || !today) {
    return (
      <section className={styles.waiting} aria-labelledby={titleId} data-ask-waiting="">
        <KuskarBorder variant="row" height={16} className="mb-8 text-line-strong" />
        <h2 id={titleId} className="t-subtitle">
          {askText(waitingKey(pendingQuestions), lang)}
        </h2>
        <p className="t-body mt-3 max-w-[44ch] text-fg-soft">{askText('waitingText', lang)}</p>
      </section>
    );
  }

  const { results, total, relaxations, eventsQuery, receivedAt } = view;

  if (total === 0) {
    return (
      <section className={styles.results} aria-busy={busy} aria-labelledby={titleId} data-ask-empty="">
        <div className={styles.cards}>
          {/* На телефоне эта же фраза стоит строкой выше, в реплике ассистента */}
          <h2 id={titleId} className="t-subtitle mb-3 max-lg:hidden">
            {t('empty.title')}
          </h2>
          <p className="t-body max-w-[52ch] text-fg-soft">
            {askText(relaxations.length > 0 ? 'emptyHint' : 'emptyNoOptions', lang)}
          </p>
          {relaxations.length > 0 ? (
            <>
              <h3 className="t-caps mt-8 mb-1 text-fg-muted">{t('ask.relax')}</h3>
              <ul className="border-b border-line">
                {relaxations.map((relaxation) => (
                  <li key={relaxation.codes.join('+')}>
                    <button
                      type="button"
                      className={styles.relax}
                      disabled={busy}
                      data-relaxation={relaxation.code}
                      onClick={() => onRelax(relaxation)}
                    >
                      <span className={styles.relaxLabel}>{pick(relaxation.label, lang)}</span>
                      <span className="flex shrink-0 items-center gap-3 text-fg-soft">
                        <span data-num className="text-[0.9375rem] font-medium whitespace-nowrap">
                          {t('events.count', { count: relaxation.count })}
                        </span>
                        <ArrowRight size={20} weight="bold" aria-hidden="true" className={styles.exampleArrow} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section className={styles.results} aria-busy={busy} aria-labelledby={titleId} data-ask-results="">
      <div className={styles.resultsHead}>
        <h2 id={titleId} className="t-caps text-fg-muted" data-num>
          <span className="visually-hidden">{askText('resultsTitle', lang)}: </span>
          {total > results.length
            ? askText('shown', lang, { shown: results.length, total })
            : t('events.count', { count: total })}
        </h2>
        <DemoDataNotice compact className={styles.demoNotice} />
      </div>

      <ul className={styles.cards}>
        {results.map((result, index) => (
          <ResultCard key={result.event.id} result={result} today={today} now={receivedAt} order={index} />
        ))}
      </ul>

      {eventsQuery && total > results.length ? (
        <p className="border-t border-line pt-5">
          <Button variant="link" href={eventsHref(eventsQuery)} data-ask-show-all="">
            {t('ask.showAll', { count: total })}
          </Button>
        </p>
      ) : null}
    </section>
  );
}
