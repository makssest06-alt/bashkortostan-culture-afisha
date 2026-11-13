'use client';

/** Вкладка «События»: все карточки любого статуса, фильтры и переход к правке. */

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { Chip, Field, Input } from '@/components/ui';
import type { EventStatus } from '@/lib/api/types';
import type { ApiEvent } from '@/lib/api/wire';

import { AdminError, adminFetch } from './api';
import { DisputedPill, Empty, LoadingRows, Notice, Pager, StatusPill } from './bits';
import { categoryLabel, eventWhen, stamp, STATUS_LABEL } from './format';

type Counts = Record<'all' | EventStatus | 'disputed', number>;

interface ListResponse {
  items: (ApiEvent & { etag: string })[];
  total: number;
  page: number;
  total_pages: number;
  counts: Counts;
}

type StatusFilter = '' | EventStatus;

const STATUS_FILTERS: StatusFilter[] = ['', 'published', 'draft', 'cancelled'];

export function EventsTab() {
  const [status, setStatus] = useState<StatusFilter>('');
  const [disputed, setDisputed] = useState(false);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ListResponse | null>(null);
  const [error, setError] = useState<AdminError | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const params = new URLSearchParams({ page: String(page), page_size: '25' });
    if (status) params.set('status', status);
    if (disputed) params.set('disputed', 'true');
    if (debounced) params.set('q', debounced);
    let alive = true;
    adminFetch<ListResponse>(`/events?${params}`)
      .then(({ data: response }) => {
        if (!alive) return;
        setData(response);
        setError(null);
      })
      .catch((caught) => alive && setError(caught instanceof AdminError ? caught : new AdminError(0, 'unknown', 'Не удалось загрузить события')));
    return () => {
      alive = false;
    };
  }, [status, disputed, debounced, page, reload]);

  const pick = (next: StatusFilter) => {
    setStatus(next);
    setPage(1);
  };

  return (
    <section aria-labelledby="events-heading" className="flex flex-col gap-6">
      <h2 id="events-heading" className="visually-hidden">
        События
      </h2>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Статус">
          {STATUS_FILTERS.map((value) => (
            <Chip key={value || 'all'} selected={status === value} onClick={() => pick(value)}>
              {value ? STATUS_LABEL[value] : 'Все'}
              {data ? <span className="ml-1 tabular-nums opacity-70">{data.counts[value || 'all']}</span> : null}
            </Chip>
          ))}
          <Chip
            selected={disputed}
            onClick={() => {
              setDisputed(!disputed);
              setPage(1);
            }}
          >
            Только спорные{data ? <span className="ml-1 tabular-nums opacity-70">{data.counts.disputed}</span> : null}
          </Chip>
        </div>
        <Field label="Поиск по названию, площадке, городу" className="lg:w-80">
          <Input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
          />
        </Field>
      </div>

      {error ? (
        <Notice tone="error">
          {error.message}{' '}
          <button type="button" className="underline underline-offset-4" onClick={() => setReload((value) => value + 1)}>
            Повторить
          </button>
        </Notice>
      ) : null}

      {!data && !error ? <LoadingRows /> : null}

      {data && data.items.length === 0 ? (
        <Empty title="Ничего не нашлось">Сбросьте фильтры или измените запрос.</Empty>
      ) : null}

      {data && data.items.length > 0 ? (
        <div className="overflow-x-auto rounded-sm border border-line">
          <table className="w-full border-collapse text-left text-[0.9375rem]">
            <caption className="visually-hidden">События: найдено {data.total}</caption>
            <thead className="bg-surface/60 text-[0.8125rem] text-fg-soft">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Событие</th>
                <th scope="col" className="hidden px-4 py-3 font-medium md:table-cell">Когда</th>
                <th scope="col" className="hidden px-4 py-3 font-medium lg:table-cell">Категория</th>
                <th scope="col" className="px-4 py-3 font-medium">Статус</th>
                <th scope="col" className="hidden px-4 py-3 font-medium lg:table-cell">Источники</th>
                <th scope="col" className="hidden px-4 py-3 font-medium xl:table-cell">Изменено</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((event) => (
                <tr key={event.id} className="border-t border-line align-top hover:bg-hover">
                  <td className="px-4 py-3">
                    <Link href={`/admin/events/${event.id}`} className="font-medium text-fg underline decoration-line-strong underline-offset-4 hover:decoration-fg">
                      {event.title}
                    </Link>
                    <p className="mt-1 text-[0.8125rem] text-fg-soft">
                      {event.venue}, {event.city}
                      <span className="md:hidden"> · {eventWhen(event.date_start, event.time_precision)}</span>
                    </p>
                    {!event.synthetic ? <p className="mt-1 text-[0.8125rem] text-fg-muted">импорт</p> : null}
                  </td>
                  <td className="hidden px-4 py-3 whitespace-nowrap md:table-cell">{eventWhen(event.date_start, event.time_precision)}</td>
                  <td className="hidden px-4 py-3 lg:table-cell">{categoryLabel(event.category)}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      <StatusPill status={event.status} />
                      {event.review?.disputed ? <DisputedPill /> : null}
                    </div>
                  </td>
                  <td className="hidden px-4 py-3 tabular-nums lg:table-cell">{event.sources.length}</td>
                  <td className="hidden px-4 py-3 whitespace-nowrap text-fg-soft xl:table-cell">{stamp(event.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {data ? <Pager page={data.page} totalPages={data.total_pages} onPage={setPage} /> : null}
    </section>
  );
}
