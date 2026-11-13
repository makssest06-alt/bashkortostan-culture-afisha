'use client';

/**
 * Правка события модератором. Отправляются только изменённые поля с заголовком If-Match:
 * если карточку успели изменить, сервер ответит 412, и правка не затрёт чужую.
 */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';

import { Button, Field, Input, Select, Textarea } from '@/components/ui';
import { CATEGORIES } from '@/data/dictionaries';
import type { EventStatus } from '@/lib/api/types';
import type { ApiEvent } from '@/lib/api/wire';
import { cn } from '@/lib/cn';

import { AdminError, adminFetch, jsonBody } from './api';
import { AuditList } from './AuditList';
import { DisputedPill, LoadingRows, Notice, StatusPill } from './bits';
import { FIELD_LABEL, STATUS_LABEL, eventWhen, stamp } from './format';

type AdminEvent = ApiEvent & { etag: string };

interface FormState {
  title: string;
  description: string;
  category: string;
  status: EventStatus;
  age_limit: string;
  price_min: string;
  price_max: string;
  is_free: boolean;
  address: string;
  org_link: string;
  language: string;
  source_url: string;
  tags: string;
  date_start: string;
  date_end: string;
}

/** «2026-11-14T19:00:00+05:00» → «2026-11-14 19:00» для поля ввода. */
function toInput(iso: string | null): string {
  return iso ? iso.slice(0, 16).replace('T', ' ') : '';
}

function formOf(event: AdminEvent): FormState {
  return {
    title: event.title,
    description: event.description,
    category: event.category,
    status: event.status,
    age_limit: event.age_limit === null ? '' : String(event.age_limit),
    price_min: event.price_min === null ? '' : String(event.price_min),
    price_max: event.price_max === null ? '' : String(event.price_max),
    is_free: event.is_free,
    address: event.address ?? '',
    org_link: event.org_link ?? '',
    language: event.language ?? '',
    source_url: event.source_url,
    tags: event.tags.join(', '),
    date_start: toInput(event.date_start),
    date_end: toInput(event.date_end),
  };
}

/** Изменённые поля в формате API: пустые строки становятся null, числа числами. */
function changedFields(before: FormState, after: FormState, datesEditable: boolean): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const keys = Object.keys(after) as (keyof FormState)[];
  for (const key of keys) {
    if (before[key] === after[key]) continue;
    if ((key === 'date_start' || key === 'date_end') && !datesEditable) continue;
    const value = after[key];
    if (key === 'tags') patch.tags = String(value).split(',').map((tag) => tag.trim()).filter(Boolean);
    else if (key === 'is_free') patch.is_free = value;
    else if (typeof value === 'string' && value.trim() === '' && key !== 'description') patch[key] = null;
    else patch[key] = value;
  }
  return patch;
}

const STATUSES: EventStatus[] = ['published', 'draft', 'cancelled'];

