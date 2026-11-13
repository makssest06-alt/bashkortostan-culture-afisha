'use client';

/**
 * Редактор одного условия. Открывается под строкой чипов (не окном поверх страницы),
 * собирает patch и отдаёт его наверх: выдача обновляется без повторного ввода фразы.
 */

import { useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent, ReactNode } from 'react';

import { Button, Chip, Field, Input, Select } from '@/components/ui';
import { AGE_RATINGS, CATEGORIES, CITIES, isAgeRating, isCategoryId, isCityId } from '@/data/dictionaries';
import type { AgeRating, CategoryId, ChipKind, CityId, Constraints, ConstraintsPatch } from '@/lib/api/types';
import { pick, useT } from '@/lib/i18n';
import type { Lang, TFunction } from '@/lib/i18n';

import styles from './ask.module.css';
import { askText } from './copy';
import type { AskCopyKey } from './copy';
import {
  TIME_PRESETS,
  WHOLE_REGION,
  ageRatingPatch,
  budgetPatch,
  categoryPatch,
  cityPatch,
  datePatch,
  freeOnlyPatch,
  isFutureDate,
  parseAdults,
  parseAges,
  parseAmount,
  participantsPatch,
  presetRange,
  queryPatch,
  timePatch,
} from './patches';
import type { BudgetScope, DatePreset, TimePreset } from './patches';

const MAX_QUERY_LENGTH = 100;

export type ChipEditorProps = {
  id: string;
  kind: ChipKind;
  constraints: Constraints;
  /** Сегодняшняя дата афиши: от неё считаются «сегодня», «завтра» и «выходные». */
  today: string;
  busy: boolean;
  onApply: (patch: ConstraintsPatch) => void;
  onClose: () => void;
};

/** Как называется условие в заголовке редактора и в строке ленты. */
export function kindLabel(kind: ChipKind, t: TFunction, lang: Lang): string {
  switch (kind) {
    case 'city':
      return t('filters.city');
    case 'date':
      return askText('kindDate', lang);
    case 'time':
      return askText('kindTime', lang);
    case 'budget':
      return askText('kindBudget', lang);
    case 'participants':
      return askText('kindParticipants', lang);
    case 'category':
      return t('filters.category');
    case 'age_rating':
      return t('filters.age');
    case 'query':
      return askText('queryWords', lang);
    default:
      return '';
  }
}

type FormProps = Omit<ChipEditorProps, 'id' | 'kind' | 'onClose'> & { actions: (canApply?: boolean) => ReactNode };

function submitOf(run: () => void) {
  return (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    run();
  };
}

function CityForm({ constraints, onApply, actions }: FormProps) {
  const { t, lang } = useT();
  const current = constraints.hard.cities?.[0];
  const [value, setValue] = useState<CityId | typeof WHOLE_REGION>(
    current && isCityId(current) ? current : constraints.hard.region ? WHOLE_REGION : CITIES[0].slug,
  );
  return (
    <form className={styles.editorForm} onSubmit={submitOf(() => onApply(cityPatch(value)))}>
      <Field label={t('filters.city')} hideLabel>
        <Select
          value={value}
          onChange={(event) => {
            const next = event.target.value;
            setValue(isCityId(next) ? next : WHOLE_REGION);
          }}
          data-autofocus=""
        >
          {CITIES.map((city) => (
            <option key={city.slug} value={city.slug}>
              {pick(city.name, lang)}
            </option>
          ))}
          <option value={WHOLE_REGION}>{t('filters.city.all')}</option>
        </Select>
      </Field>
      {actions()}
    </form>
  );
}

const DATE_PRESETS: { id: DatePreset; key: 'filters.date.today' | 'filters.date.tomorrow' | 'filters.date.weekend' }[] = [
  { id: 'today', key: 'filters.date.today' },
  { id: 'tomorrow', key: 'filters.date.tomorrow' },
  { id: 'weekend', key: 'filters.date.weekend' },
];

function DateForm({ constraints, today, busy, onApply, actions }: FormProps) {
  const { t, lang } = useT();
  const current = constraints.hard.date;
  const [value, setValue] = useState(current && current.from === current.to ? current.from : '');
  const [error, setError] = useState<string | null>(null);

  const apply = (): void => {
    if (!isFutureDate(value, today)) {
      setError(askText('badDate', lang));
      return;
    }
    onApply(datePatch(value));
  };

  return (
    <form className={styles.editorForm} onSubmit={submitOf(apply)} noValidate>
      <div className={styles.presets}>
        {DATE_PRESETS.map((preset, index) => {
          const range = presetRange(preset.id, today);
          const selected = current?.from === range.from && current.to === range.to;
          return (
            <Chip
              key={preset.id}
              selected={selected}
              disabled={busy}
              onClick={() => onApply(datePatch(range.from, range.to))}
              {...(index === 0 ? { className: 'js-autofocus' } : {})}
            >
              {t(preset.key)}
            </Chip>
          );
        })}
      </div>
      <Field label={askText('day', lang)} error={error}>
        <Input
          type="date"
          min={today}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setError(null);
          }}
        />
      </Field>
      {actions(value !== '')}
    </form>
  );
}

