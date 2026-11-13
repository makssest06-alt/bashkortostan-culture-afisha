'use client';

/** Вкладка «Заявки»: обращения с формы сайта. Имя и контакт видит только модератор; срок хранения 90 дней. */

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { Button, Chip } from '@/components/ui';
import type { Application } from '@/lib/admin/types';

import { AdminError, adminFetch, jsonBody } from './api';
import { Empty, LoadingRows, Notice } from './bits';
import { stamp } from './format';

const KIND: Record<Application['kind'], string> = {
  organizer_application: 'Заявка на событие',
  correction: 'Уточнение к карточке',
  question: 'Вопрос',
};

export function ApplicationsTab() {
  const [filter, setFilter] = useState<'new' | 'done' | ''>('new');
  const [items, setItems] = useState<Application[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let alive = true;
    adminFetch<{ items: Application[] }>(`/applications${filter ? `?status=${filter}` : ''}`)
      .then(({ data }) => alive && setItems(data.items))
      .catch((caught) => alive && setError(caught instanceof AdminError ? caught.message : 'Не удалось загрузить заявки'));
    return () => {
      alive = false;
    };
  }, [filter, version]);

  const mark = async (id: string, status: Application['status']) => {
    try {
      await adminFetch(`/applications/${id}`, { method: 'PATCH', ...jsonBody({ status }) });
      setVersion((value) => value + 1);
    } catch (caught) {
      setError(caught instanceof AdminError ? caught.message : 'Не удалось сохранить');
    }
  };

  return (
    <section aria-labelledby="applications-heading" className="flex flex-col gap-5">
      <h2 id="applications-heading" className="t-subtitle">
        Заявки и уточнения
      </h2>
      <p className="max-w-[65ch] text-[0.9375rem] text-fg-soft">
        Обращения с формы на странице «О проекте» и в карточках событий. Контакты нужны только для ответа и удаляются через 90 дней.
      </p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Статус обращения">
        <Chip selected={filter === 'new'} onClick={() => setFilter('new')}>Новые</Chip>
        <Chip selected={filter === 'done'} onClick={() => setFilter('done')}>Обработанные</Chip>
        <Chip selected={filter === ''} onClick={() => setFilter('')}>Все</Chip>
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      {!items && !error ? <LoadingRows rows={3} /> : null}
      {items && items.length === 0 ? <Empty title="Обращений нет">Новые появятся здесь сразу после отправки формы.</Empty> : null}
      {items && items.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <li key={item.id} className="flex flex-col gap-2 rounded-sm border border-line px-5 py-4">
              <p className="text-[0.8125rem] text-fg-soft">
                <time dateTime={item.at}>{stamp(item.at)}</time> · {KIND[item.kind]} · {item.id}
              </p>
              {item.event_id ? (
                <Link href={`/admin/events/${item.event_id}`} className="font-medium underline decoration-line-strong underline-offset-4">
                  {item.event_title ?? item.event_id}
                </Link>
              ) : null}
              <p className="text-[0.9375rem] whitespace-pre-line">{item.text}</p>
              <p className="text-[0.875rem] text-fg-soft">
                {item.name}
                {item.organization ? `, ${item.organization}` : ''} · {item.contact}
              </p>
              <div>
                {item.status === 'new' ? (
                  <Button size="sm" variant="ghost" onClick={() => mark(item.id, 'done')}>
                    Отметить обработанным
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => mark(item.id, 'new')}>
                    Вернуть в новые
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
