'use client';

/** Вкладка «Спорные»: очередь карточек, которые нельзя публиковать без проверки (п. 6.1). */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { Button, Field, Input, Select } from '@/components/ui';
import type { ApiEvent } from '@/lib/api/wire';

import { AdminError, adminFetch, jsonBody } from './api';
import { Empty, LoadingRows, Notice, StatusPill } from './bits';
import { categoryLabel, eventWhen } from './format';

interface Item {
  event: ApiEvent & { etag: string };
  reasons: string[];
  duplicate_candidates: string[];
}

type Action = 'publish' | 'keep_draft' | 'cancel' | 'merge';

const DONE: Record<Action, string> = {
  publish: 'опубликована',
  keep_draft: 'оставлена черновиком',
  cancel: 'отменена',
  merge: 'сведена в основную карточку как дубль',
};

function Card({ item, titles, onResolved }: { item: Item; titles: Map<string, string>; onResolved: (message: string) => void }) {
  const [comment, setComment] = useState('');
  const [mergeInto, setMergeInto] = useState(item.duplicate_candidates[0] ?? '');
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { event } = item;

  const resolve = async (action: Action) => {
    setBusy(action);
    setError(null);
    try {
      await adminFetch(`/moderation/${event.id}/resolve`, {
        method: 'POST',
        ...jsonBody({ action, comment: comment || undefined, merge_into: action === 'merge' ? mergeInto : undefined }),
      });
      onResolved(`«${event.title}» ${DONE[action]}`);
    } catch (caught) {
      setError(caught instanceof AdminError ? caught.message : 'Не удалось сохранить решение');
      setBusy(null);
    }
  };

  return (
    <li className="flex flex-col gap-4 rounded-sm border border-line px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href={`/admin/events/${event.id}`} className="t-ui text-fg underline decoration-line-strong underline-offset-4 hover:decoration-fg">
            {event.title}
          </Link>
          <p className="mt-1 text-[0.875rem] text-fg-soft">
            {categoryLabel(event.category)} · {eventWhen(event.date_start, event.time_precision)} · {event.venue}, {event.city}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill status={event.status} />
          <span className="text-[0.8125rem] text-fg-soft tabular-nums">уверенность {Math.round(event.confidence * 100)}%</span>
        </div>
      </div>
      <div>
        <p className="text-[0.8125rem] text-fg-soft">Почему спорная</p>
        <ul className="mt-1 flex list-disc flex-col gap-1 pl-5 text-[0.9375rem]">
          {item.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
        <p className="mt-2 text-[0.8125rem] text-fg-soft">
          Источников: {event.sources.length}
          {event.sources[0] ? ` · основной: ${event.sources[0].title ?? event.source_url}` : ''}
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Комментарий к решению" hint="Попадёт в журнал">
          <Input value={comment} onChange={(change) => setComment(change.target.value)} maxLength={300} />
        </Field>
        {item.duplicate_candidates.length ? (
          <Field label="Дубль какой карточки">
            <Select value={mergeInto} onChange={(change) => setMergeInto(change.target.value)}>
              {item.duplicate_candidates.map((id) => (
                <option key={id} value={id}>
                  {titles.get(id) ?? id}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <div className="flex flex-wrap gap-3">
        <Button onClick={() => resolve('publish')} disabled={busy !== null}>
          {busy === 'publish' ? 'Публикуем…' : 'Опубликовать'}
        </Button>
        <Button variant="ghost" onClick={() => resolve('keep_draft')} disabled={busy !== null}>
          Оставить черновиком
        </Button>
        <Button variant="ghost" onClick={() => resolve('cancel')} disabled={busy !== null}>
          Отменить событие
        </Button>
        {item.duplicate_candidates.length ? (
          <Button variant="ghost" onClick={() => resolve('merge')} disabled={busy !== null || !mergeInto}>
            Свести как дубль
          </Button>
        ) : null}
      </div>
    </li>
  );
}

export function ModerationTab({ onCount }: { onCount: (count: number) => void }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [titles, setTitles] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [version, setVersion] = useState(0);
  const load = useCallback(() => setVersion((value) => value + 1), []);

  useEffect(() => {
    let alive = true;
    Promise.all([adminFetch<{ items: Item[]; total: number }>('/moderation'), adminFetch<{ items: ApiEvent[] }>('/events?page_size=100')])
      .then(([{ data }, { data: all }]) => {
        if (!alive) return;
        setItems(data.items);
        setTitles(new Map(all.items.map((event) => [event.id, `${event.title} (${event.city})`])));
        onCount(data.total);
        setError(null);
      })
      .catch((caught) => {
        if (alive) setError(caught instanceof AdminError ? caught.message : 'Не удалось загрузить очередь');
      });
    return () => {
      alive = false;
    };
  }, [onCount, version]);

  return (
    <section aria-labelledby="moderation-heading" className="flex flex-col gap-5">
      <h2 id="moderation-heading" className="t-subtitle">
        Спорные карточки
      </h2>
      <p className="max-w-[65ch] text-[0.9375rem] text-fg-soft">
        Эти карточки не видны в выдаче. Проверьте причину и решите: опубликовать, оставить черновиком, отменить или свести с уже
        существующей карточкой.
      </p>
      {message ? <Notice tone="ok">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {!items && !error ? <LoadingRows rows={3} /> : null}
      {items && items.length === 0 ? <Empty title="Очередь пуста">Все спорные карточки разобраны.</Empty> : null}
      {items && items.length > 0 ? (
        <ul className="flex flex-col gap-4">
          {items.map((item) => (
            <Card
              key={item.event.id}
              item={item}
              titles={titles}
              onResolved={(text) => {
                setMessage(text);
                load();
              }}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}
