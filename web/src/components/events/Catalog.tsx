'use client';

/**
 * Каталог событий: фильтры, счётчик, активные условия, выдача.
 *
 * Состояние фильтров живёт в адресной строке. Смена условия пишет новый адрес через History API
 * (страница не перезагружается и не прокручивается), а выдачу по этому адресу отдаёт хранилище:
 * первый экран приходит с сервера, остальное догружается из /api/v1/events.
 */

import { SlidersHorizontal } from '@phosphor-icons/react';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { KuskarBorder } from '@/components/ornament';
import { DemoDataNotice } from '@/components/shell/DemoDataNotice';
import { Button, Field, Select } from '@/components/ui';
import { SORTS } from '@/data/dictionaries';
import { parseEventsQuery } from '@/lib/api/params';
import type { EventsListResponse, EventsQuery, Relaxation, SortKey } from '@/lib/api/types';
import { useT } from '@/lib/i18n';
import type { TKey } from '@/lib/i18n';
import { useMediaQuery } from '@/lib/motion';

import { ActiveFilters } from './ActiveFilters';
import styles from './catalog.module.css';
import { EmptyState } from './EmptyState';
import { FilterControls } from './FilterControls';
import type { CommitOptions } from './FilterControls';
import { FilterSheet } from './FilterSheet';
import { HiddenNotice } from './HiddenNotice';
import { buildActiveChips, catalogHref, normalizeQuery, queryKey, resetFilters, setSort } from './query';
import type { FilterGroup } from './query';
import { GridSkeleton, Results, UnknownSection } from './Results';
import { abandon, ensure, getEntry, hideUnknown, loadMore, readyEntry, revealUnknown, seed, subscribe } from './store';
import type { CatalogEntry, UnknownKind } from './store';

const DESKTOP_QUERY = '(min-width: 1024px)';
const UNKNOWN_KINDS: readonly UnknownKind[] = ['price', 'age'];
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled])';

/**
 * Неверное условие в ссылке объясняется словами жителя, без технических значений параметров
 * (п. 6.1: сообщения понятны жителю, а не разработчику).
 */
function invalidKey(field: string): TKey {
  if (field === 'city') return 'events.invalid.city';
  if (field === 'category') return 'events.invalid.category';
  if (/^(date|time)/.test(field)) return 'events.invalid.date';
  if (field === 'price_max' || field === 'free_only' || field === 'free') return 'events.invalid.price';
  if (field === 'age' || field === 'age_rating' || field === 'audience') return 'events.invalid.age';
  return 'events.invalid.other';
}

export type CatalogProps = {
  /** Первая страница выдачи, собранная на сервере. null: параметры адреса не прошли проверку. */
  initial: EventsListResponse | null;
  /** Ключ условий, для которых собрана выдача. */
  initialKey: string;
  /** Момент сборки на сервере: от него считается «проверено N часов назад» без расхождений при гидратации. */
  renderedAt: number;
};

