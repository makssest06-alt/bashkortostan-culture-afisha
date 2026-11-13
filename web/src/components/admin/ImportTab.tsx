'use client';

/** Вкладка «Импорт»: CSV или JSON, отчёт «добавлено, обновлено, отклонено и почему», история загрузок. */

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent, FormEvent } from 'react';

import { Button, Field, Textarea } from '@/components/ui';
import type { ImportReport } from '@/lib/admin/types';
import { cn } from '@/lib/cn';

import { AdminError, adminFetch } from './api';
import { Empty, Notice } from './bits';
import { reasonText, stamp } from './format';

/** Шаблон CSV: колонки п. 8.1 и одна условная строка-пример. */
const TEMPLATE = [
  'title,category,date_start,date_end,city,venue,address,price_min,price_max,is_free,age_limit,language,tags,org_link,source_url,description',
  '"Пример: вечер камерной музыки",концерт,2026-12-05 19:00,2026-12-05 20:30,Уфа,"Башкирская государственная филармония им. Х. Ахметова",,500,900,нет,6,русский,"камерная музыка;скрипка",,https://example.ru/afisha/1,"Условная строка: замените своими данными"',
].join('\n');

function Summary({ report }: { report: ImportReport }) {
  const rejectedCount = Array.isArray(report.rejected) ? report.rejected.length : 0;
  const cells: [string, number, string?][] = [
    ['Получено строк', report.received],
    ['Добавлено', report.added, 'text-status-ok'],
    ['Обновлено', report.updated],
    ['Источник добавлен к карточке', report.merged ?? 0],
    ['Без изменений', report.unchanged],
    ['Отклонено', rejectedCount, rejectedCount ? 'text-status-cancelled' : undefined],
  ];
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-line bg-line sm:grid-cols-3 xl:grid-cols-6">
      {cells.map(([label, value, tone]) => (
        <div key={label} className="bg-bg px-4 py-3">
          <dt className="text-[0.8125rem] text-fg-soft">{label}</dt>
          <dd className={cn('mt-1 text-[1.75rem] leading-none font-semibold tabular-nums', tone)}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ReportView({ report, onOpenModeration }: { report: ImportReport; onOpenModeration: () => void }) {
  const rejected = Array.isArray(report.rejected) ? report.rejected : [];
  const disputed = Array.isArray(report.disputed) ? report.disputed : [];
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="t-ui text-fg">
          Отчёт об импорте {report.file_name ? `«${report.file_name}»` : ''}
        </h3>
        <p className="mt-1 text-[0.8125rem] text-fg-soft">
          {stamp(report.at)} · {report.actor} · формат {report.format.toUpperCase()} · {report.import_id}
        </p>
      </div>
      <Summary report={report} />

      {rejected.length ? (
        <div>
          <h4 className="t-ui mb-3 text-fg">Отклонено и почему</h4>
          <div className="overflow-x-auto rounded-sm border border-line">
            <table className="w-full border-collapse text-left text-[0.9375rem]">
              <thead className="bg-surface/60 text-[0.8125rem] text-fg-soft">
                <tr>
                  <th scope="col" className="w-20 px-4 py-2 font-medium">Строка</th>
                  <th scope="col" className="px-4 py-2 font-medium">Причина</th>
                </tr>
              </thead>
              <tbody>
                {rejected.map((item) => (
                  <tr key={`${item.row}-${item.reason_code}`} className="border-t border-line align-top">
                    <td className="px-4 py-2 tabular-nums">{item.row}</td>
                    <td className="px-4 py-2">{item.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {disputed.length ? (
        <div>
          <h4 className="t-ui mb-3 text-fg">Спорные: сохранены черновиками и ждут модерации</h4>
          <ul className="flex flex-col gap-2">
            {disputed.map((item) => (
              <li key={item.id} className="rounded-sm border border-line px-4 py-3">
                <Link href={`/admin/events/${item.id}`} className="font-medium underline decoration-line-strong underline-offset-4 hover:decoration-fg">
                  Строка {item.row}: {item.title}
                </Link>
                <p className="mt-1 text-[0.875rem] text-fg-soft">
                  {(Array.isArray(item.reasons) ? item.reasons : []).map(reasonText).join('; ')}
                </p>
              </li>
            ))}
          </ul>
          <button type="button" onClick={onOpenModeration} className="mt-3 text-[0.9375rem] underline underline-offset-4">
            Открыть очередь спорных
          </button>
        </div>
      ) : null}

      {report.rows?.length ? (
        <details className="rounded-sm border border-line px-4 py-3">
          <summary className="cursor-pointer t-ui">Все принятые строки ({report.rows.length})</summary>
          <ul className="mt-3 flex flex-col gap-1.5 text-[0.9375rem]">
            {report.rows.map((row) => (
              <li key={`${row.row}-${row.id}`}>
                Строка {row.row}:{' '}
                {row.id ? (
                  <Link href={`/admin/events/${row.id}`} className="underline decoration-line-strong underline-offset-4">
                    {row.title}
                  </Link>
                ) : (
                  row.title
                )}{' '}
                <span className="text-fg-soft">
                  · {{ added: 'добавлено', updated: 'обновлено', merged: 'добавлен источник', unchanged: 'без изменений' }[row.outcome]}
                  {row.note ? ` · ${row.note}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

export function ImportTab({ onOpenModeration }: { onOpenModeration: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [pasted, setPasted] = useState('');
  const [pasteMode, setPasteMode] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AdminError | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [history, setHistory] = useState<ImportReport[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const templateHref = useMemo(() => `data:text/csv;charset=utf-8,${encodeURIComponent(`﻿${TEMPLATE}`)}`, []);

  const loadHistory = () =>
    adminFetch<{ items: ImportReport[] }>('/imports')
      .then(({ data }) => setHistory(data.items))
      .catch(() => undefined);

  useEffect(() => {
    void loadHistory();
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!pasteMode && !file) {
      setError(new AdminError(400, 'validation_error', 'Выберите файл CSV или JSON', [{ field: 'file', message: 'Выберите файл CSV или JSON' }]));
      return;
    }
    if (pasteMode && !pasted.trim()) {
      setError(new AdminError(400, 'validation_error', 'Вставьте содержимое CSV или JSON', [{ field: 'file', message: 'Вставьте содержимое CSV или JSON' }]));
      return;
    }
    setBusy(true);
    try {
      let init: RequestInit;
      if (pasteMode) {
        const isJson = /^\s*[[{]/.test(pasted);
        init = { method: 'POST', body: pasted, headers: { 'Content-Type': isJson ? 'application/json' : 'text/csv; charset=utf-8' } };
      } else {
        const form = new FormData();
        form.append('file', file as File);
        init = { method: 'POST', body: form };
      }
      const { data } = await adminFetch<ImportReport>('/imports', init);
      setReport(data);
      void loadHistory();
    } catch (caught) {
      setError(caught instanceof AdminError ? caught : new AdminError(0, 'unknown', 'Импорт не удался'));
    } finally {
      setBusy(false);
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const dropped = event.dataTransfer.files?.[0];
    if (dropped) {
      setFile(dropped);
      setPasteMode(false);
    }
  };

  return (
    <section aria-labelledby="import-heading" className="flex flex-col gap-8">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <form onSubmit={submit} noValidate className="flex flex-col gap-5">
          <h2 id="import-heading" className="t-subtitle">
            Импорт событий
          </h2>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Способ загрузки">
            <button
              type="button"
              aria-pressed={!pasteMode}
              onClick={() => setPasteMode(false)}
              className={cn('min-h-11 rounded-sm border px-4', !pasteMode ? 'border-fg bg-fg text-bg' : 'border-line-strong hover:bg-hover')}
            >
              Файл
            </button>
            <button
              type="button"
              aria-pressed={pasteMode}
              onClick={() => setPasteMode(true)}
              className={cn('min-h-11 rounded-sm border px-4', pasteMode ? 'border-fg bg-fg text-bg' : 'border-line-strong hover:bg-hover')}
            >
              Вставить текстом
            </button>
          </div>

          {pasteMode ? (
            <Field label="Содержимое CSV или JSON" error={error?.fieldErrors().file}>
              <Textarea value={pasted} onChange={(event) => setPasted(event.target.value)} rows={10} spellCheck={false} className="font-mono text-[0.8125rem]" />
            </Field>
          ) : (
            <div
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={cn(
                'flex flex-col items-start gap-3 rounded-sm border border-dashed px-5 py-6 transition-colors duration-150',
                dragging ? 'border-fg bg-hover' : 'border-line-strong',
              )}
            >
              <label htmlFor="import-file" className="t-ui text-fg">
                Файл CSV или JSON до 2 МБ
              </label>
              <input
                ref={inputRef}
                id="import-file"
                type="file"
                accept=".csv,.json,text/csv,application/json"
                aria-describedby={error?.fieldErrors().file ? 'import-file-error' : 'import-file-hint'}
                aria-invalid={error?.fieldErrors().file ? true : undefined}
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                className="w-full text-[0.9375rem] file:mr-4 file:min-h-11 file:cursor-pointer file:rounded-sm file:border file:border-line-strong file:bg-transparent file:px-4 file:text-fg"
              />
              <p id="import-file-hint" className="text-[0.8125rem] text-fg-soft">
                Можно перетащить файл сюда. {file ? `Выбран: ${file.name}` : ''}
              </p>
              {error?.fieldErrors().file ? (
                <p id="import-file-error" className="text-[0.875rem] text-status-cancelled">
                  {error.fieldErrors().file}
                </p>
              ) : null}
            </div>
          )}

          {error && !error.fieldErrors().file ? <Notice tone="error">{error.message}</Notice> : null}
          <div className="flex flex-wrap items-center gap-4">
            <Button type="submit" disabled={busy}>
              {busy ? 'Загружаем…' : 'Загрузить'}
            </Button>
            <a href={templateHref} download="afisha-import-template.csv" className="text-[0.9375rem] underline underline-offset-4">
              Скачать шаблон CSV
            </a>
          </div>
        </form>

        <aside className="rounded-sm border border-line bg-surface/40 px-5 py-4 text-[0.875rem] leading-[1.55] text-fg-soft">
          <h3 className="t-ui mb-2 text-fg">Как устроен импорт</h3>
          <ul className="flex list-disc flex-col gap-1.5 pl-4">
            <li>Колонки по п. 8.1 ТЗ: title, category, date_start, city, venue, source_url обязательны. Русские заголовки тоже понимаются.</li>
            <li>Повторная загрузка того же файла ничего не меняет: у каждой строки есть хеш.</li>
            <li>То же событие из другого источника не создаёт дубль: источник добавляется к карточке.</li>
            <li>Пустая цена значит «не указана», а не «бесплатно».</li>
            <li>Спорные строки сохраняются черновиками и попадают в очередь модерации.</li>
          </ul>
        </aside>
      </div>

      {report ? <ReportView report={report} onOpenModeration={onOpenModeration} /> : null}

      <div>
        <h3 className="t-ui mb-3 text-fg">История импортов</h3>
        {history.length === 0 ? (
          <Empty title="Импортов ещё не было">Загрузите файл, и отчёт появится здесь.</Empty>
        ) : (
          <ul className="flex flex-col divide-y divide-line rounded-sm border border-line">
            {history.map((item) => (
              <li key={item.import_id}>
                <button type="button" onClick={() => setReport(item)} className="flex w-full flex-col items-start gap-1 px-4 py-3 text-left hover:bg-hover">
                  <span className="font-medium">
                    {item.file_name ?? 'Вставленный текст'} · {stamp(item.at)} · {item.actor}
                  </span>
                  <span className="text-[0.8125rem] text-fg-soft">
                    получено {item.received}, добавлено {item.added}, обновлено {item.updated}, источников {item.merged ?? 0}, без
                    изменений {item.unchanged}, отклонено {item.rejected.length}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