const TIME_OPTIONS: { id: TimePreset; key: AskCopyKey }[] = [
  { id: 'morning', key: 'morning' },
  { id: 'daytime', key: 'daytime' },
  { id: 'evening', key: 'evening' },
];

function TimeForm({ constraints, busy, onApply, actions }: FormProps) {
  const { lang } = useT();
  const current = constraints.hard.time;
  return (
    <div className={styles.editorForm}>
      <div className={styles.presets}>
        {TIME_OPTIONS.map((option, index) => {
          const range = TIME_PRESETS[option.id];
          const selected = current?.start_from === range.start_from && current.start_to === range.start_to;
          return (
            <Chip
              key={option.id}
              selected={selected}
              disabled={busy}
              onClick={() => onApply(timePatch(option.id))}
              {...(index === 0 ? { className: 'js-autofocus' } : {})}
            >
              {askText(option.key, lang)}
            </Chip>
          );
        })}
      </div>
      {actions(false)}
    </div>
  );
}

function BudgetForm({ constraints, busy, onApply, actions }: FormProps) {
  const { t, lang } = useT();
  const { hard } = constraints;
  const [scope, setScope] = useState<BudgetScope>(hard.max_total_price !== undefined ? 'total' : 'person');
  const [amount, setAmount] = useState(String(hard.max_total_price ?? hard.max_price_per_person ?? ''));
  const [error, setError] = useState<string | null>(null);

  const apply = (): void => {
    const parsed = parseAmount(amount);
    if (parsed === null) {
      setError(askText('badAmount', lang));
      return;
    }
    onApply(budgetPatch(parsed, scope));
  };

  return (
    <form className={styles.editorForm} onSubmit={submitOf(apply)} noValidate>
      <div className={styles.editorPair}>
        <Field label={t('filters.price.maxLabel')} error={error}>
          <Input
            inputMode="numeric"
            autoComplete="off"
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value);
              setError(null);
            }}
            data-autofocus=""
          />
        </Field>
        <Field label={askText('scope', lang)}>
          <Select value={scope} onChange={(event) => setScope(event.target.value === 'total' ? 'total' : 'person')}>
            <option value="person">{t('filters.price.perPerson')}</option>
            <option value="total">{askText('scopeTotal', lang)}</option>
          </Select>
        </Field>
      </div>
      <div className={styles.presets}>
        <Chip selected={Boolean(hard.free_only)} disabled={busy} onClick={() => onApply(freeOnlyPatch())}>
          {t('filters.price.freeOnly')}
        </Chip>
      </div>
      {actions()}
    </form>
  );
}

function ParticipantsForm({ constraints, onApply, actions }: FormProps) {
  const { lang } = useT();
  const current = constraints.hard.participants;
  const [adults, setAdults] = useState(current?.adults !== undefined ? String(current.adults) : '');
  const [ages, setAges] = useState((current?.children_ages ?? []).join(', '));
  const [adultsError, setAdultsError] = useState<string | null>(null);
  const [agesError, setAgesError] = useState<string | null>(null);

  const apply = (): void => {
    const parsedAdults = parseAdults(adults);
    const parsedAges = parseAges(ages);
    setAdultsError(parsedAdults === undefined ? askText('badAdults', lang) : null);
    setAgesError(parsedAges === null ? askText('badAges', lang) : null);
    if (parsedAdults === undefined || parsedAges === null) return;
    onApply(participantsPatch({ adults: parsedAdults, childAges: parsedAges }, constraints));
  };

  return (
    <form className={styles.editorForm} onSubmit={submitOf(apply)} noValidate>
      <div className={styles.editorPair}>
        <Field label={askText('childAges', lang)} hint={askText('childAgesHint', lang)} error={agesError}>
          <Input
            inputMode="numeric"
            autoComplete="off"
            value={ages}
            onChange={(event) => {
              setAges(event.target.value);
              setAgesError(null);
            }}
            data-autofocus=""
          />
        </Field>
        <Field label={askText('adults', lang)} error={adultsError}>
          <Input
            inputMode="numeric"
            autoComplete="off"
            value={adults}
            onChange={(event) => {
              setAdults(event.target.value);
              setAdultsError(null);
            }}
          />
        </Field>
      </div>
      {actions()}
    </form>
  );
}