export function Catalog({ initial, initialKey, renderedAt }: CatalogProps) {
  const { t, lang } = useT();
  const searchParams = useSearchParams();
  const resultsId = useId();

  const parsed = useMemo(() => parseEventsQuery(searchParams), [searchParams]);
  const query = useMemo<EventsQuery>(() => (parsed.ok ? normalizeQuery(parsed.value) : {}), [parsed]);
  const key = queryKey(query);
  const valid = parsed.ok;

  const initialEntry = useMemo(
    () => (initial ? readyEntry(initial, renderedAt) : undefined),
    [initial, renderedAt],
  );
  const serverSnapshot = key === initialKey ? initialEntry : undefined;
  const entry = useSyncExternalStore<CatalogEntry | undefined>(
    subscribe,
    () => getEntry(key) ?? serverSnapshot,
    () => serverSnapshot,
  );

  useEffect(() => {
    if (!valid) return;
    if (initialEntry && key === initialKey) seed(initialKey, initialEntry);
    ensure(query);
    return () => abandon(key);
  }, [valid, key, query, initialKey, initialEntry]);

  // Последняя готовая выдача: пока грузится новая, счётчики на фильтрах не исчезают.
  const ready = valid && entry?.status === 'ready' ? entry : undefined;
  const [lastReady, setLastReady] = useState(ready);
  if (ready && ready !== lastReady) setLastReady(ready);

  const response = ready?.response ?? null;
  const facets = (ready ?? lastReady)?.response?.facets ?? null;
  const today = (ready ?? lastReady)?.response?.reference_date ?? null;
  const loading = valid && (!entry || entry.status === 'loading');
  const failed = valid && entry?.status === 'error';

  // ------------------------------------------------------------------ Запись условий в адрес
  // Набор текста и выбор своего периода идут несколькими записями подряд. Первая добавляет шаг истории,
  // следующие из той же серии заменяют его: «Назад» возвращает прежние условия, а не идёт по буквам.
  const series = useRef<{ tag: string; href: string } | null>(null);
  const commit = useCallback((next: EventsQuery, options: CommitOptions = {}) => {
    const href = catalogHref(next);
    const current = `${window.location.pathname}${window.location.search}`;
    if (href === current) return;
    const last = series.current;
    const continues = options.series !== undefined && last?.tag === options.series && last.href === current;
    if (continues) window.history.replaceState(null, '', href);
    else window.history.pushState(null, '', href);
    series.current = options.series ? { tag: options.series, href } : null;
  }, []);

  const reset = useCallback(() => commit(resetFilters(query)), [commit, query]);

  const applyRelaxation = useCallback(
    (relaxation: Relaxation) => {
      if (!relaxation.query) return;
      commit({ ...relaxation.query, sort: query.sort });
    },
    [commit, query.sort],
  );

  // ------------------------------------------------------------------ Панель фильтров на телефоне
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const [sheet, setSheet] = useState<{ open: boolean; group: FilterGroup | null }>({ open: false, group: null });
  const sheetOpen = sheet.open && !isDesktop;
  const sheetButton = useRef<HTMLButtonElement>(null);
  const rail = useRef<HTMLDivElement>(null);
  const closeSheet = useCallback(() => setSheet((current) => ({ ...current, open: false })), []);

  const editGroup = useCallback((group: FilterGroup) => {
    if (!window.matchMedia(DESKTOP_QUERY).matches) {
      setSheet({ open: true, group });
      return;
    }
    const node = rail.current?.querySelector<HTMLElement>(`[data-filter-group="${group}"]`);
    if (!node) return;
    node.scrollIntoView({ block: 'nearest' });
    node.querySelector<HTMLElement>(FOCUSABLE)?.focus({ preventScroll: true });
  }, []);

  const chips = useMemo(() => buildActiveChips(query, t, lang), [query, t, lang]);
  const activeCount = chips.length;

  const countLabel = !valid
    ? t('events.error')
    : response
      ? t('events.found', { count: response.total })
      : failed
        ? t('events.error')
        : t('events.loading');
  const submitLabel = response ? t('events.showResults', { count: response.total }) : t('events.loading');

  const controls = <FilterControls query={query} facets={facets} today={today} onChange={commit} />;

  return (
    <div data-catalog="" data-catalog-status={!valid ? 'invalid' : failed ? 'error' : loading ? 'loading' : 'ready'}>
      <header className="flex flex-col gap-5 pb-6 md:flex-row md:items-end md:justify-between md:gap-12 md:pb-7">
        <div className="flex flex-col gap-3">
          <h1 className="t-heading">{t('events.title')}</h1>
          <p className="t-lead max-w-[52ch] text-fg-soft">{t('events.subtitle')}</p>
        </div>
        <DemoDataNotice className="self-start md:self-end" />
      </header>

      <div className="relative">
        <div className={styles.veil} aria-hidden="true" />
        <KuskarBorder variant="row" height={14} className="text-line-strong" />

        <div className="pt-6 lg:grid lg:grid-cols-[288px_minmax(0,1fr)] lg:gap-x-12 xl:gap-x-14">
          <aside className="hidden lg:block" aria-label={t('filters.title')}>
            <div
              ref={rail}
              data-filter-rail=""
              data-lenis-prevent=""
              className="sticky top-[calc(var(--header-h)+16px)] -mr-3 max-h-[calc(100dvh-var(--header-h)-32px)] overflow-y-auto pr-3 pb-2 [scrollbar-color:var(--color-line-strong)_transparent] [scrollbar-width:thin]"
            >
              {controls}
            </div>
          </aside>

          <section aria-labelledby={resultsId} className="flex min-w-0 flex-col gap-5">
            <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4 border-b border-line pb-5">
              <h2 id={resultsId} className="t-subtitle" aria-live="polite" data-results-count="">
                {countLabel}
              </h2>
              <Field label={t('sort.label')} hideLabel className="w-full sm:w-auto">
                <Select
                  value={query.sort ?? 'date'}
                  onChange={(event) => commit(setSort(query, event.target.value as SortKey))}
                  wrapperClassName="sm:min-w-[240px]"
                  data-sort=""
                >
                  {SORTS.map((sort) => (
                    <option key={sort.id} value={sort.id}>
                      {t(`sort.${sort.id}`)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <ActiveFilters chips={chips} onEdit={editGroup} onRemove={commit} onReset={reset} />

            {ready && response
              ? UNKNOWN_KINDS.map((kind) => (
                  <HiddenNotice
                    key={kind}
                    kind={kind}
                    count={kind === 'price' ? response.hidden_unknown_price : response.hidden_unknown_age}
                    list={ready.unknown[kind]}
                    onShow={() => revealUnknown(query, kind)}
                    onHide={() => hideUnknown(query, kind)}
                  />
                ))
              : null}

            <div className="pt-3">
              {!parsed.ok ? (
                <div role="alert" className="flex max-w-[60ch] flex-col gap-4 pt-6" data-invalid-state="">
                  <p className="t-ui text-fg">{t('events.invalid.title')}</p>
                  <ul className="flex flex-col gap-2">
                    {[...new Set(parsed.issues.map((issue) => invalidKey(issue.field)))].map((key) => (
                      <li key={key} className="t-body text-fg-soft">
                        {t(key)}
                      </li>
                    ))}
                  </ul>
                  <p className="t-body text-fg-soft">{t('events.invalid.hint')}</p>
                  <Button variant="ghost" onClick={() => commit({})} className="self-start">
                    {t('filters.reset')}
                  </Button>
                </div>
              ) : failed ? (
                <div role="alert" className="flex max-w-[60ch] flex-col gap-4 pt-6" data-error-state="">
                  <p className="t-body text-fg-soft">{entry?.error ?? t('common.errorHint')}</p>
                  <Button onClick={() => ensure(query, { force: true })} className="self-start" data-retry="">
                    {t('common.retry')}
                  </Button>
                </div>
              ) : ready && response ? (
                response.total === 0 ? (
                  <EmptyState relaxations={response.relaxations} onApply={applyRelaxation} onReset={reset} />
                ) : (
                  <Results entry={ready} onLoadMore={() => loadMore(query)} />
                )
              ) : (
                <div role="status">
                  <span className="visually-hidden">{t('events.loading')}</span>
                  <GridSkeleton />
                </div>
              )}
            </div>

            {ready && response
              ? UNKNOWN_KINDS.map((kind) => {
                  const list = ready.unknown[kind];
                  if (!list) return null;
                  return (
                    <UnknownSection
                      key={kind}
                      kind={kind}
                      items={list.items}
                      status={list.status}
                      count={kind === 'price' ? response.hidden_unknown_price : response.hidden_unknown_age}
                      today={response.reference_date}
                      now={ready.fetchedAt}
                    />
                  );
                })
              : null}

            <div className="pointer-events-none sticky bottom-4 mt-4 flex justify-center lg:hidden">
              <button
                ref={sheetButton}
                type="button"
                aria-haspopup="dialog"
                aria-expanded={sheetOpen}
                onClick={() => setSheet({ open: true, group: null })}
                data-open-filters=""
                className="pointer-events-auto inline-flex min-h-12 items-center gap-2.5 rounded-sm bg-fg px-5 text-[1rem] leading-[1.2] font-semibold text-bg shadow-[0_10px_30px_oklch(0.1_0.01_40/0.65)] transition-[scale,background-color] duration-(--duration-press) ease-out hover:bg-fg-soft active:scale-[0.97]"
              >
                <SlidersHorizontal size={20} weight="bold" aria-hidden="true" />
                {t('events.filtersButton')}
                {activeCount > 0 ? (
                  <>
                    <span
                      data-num
                      aria-hidden="true"
                      className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-bg px-1.5 text-[0.8125rem] font-semibold text-fg"
                    >
                      {activeCount}
                    </span>
                    <span className="visually-hidden">{t('events.filtersActive', { count: activeCount })}</span>
                  </>
                ) : null}
              </button>
            </div>
          </section>
        </div>
      </div>

      <FilterSheet
        open={sheetOpen}
        onClose={closeSheet}
        focusGroup={sheet.group}
        returnFocusRef={sheetButton}
        submitLabel={submitLabel}
        onReset={activeCount > 0 ? reset : undefined}
      >
        {controls}
      </FilterSheet>
    </div>
  );
}
