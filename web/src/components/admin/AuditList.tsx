'use client';

/** Журнал изменений: кто, когда и что изменил (п. 6.1). Используется во вкладке и в карточке события. */

import Link from 'next/link';
import { useEffect, useState } from 'react';

import type { AuditEntry } from '@/lib/admin/types';

import { AdminError, adminFetch } from './api';
import { Empty, LoadingRows, Notice, Pager } from './bits';
import { ACTION_LABEL, FIELD_LABEL, stamp, valueText } from './format';

interface AuditResponse {
  items: AuditEntry[];
  total: number;
  page: number;
  total_pages: number;
}

export function AuditList({ entityId, pageSize = 30, refreshKey = 0 }: { entityId?: string; pageSize?: number; refreshKey?: number }) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AuditResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
    if (entityId) params.set('entity_id', entityId);
    let alive = true;
    adminFetch<AuditResponse>(`/audit?${params}`)
      .then(({ data: response }) => alive && setData(response))
      .catch((caught) => alive && setError(caught instanceof AdminError ? caught.message : 'Не удалось загрузить журнал'));
    return () => {
      alive = false;
    };
  }, [entityId, page, pageSize, refreshKey]);

  if (error) return <Notice tone="error">{error}</Notice>;
  if (!data) return <LoadingRows rows={3} />;
  if (data.items.length === 0) return <Empty title="Изменений пока нет">Здесь появятся правки, импорт и решения модератора.</Empty>;

  return (
    <>
      <ol className="flex flex-col divide-y divide-line rounded-sm border border-line">
        {data.items.map((entry) => (
          <li key={entry.id} className="flex flex-col gap-1.5 px-4 py-3">
            <p className="text-[0.8125rem] text-fg-soft">
              <time dateTime={entry.at}>{stamp(entry.at)}</time> · <span className="text-fg">{entry.actor}</span> ·{' '}
              {ACTION_LABEL[entry.action] ?? entry.action}
            </p>
            {!entityId && entry.entity_type === 'event' ? (
              <Link href={`/admin/events/${entry.entity_id}`} className="font-medium underline decoration-line-strong underline-offset-4 hover:decoration-fg">
                {entry.entity_title ?? entry.entity_id}
              </Link>
            ) : !entityId ? (
              <p className="font-medium">{entry.entity_title ?? entry.entity_id}</p>
            ) : null}
            {entry.changes.length ? (
              <ul className="flex flex-col gap-0.5 text-[0.9375rem]">
                {entry.changes.map((change) => (
                  <li key={change.field}>
                    <span className="text-fg-soft">{FIELD_LABEL[change.field] ?? change.field}:</span>{' '}
                    <span className="visually-hidden">было</span>
                    <span className="line-through decoration-fg-muted">{valueText(change.field, change.from)}</span>{' '}
                    <span aria-hidden="true">→</span>
                    <span className="visually-hidden">стало</span> {valueText(change.field, change.to)}
                  </li>
                ))}
              </ul>
            ) : null}
            {entry.note ? <p className="text-[0.875rem] text-fg-soft">{entry.note}</p> : null}
          </li>
        ))}
      </ol>
      <Pager page={data.page} totalPages={data.total_pages} onPage={setPage} />
    </>
  );
}