function CategoryForm({ constraints, onApply, actions }: FormProps) {
  const { t, lang } = useT();
  const current = constraints.hard.categories_any?.[0];
  const [value, setValue] = useState<CategoryId>(current && isCategoryId(current) ? current : CATEGORIES[0].id);
  return (
    <form className={styles.editorForm} onSubmit={submitOf(() => onApply(categoryPatch(value)))}>
      <Field label={t('filters.category')} hideLabel>
        <Select
          value={value}
          onChange={(event) => {
            if (isCategoryId(event.target.value)) setValue(event.target.value);
          }}
          data-autofocus=""
        >
          {CATEGORIES.map((category) => (
            <option key={category.id} value={category.id}>
              {pick(category.name, lang)}
            </option>
          ))}
        </Select>
      </Field>
      {actions()}
    </form>
  );
}

function AgeRatingForm({ constraints, onApply, actions }: FormProps) {
  const { t, lang } = useT();
  const current = constraints.hard.required_age_rating;
  const [value, setValue] = useState<AgeRating>(current && isAgeRating(current) ? current : AGE_RATINGS[0].id);
  return (
    <form className={styles.editorForm} onSubmit={submitOf(() => onApply(ageRatingPatch(value)))}>
      <Field label={t('filters.age')} hideLabel>
        <Select
          value={value}
          onChange={(event) => {
            if (isAgeRating(event.target.value)) setValue(event.target.value);
          }}
          data-autofocus=""
        >
          {AGE_RATINGS.map((rating) => (
            <option key={rating.id} value={rating.id}>
              {pick(rating.label, lang)}
            </option>
          ))}
        </Select>
      </Field>
      {actions()}
    </form>
  );
}

function QueryForm({ constraints, onApply, actions }: FormProps) {
  const { lang } = useT();
  const [value, setValue] = useState(constraints.soft.semantic_query ?? '');
  const [error, setError] = useState<string | null>(null);

  const apply = (): void => {
    const text = value.replace(/\s+/g, ' ').trim();
    if (!text) {
      setError(askText('badQuery', lang));
      return;
    }
    onApply(queryPatch(text));
  };

  return (
    <form className={styles.editorForm} onSubmit={submitOf(apply)} noValidate>
      <Field label={askText('queryWords', lang)} hideLabel error={error}>
        <Input
          value={value}
          maxLength={MAX_QUERY_LENGTH}
          autoComplete="off"
          onChange={(event) => {
            setValue(event.target.value);
            setError(null);
          }}
          data-autofocus=""
        />
      </Field>
      {actions()}
    </form>
  );
}

export function ChipEditor({ id, kind, constraints, today, busy, onApply, onClose }: ChipEditorProps) {
  const { t, lang } = useT();
  const rootRef = useRef<HTMLDivElement>(null);
  const label = kindLabel(kind, t, lang);

  // Фокус уходит в первое поле редактора: с клавиатуры не надо искать, где он открылся.
  useEffect(() => {
    const root = rootRef.current;
    const target = root?.querySelector<HTMLElement>('[data-autofocus], .js-autofocus');
    target?.focus({ preventScroll: true });
  }, [kind]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    onClose();
  };

  const actions = (canApply = true): ReactNode => (
    <div className={styles.editorActions}>
      {canApply ? (
        <Button type="submit" size="sm" disabled={busy}>
          {t('filters.apply')}
        </Button>
      ) : null}
      <Button variant="ghost" size="sm" onClick={onClose}>
        {askText('cancel', lang)}
      </Button>
    </div>
  );

  const form: FormProps = { constraints, today, busy, onApply, actions };

  return (
    <div
      ref={rootRef}
      id={id}
      role="group"
      aria-label={t('ask.chipEdit', { label })}
      className={styles.editor}
      onKeyDown={onKeyDown}
      data-chip-editor={kind}
    >
      <p className="t-caps mb-3 text-fg-muted" aria-hidden="true">
        {label}
      </p>
      {kind === 'city' ? <CityForm {...form} /> : null}
      {kind === 'date' ? <DateForm {...form} /> : null}
      {kind === 'time' ? <TimeForm {...form} /> : null}
      {kind === 'budget' ? <BudgetForm {...form} /> : null}
      {kind === 'participants' ? <ParticipantsForm {...form} /> : null}
      {kind === 'category' ? <CategoryForm {...form} /> : null}
      {kind === 'age_rating' ? <AgeRatingForm {...form} /> : null}
      {kind === 'query' ? <QueryForm {...form} /> : null}
    </div>
  );
}
