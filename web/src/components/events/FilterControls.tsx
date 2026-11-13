'use client';

/**
 * Группы фильтров каталога: поиск, дата, город, цена, возраст, категория.
 * Один и тот же набор стоит в боковой колонке на компьютере и в выезжающей панели на телефоне.
 * Своего состояния у фильтров нет: значения приходят из адресной строки и уходят в неё же.
 */

import { MagnifyingGlass } from '@phosphor-icons/react';
import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { Chip, Field, Input } from '@/components/ui';
import { AGE_RATINGS, CATEGORIES, CITIES } from '@/data/dictionaries';
import { formatNumber } from '@/lib/api/format';
import type { EventsQuery, Facets } from '@/lib/api/types';
import { cn } from '@/lib/cn';
import { pick, useT } from '@/lib/i18n';

import {
  DATE_PRESET_IDS,
  PRICE_PRESETS,
  parsePriceInput,
  setDateBound,
  setDatePreset,
  setPriceMax,
  setSearch,
  toggleAgeRating,
  toggleAudienceKids,
  toggleCategory,
  toggleCity,
  toggleFreeOnly,
} from './query';
import type { FilterGroup } from './query';

/** Пауза после последнего нажатия клавиши, прежде чем текст уйдёт в адресную строку. */
const TYPING_DELAY_MS = 350;

export type CommitOptions = {
  /**
   * Серия правок одного поля (набор текста, границы своего периода). Записи одной серии подряд
   * занимают один шаг истории браузера.
   */
  series?: 'search' | 'price' | 'date';
};

export type FilterControlsProps = {
  query: EventsQuery;
  /** Счётчики из последнего ответа. Пока их нет, чипы показываются без чисел. */
  facets: Facets | null;
  /** Сегодняшняя дата афиши: раньше неё период выбрать нельзя. */
  today: string | null;
  onChange: (next: EventsQuery, options?: CommitOptions) => void;
  className?: string;
};

function Group({ name, title, children }: { name: FilterGroup; title: string; children: ReactNode }) {
  const titleId = useId();
  return (
    <div
      role="group"
      aria-labelledby={titleId}
      data-filter-group={name}
      className="flex scroll-mt-4 flex-col gap-3 border-t border-line py-5 first:border-t-0 first:pt-0"
    >
      <h3 id={titleId} className="t-caps text-fg-muted">
        {title}
      </h3>
      {children}
    </div>
  );
}

function Count({ value }: { value: number | undefined }) {
  if (value === undefined) return null;
  return (
    <span data-num className="text-[0.8125rem] font-medium opacity-70">
      {value}
    </span>
  );
}

/**
 * Поле с набором текста: черновик живёт в поле, а в адресную строку уходит после паузы.
 * Если значение сменилось снаружи (чип снят, фильтры сброшены), черновик подхватывает его.
 */
function useDraft(value: string, commit: (text: string) => void) {
  const [draft, setDraft] = useState(value);
  const [synced, setSynced] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // К моменту срабатывания таймера условия могли измениться: берём самую свежую функцию записи.
  const latestCommit = useRef(commit);
  useEffect(() => {
    latestCommit.current = commit;
  });

  if (value !== synced) {
    setSynced(value);
    setDraft(value);
  }

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  return {
    draft,
    /** Набор: значение уйдёт после паузы. */
    type(text: string) {
      setDraft(text);
      cancel();
      timer.current = setTimeout(() => latestCommit.current(text), TYPING_DELAY_MS);
    },
    /** Enter или уход из поля: значение уходит сразу. */
    flush(text: string) {
      cancel();
      latestCommit.current(text);
    },
  };
}

