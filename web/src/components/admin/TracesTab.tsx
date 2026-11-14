'use client';

/** Вкладка «Трассы ИИ»: журнал вызовов ассистента (ТЗ п. 7.4). */

import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui';
import type { AgentTraceDetail, AgentTraceList, AgentTraceSummary } from '@/lib/admin/types';

import { AdminError, adminFetch } from './api';
import { Empty, LoadingRows, Notice } from './bits';
import { stamp } from './format';

export function TracesTab() {
  const [items, setItems] = useState<AgentTraceSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AgentTraceDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await adminFetch<AgentTraceList>('/traces?limit=50');
      setItems(Array.isArray(data.items) ? data.items : []);
      setTotal(typeof data.total === 'number' ? data.total : 0);
    } catch (caught) {
      setError(caught instanceof AdminError ? caught.message : 'Не удалось загрузить трассы агента');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    adminFetch<AgentTraceList>('/traces?limit=50')
      .then(({ data }) => {
        if (!active) return;
        setItems(Array.isArray(data.items) ? data.items : []);
        setTotal(typeof data.total === 'number' ? data.total : 0);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setError(caught instanceof AdminError ? caught.message : 'Не удалось загрузить трассы агента');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const openDetail = async (id: string) => {
    setDetailLoading(true);
    try {
      const { data } = await adminFetch<AgentTraceDetail>(`/traces/${id}`);
      setSelected(data);
    } catch (caught) {
      setError(caught instanceof AdminError ? caught.message : 'Не удалось загрузить детали трассы');
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <section aria-labelledby="traces-heading" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="traces-heading" className="t-subtitle">
            Трассы ИИ-агента ({total})
          </h2>
          <p className="mt-1 text-[0.875rem] text-fg-soft">
            Запрос (без ПДн), план, вызовы инструментов, id событий-оснований, задержка и стоимость.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void loadList()} disabled={loading}>
          Обновить
        </Button>
      </div>

      {error ? <Notice tone="error">{error}</Notice> : null}

      {loading ? (
        <LoadingRows rows={4} />
      ) : items.length === 0 ? (
        <Empty title="Трасс пока нет">
          Задайте вопрос в разделе «Подобрать» или боту при подключённом бэкенде — здесь появится трасса каждого ответа.
        </Empty>
      ) : (
        <div className="overflow-x-auto rounded-sm border border-line">
          <table className="w-full border-collapse text-left text-[0.875rem]">
            <thead className="bg-surface/60 text-[0.8125rem] text-fg-soft">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Время</th>
                <th scope="col" className="px-3 py-2 font-medium">Канал</th>
                <th scope="col" className="px-3 py-2 font-medium">Движок / модель</th>
                <th scope="col" className="px-3 py-2 font-medium">Действие</th>
                <th scope="col" className="px-3 py-2 font-medium">Запрос</th>
                <th scope="col" className="px-3 py-2 font-medium text-right">Время, мс</th>
                <th scope="col" className="px-3 py-2 font-medium text-right">₽</th>
                <th scope="col" className="px-3 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-t border-line align-top hover:bg-surface/40">
                  <td className="px-3 py-2 whitespace-nowrap text-fg-soft">{stamp(item.created_at)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{item.channel}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {item.model ? `${item.engine} (${item.model})` : item.engine}
                    {item.fallback_used ? ' · fallback' : ''}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{item.action}</td>
                  <td className="px-3 py-2 max-w-[32ch] truncate">{item.user_query_masked || '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{item.duration_ms}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {item.cost_rub !== null ? item.cost_rub.toFixed(4) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <Button variant="ghost" size="sm" onClick={() => void openDetail(item.id)}>
                      Детали
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detailLoading ? <LoadingRows rows={2} /> : null}

      {selected ? (
        <div className="rounded-sm border border-line bg-surface/30 p-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="t-ui text-fg">Трасса {selected.id}</h3>
            <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
              Закрыть
            </Button>
          </div>
          <dl className="grid gap-2 text-[0.875rem] sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-fg-soft">Промпт</dt>
              <dd>{selected.prompt_version ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-fg-soft">Токены</dt>
              <dd>{selected.token_usage ? JSON.stringify(selected.token_usage) : '—'}</dd>
            </div>
            <div>
              <dt className="text-fg-soft">Основания (id)</dt>
              <dd>{selected.grounding_ids.length ? selected.grounding_ids.join(', ') : '—'}</dd>
            </div>
            <div>
              <dt className="text-fg-soft">Ошибка</dt>
              <dd>{selected.error ?? 'нет'}</dd>
            </div>
          </dl>
          {selected.steps.length > 0 ? (
            <div>
              <p className="text-[0.8125rem] text-fg-soft mb-1">Шаги инструментов ({selected.steps.length})</p>
              <ul className="flex flex-col gap-1.5 text-[0.8125rem]">
                {selected.steps.map((step) => (
                  <li key={step.step} className="rounded-xs border border-line px-3 py-2 font-mono">
                    #{step.step} {step.tool} ({step.duration_ms} мс) · {step.ok ? 'ok' : step.code ?? 'err'} · args:{' '}
                    {JSON.stringify(step.args)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {selected.plan ? (
            <div>
              <p className="text-[0.8125rem] text-fg-soft mb-1">План и ограничения</p>
              <pre className="overflow-x-auto rounded-xs border border-line p-2 text-[0.75rem]">
                {JSON.stringify(selected.plan, null, 2)}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
