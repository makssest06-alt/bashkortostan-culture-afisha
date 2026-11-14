'use client';

/**
 * Вкладка «ИИ»: рубильник ИИ-ассистента. Выключение мгновенно отвечает 503 на
 * /assistant/query, а сайт и бот переходят на обычный поиск. Каталог, админка
 * и трассы продолжают работать. Переменная ASSISTANT_DISABLED=1 имеет приоритет.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui';
import { cn } from '@/lib/cn';

import { AdminError, adminFetch, jsonBody } from './api';
import { Notice } from './bits';

interface SettingsResponse {
  ai_enabled: boolean;
  ai_env_locked: boolean;
  engine: string;
  llm_configured: boolean;
  updated_at: string | null;
  updated_by: string | null;
}

const ENGINE_LABELS: Record<string, string> = {
  rules: 'rules-v2 — детерминированные правила',
  llm: 'llm — внешняя модель с откатом на правила',
  hybrid: 'hybrid — правила, LLM только на неоднозначных запросах',
};

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString('ru-RU');
}

export function AiTab() {
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    adminFetch<SettingsResponse>('/settings')
      .then(({ data }) => {
        if (!active) return;
        setSettings(data);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setError(caught instanceof AdminError ? caught.message : 'Не удалось загрузить настройки');
      });
    return () => {
      active = false;
    };
  }, [version]);

  const toggle = async () => {
    if (!settings || busy || settings.ai_env_locked) return;
    setBusy(true);
    setSaved(false);
    try {
      const { data } = await adminFetch<SettingsResponse>('/settings', {
        method: 'PATCH',
        ...jsonBody({ ai_enabled: !settings.ai_enabled }),
      });
      setSettings(data);
      setError(null);
      setSaved(true);
    } catch (caught) {
      setError(caught instanceof AdminError ? caught.message : 'Не удалось сохранить настройку');
    } finally {
      setBusy(false);
    }
  };

  if (!settings) {
    return error ? (
      <Notice tone="error">{error}</Notice>
    ) : (
      <p className="text-fg-soft">Загружаем настройки…</p>
    );
  }

  const changedAt = formatDate(settings.updated_at);

  return (
    <section aria-labelledby="ai-heading" className="flex max-w-2xl flex-col gap-5">
      <h2 id="ai-heading" className="t-subtitle">
        ИИ-ассистент
      </h2>
      <p className="text-[0.9375rem] leading-[1.5] text-fg-soft">
        Рубильник включает и выключает свободный подбор: <code>/ask</code> на сайте и диалог в Telegram-боте.
        Каталог, фильтры, API и админка работают в любом случае.
      </p>

      {settings.ai_env_locked ? (
        <Notice tone="info">
          Ассистент жёстко выключен переменной <code>ASSISTANT_DISABLED=1</code> на сервере. Рубильник недоступен,
          пока переменную не уберут из <code>.env</code> и сервис не перезапустят.
        </Notice>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-4 rounded-sm border border-line bg-surface/60 px-4 py-4">
        <div className="flex flex-col gap-1">
          <span className="text-[1rem] font-medium text-fg">
            {settings.ai_enabled ? 'Ассистент включён' : 'Ассистент выключен'}
          </span>
          <span className="text-[0.875rem] text-fg-soft">
            {settings.ai_enabled
              ? 'Свободные запросы обрабатываются, трассы пишутся.'
              : 'Новые запросы получают 503, сайт и бот показывают обычный поиск.'}
          </span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={settings.ai_enabled}
          aria-label="ИИ-ассистент"
          disabled={busy || settings.ai_env_locked}
          onClick={toggle}
          className={cn(
            'relative inline-flex h-8 w-14 shrink-0 items-center rounded-full border transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50',
            settings.ai_enabled ? 'border-status-ok/70 bg-status-ok/30' : 'border-line-strong bg-surface-2',
          )}
        >
          <span
            className={cn(
              'inline-block h-6 w-6 rounded-full bg-fg shadow-sm transition-transform duration-150',
              settings.ai_enabled ? 'translate-x-7' : 'translate-x-1',
            )}
          />
        </button>
      </div>

      <dl className="grid grid-cols-1 gap-3 text-[0.9375rem] sm:grid-cols-2">
        <div className="flex flex-col gap-0.5">
          <dt className="text-fg-soft">Движок</dt>
          <dd className="text-fg">{ENGINE_LABELS[settings.engine] ?? settings.engine}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-fg-soft">Внешняя модель</dt>
          <dd className="text-fg">{settings.llm_configured ? 'ключ задан' : 'ключ не задан — работают правила'}</dd>
        </div>
        {changedAt ? (
          <div className="flex flex-col gap-0.5">
            <dt className="text-fg-soft">Последнее изменение</dt>
            <dd className="text-fg">
              {changedAt}
              {settings.updated_by ? ` · ${settings.updated_by}` : ''}
            </dd>
          </div>
        ) : null}
      </dl>

      {error ? <Notice tone="error">{error}</Notice> : null}
      {saved ? <Notice tone="ok">Сохранено. Изменение действует сразу, перезапуск не нужен.</Notice> : null}

      <div className="flex flex-wrap gap-3">
        <Button variant="ghost" size="sm" onClick={() => setVersion((value) => value + 1)} disabled={busy}>
          Обновить
        </Button>
        <Link className="inline-flex min-h-11 items-center text-[0.9375rem] text-fg-soft underline hover:text-fg" href="/ask">
          Открыть /ask
        </Link>
      </div>
    </section>
  );
}