export function FilterControls({ query, facets, today, onChange, className }: FilterControlsProps) {
  const { t, lang } = useT();
  const freeId = useId();

  const search = useDraft(query.q ?? '', (text) => {
    if (text.trim() === (query.q ?? '')) return;
    onChange(setSearch(query, text), { series: 'search' });
  });

  const price = useDraft(query.price_max === undefined ? '' : String(query.price_max), (text) => {
    const value = parsePriceInput(text);
    if (value === query.price_max) return;
    onChange(setPriceMax(query, value), { series: 'price' });
  });

  const cityCount = (id: string) => facets?.cities.find((item) => item.id === id)?.count;
  const categoryCount = (id: string) => facets?.categories.find((item) => item.id === id)?.count;
  const ageCount = (id: string) => facets?.age_ratings.find((item) => item.id === id)?.count;

  return (
    <div className={cn('flex flex-col', className)}>
      <Group name="search" title={t('filters.search')}>
        <Field label={t('filters.search')} hideLabel>
          <span className="relative block">
            <MagnifyingGlass
              size={18}
              weight="bold"
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-muted"
            />
            <Input
              type="search"
              inputMode="search"
              enterKeyHint="search"
              autoComplete="off"
              maxLength={100}
              value={search.draft}
              placeholder={t('filters.search.placeholder')}
              onChange={(event) => search.type(event.target.value)}
              onBlur={(event) => search.flush(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') search.flush(event.currentTarget.value);
              }}
              className="pl-10! [&::-webkit-search-cancel-button]:appearance-none"
            />
          </span>
        </Field>
      </Group>

      <Group name="date" title={t('filters.date')}>
        <div className="flex flex-wrap gap-2">
          {DATE_PRESET_IDS.map((preset) => (
            <Chip
              key={preset}
              selected={query.date === preset}
              onClick={() => onChange(setDatePreset(query, preset))}
            >
              {t(`filters.date.${preset}`)}
            </Chip>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t('filters.date.from')}>
            <Input
              type="date"
              value={query.date_from ?? ''}
              min={today ?? undefined}
              onChange={(event) => onChange(setDateBound(query, 'date_from', event.target.value), { series: 'date' })}
              className="min-w-0 px-2.5! [color-scheme:dark] lg:text-[0.9375rem]!"
            />
          </Field>
          <Field label={t('filters.date.to')}>
            <Input
              type="date"
              value={query.date_to ?? ''}
              min={today ?? undefined}
              onChange={(event) => onChange(setDateBound(query, 'date_to', event.target.value), { series: 'date' })}
              className="min-w-0 px-2.5! [color-scheme:dark] lg:text-[0.9375rem]!"
            />
          </Field>
        </div>
      </Group>

      <Group name="city" title={t('filters.city')}>
        <div className="flex flex-wrap gap-2">
          {CITIES.map((city) => {
            const selected = query.city?.includes(city.slug) ?? false;
            const count = cityCount(city.slug);
            return (
              <Chip
                key={city.slug}
                selected={selected}
                disabled={!selected && count === 0}
                onClick={() => onChange(toggleCity(query, city.slug))}
              >
                {pick(city.name, lang)}
                <Count value={count} />
              </Chip>
            );
          })}
        </div>
      </Group>

      <Group name="price" title={t('filters.price')}>
        <Field label={t('filters.price.maxLabel')} hint={t('filters.price.perPerson')}>
          <Input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            maxLength={9}
            value={price.draft}
            placeholder="1500"
            onChange={(event) => price.type(event.target.value.replace(/[^\d\s]/g, ''))}
            onBlur={(event) => price.flush(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') price.flush(event.currentTarget.value);
            }}
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          {PRICE_PRESETS.map((amount) => (
            <Chip
              key={amount}
              selected={query.price_max === amount}
              onClick={() => onChange(setPriceMax(query, query.price_max === amount ? undefined : amount))}
            >
              {t('filters.price.max', { amount: formatNumber(amount) })}
            </Chip>
          ))}
        </div>
        <div className="flex min-h-11 items-center justify-between gap-4">
          <label htmlFor={freeId} className="t-ui flex items-baseline gap-2 text-fg">
            {t('filters.price.freeOnly')}
            <Count value={facets?.price.free} />
          </label>
          <button
            id={freeId}
            type="button"
            role="switch"
            aria-checked={Boolean(query.free_only)}
            onClick={() => onChange(toggleFreeOnly(query))}
            className={cn(
              'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-[background-color,border-color] duration-(--duration-fast) ease-out',
              'before:absolute before:-inset-2 before:content-[""]',
              query.free_only ? 'border-fg bg-fg' : 'border-line-strong bg-transparent',
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'block size-5 rounded-full transition-[translate,background-color] duration-(--duration-fast) ease-out',
                query.free_only ? 'translate-x-6 bg-bg' : 'translate-x-1 bg-fg-soft',
              )}
            />
          </button>
        </div>
      </Group>

      <Group name="age" title={t('filters.age')}>
        <div className="flex flex-wrap gap-2">
          <Chip selected={query.audience === 'kids'} onClick={() => onChange(toggleAudienceKids(query))}>
            {t('filters.audience.kids')}
          </Chip>
          {AGE_RATINGS.map((rating) => {
            const selected = query.age_rating?.includes(rating.id) ?? false;
            const count = ageCount(rating.id);
            return (
              <Chip
                key={rating.id}
                selected={selected}
                disabled={!selected && count === 0}
                onClick={() => onChange(toggleAgeRating(query, rating.id))}
              >
                <span data-num>{rating.id}</span>
                <Count value={count} />
              </Chip>
            );
          })}
        </div>
      </Group>

      <Group name="category" title={t('filters.category')}>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((category) => {
            const selected = query.category?.includes(category.id) ?? false;
            const count = categoryCount(category.id);
            return (
              <Chip
                key={category.id}
                selected={selected}
                disabled={!selected && count === 0}
                onClick={() => onChange(toggleCategory(query, category.id))}
              >
                {pick(category.name, lang)}
                <Count value={count} />
              </Chip>
            );
          })}
        </div>
      </Group>
    </div>
  );
}