export function EventEditor({ id }: { id: string }) {
  const [event, setEvent] = useState<AdminEvent | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [loadError, setLoadError] = useState<AdminError | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ tone: 'ok' | 'error' | 'info'; text: string } | null>(null);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [auditKey, setAuditKey] = useState(0);

  const load = useCallback(async () => {
    try {
      const { data } = await adminFetch<AdminEvent>(`/events/${id}`);
      setEvent(data);
      setForm(formOf(data));
      setConflict(false);
      setLoadError(null);
    } catch (caught) {
      setLoadError(caught instanceof AdminError ? caught : new AdminError(0, 'unknown', 'Не удалось загрузить событие'));
    }
  }, [id]);

  useEffect(() => {
    let alive = true;
    adminFetch<AdminEvent>(`/events/${id}`)
      .then(({ data }) => {
        if (!alive) return;
        setEvent(data);
        setForm(formOf(data));
      })
      .catch((caught) => {
        if (alive) setLoadError(caught instanceof AdminError ? caught : new AdminError(0, 'unknown', 'Не удалось загрузить событие'));
      });
    return () => {
      alive = false;
    };
  }, [id]);

  if (loadError) {
    return (
      <Notice tone="error">
        {loadError.status === 401 ? 'Войдите в админку, чтобы править события. ' : `${loadError.message}. `}
        <Link href="/admin" className="underline underline-offset-4">
          Вернуться в админку
        </Link>
      </Notice>
    );
  }
  if (!event || !form) return <LoadingRows rows={6} />;

  const datesEditable = !event.synthetic;
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm({ ...form, [key]: value });
  const patch = changedFields(formOf(event), form, datesEditable);
  const dirty = Object.keys(patch).length > 0;

  const save = async (submit: FormEvent) => {
    submit.preventDefault();
    if (!dirty) return;
    setBusy(true);
    setErrors({});
    setMessage(null);
    try {
      const { data } = await adminFetch<{ event: AdminEvent; changes: { field: string }[] }>(`/events/${event.id}`, {
        method: 'PATCH',
        ...jsonBody(patch, { 'If-Match': event.etag }),
      });
      setEvent(data.event);
      setForm(formOf(data.event));
      setAuditKey((value) => value + 1);
      setMessage({
        tone: 'ok',
        text: `Сохранено: ${data.changes.map((change) => FIELD_LABEL[change.field] ?? change.field).join(', ') || 'без изменений'}`,
      });
    } catch (caught) {
      const error = caught instanceof AdminError ? caught : new AdminError(0, 'unknown', 'Не удалось сохранить');
      if (error.status === 412 || error.status === 409) setConflict(true);
      setErrors(error.fieldErrors());
      setMessage({ tone: 'error', text: error.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
      <form onSubmit={save} noValidate className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={event.status} />
          {event.review?.disputed ? <DisputedPill /> : null}
          <span className="text-[0.875rem] text-fg-soft">{event.synthetic ? 'демо-событие' : 'импорт или ручной ввод'}</span>
          {event.status !== 'draft' ? (
            <Link href={`/events/${event.id}`} className="ml-auto text-[0.9375rem] underline underline-offset-4">
              Открыть на сайте
            </Link>
          ) : null}
        </div>
        {event.review?.disputed ? (
          <Notice tone="info">Карточка спорная: {event.review.reasons.join('; ')}. Решение принимается во вкладке «Спорные».</Notice>
        ) : null}

        <fieldset className="flex flex-col gap-3">
          <legend className="t-ui mb-1 text-fg">Статус</legend>
          <div className="flex flex-wrap gap-2">
            {STATUSES.map((status) => (
              <label
                key={status}
                className={cn(
                  'flex min-h-11 cursor-pointer items-center gap-2 rounded-sm border px-4 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-fg',
                  form.status === status ? 'border-fg bg-fg text-bg' : 'border-line-strong hover:bg-hover',
                )}
              >
                <input type="radio" name="status" value={status} checked={form.status === status} onChange={() => set('status', status)} className="sr-only" />
                {STATUS_LABEL[status]}
              </label>
            ))}
          </div>
          <p className="text-[0.8125rem] text-fg-soft">Отменённое событие пропадает из выдачи, но открывается по прямой ссылке с пометкой «Отменено». Черновик виден только здесь.</p>
        </fieldset>

        <Field label="Название" error={errors.title}>
          <Input value={form.title} onChange={(change) => set('title', change.target.value)} maxLength={200} required />
        </Field>
        <div className="grid gap-5 md:grid-cols-2">
          <Field label="Категория" error={errors.category}>
            <Select value={form.category} onChange={(change) => set('category', change.target.value)}>
              {CATEGORIES.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name_one.ru}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Возрастное ограничение" error={errors.age_limit}>
            <Select value={form.age_limit} onChange={(change) => set('age_limit', change.target.value)}>
              <option value="">Не указано</option>
              {[0, 6, 12, 16, 18].map((age) => (
                <option key={age} value={String(age)}>
                  {age}+
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {datesEditable ? (
          <div className="grid gap-5 md:grid-cols-2">
            <Field label="Начало" hint="ГГГГ-ММ-ДД ЧЧ:ММ, время Уфы" error={errors.date_start}>
              <Input value={form.date_start} onChange={(change) => set('date_start', change.target.value)} inputMode="numeric" />
            </Field>
            <Field label="Окончание" hint="Можно оставить пустым" error={errors.date_end}>
              <Input value={form.date_end} onChange={(change) => set('date_end', change.target.value)} inputMode="numeric" />
            </Field>
          </div>
        ) : (
          <p className="text-[0.9375rem] text-fg-soft">
            Ближайший сеанс: {eventWhen(event.date_start, event.time_precision)}. Даты демо-событий считаются от сегодняшнего дня и не
            правятся.
          </p>
        )}

        <fieldset className="flex flex-col gap-4">
          <legend className="t-ui mb-1 text-fg">Цена, рубли</legend>
          <div className="grid gap-5 md:grid-cols-2">
            <Field label="Цена от" hint="Пусто: цена не указана" error={errors.price_min}>
              <Input value={form.price_min} onChange={(change) => set('price_min', change.target.value)} inputMode="numeric" disabled={form.is_free} />
            </Field>
            <Field label="Цена до" error={errors.price_max}>
              <Input value={form.price_max} onChange={(change) => set('price_max', change.target.value)} inputMode="numeric" disabled={form.is_free} />
            </Field>
          </div>
          <label className="flex min-h-11 items-center gap-3 text-[0.9375rem]">
            <input type="checkbox" checked={form.is_free} onChange={(change) => set('is_free', change.target.checked)} className="size-5 accent-[var(--color-fg)]" />
            Бесплатный вход (только если так написано в источнике)
          </label>
          {errors.is_free ? <p className="text-[0.875rem] text-status-cancelled" role="alert">{errors.is_free}</p> : null}
        </fieldset>

        <Field label="Описание" error={errors.description}>
          <Textarea value={form.description} onChange={(change) => set('description', change.target.value)} rows={5} maxLength={4000} />
        </Field>
        <div className="grid gap-5 md:grid-cols-2">
          <Field label="Метки через запятую" hint="Например: дети, джаз, башкирский язык" error={errors.tags}>
            <Input value={form.tags} onChange={(change) => set('tags', change.target.value)} />
          </Field>
          <Field label="Язык мероприятия" error={errors.language}>
            <Select value={form.language} onChange={(change) => set('language', change.target.value)}>
              <option value="">Не указан</option>
              <option value="ru">Русский</option>
              <option value="ba">Башкирский</option>
              <option value="tt">Татарский</option>
            </Select>
          </Field>
        </div>
        <Field label="Адрес площадки" error={errors.address}>
          <Input value={form.address} onChange={(change) => set('address', change.target.value)} maxLength={300} autoComplete="street-address" />
        </Field>
        <div className="grid gap-5 md:grid-cols-2">
          <Field label="Ссылка на источник" error={errors.source_url}>
            <Input type="url" value={form.source_url} onChange={(change) => set('source_url', change.target.value)} />
          </Field>
          <Field label="Ссылка на билеты или организатора" error={errors.org_link}>
            <Input type="url" value={form.org_link} onChange={(change) => set('org_link', change.target.value)} />
          </Field>
        </div>

        {message ? (
          <Notice tone={message.tone}>
            {message.text}
            {conflict ? (
              <>
                {' '}
                <button type="button" onClick={load} className="underline underline-offset-4">
                  Загрузить свежую версию
                </button>
              </>
            ) : null}
          </Notice>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={!dirty || busy}>
            {busy ? 'Сохраняем…' : 'Сохранить'}
          </Button>
          <Button type="button" variant="ghost" disabled={!dirty || busy} onClick={() => setForm(formOf(event))}>
            Отменить правки
          </Button>
          {dirty ? <span className="text-[0.875rem] text-fg-soft">Изменено полей: {Object.keys(patch).length}</span> : null}
        </div>
      </form>

      <aside className="flex flex-col gap-8">
        <section aria-labelledby="origin-heading">
          <h2 id="origin-heading" className="t-ui mb-3 text-fg">Происхождение</h2>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-[0.875rem]">
            <dt className="text-fg-soft">id</dt>
            <dd className="font-mono text-[0.8125rem] break-all">{event.id}</dd>
            <dt className="text-fg-soft">Тип источника</dt>
            <dd>{event.source_type}</dd>
            <dt className="text-fg-soft">Проверено</dt>
            <dd>{event.verified_at ? stamp(event.verified_at) : 'нет'}</dd>
            <dt className="text-fg-soft">Уверенность</dt>
            <dd className="tabular-nums">{Math.round(event.confidence * 100)}%</dd>
            <dt className="text-fg-soft">Ключ дублей</dt>
            <dd className="font-mono text-[0.8125rem] break-all">{event.dedup_key}</dd>
            <dt className="text-fg-soft">Хеш записи</dt>
            <dd className="font-mono text-[0.8125rem] break-all">{event.source_hash.slice(0, 16)}…</dd>
            <dt className="text-fg-soft">Изменено</dt>
            <dd>{stamp(event.updated_at)}</dd>
          </dl>
        </section>
        <section aria-labelledby="sources-heading">
          <h2 id="sources-heading" className="t-ui mb-3 text-fg">Источники ({event.sources.length})</h2>
          <ul className="flex flex-col gap-2 text-[0.875rem]">
            {event.sources.map((source) => (
              <li key={source.source_hash} className="rounded-sm border border-line px-3 py-2">
                <p className="font-medium">{source.title ?? source.source_url}</p>
                <p className="text-fg-soft">
                  {source.source_type}
                  {source.verified_at ? ` · проверено ${stamp(source.verified_at)}` : ''}
                </p>
                <a href={source.source_url} target="_blank" rel="noopener noreferrer" className="break-all underline underline-offset-4">
                  {source.source_url}
                </a>
              </li>
            ))}
          </ul>
        </section>
        <section aria-labelledby="history-heading">
          <h2 id="history-heading" className="t-ui mb-3 text-fg">Журнал по событию</h2>
          <AuditList entityId={event.id} pageSize={10} refreshKey={auditKey} />
        </section>
      </aside>
    </div>
  );
}
