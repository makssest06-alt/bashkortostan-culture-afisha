'use client';

/**
 * Админка афиши (п. 6.1, 6.3): импорт CSV/JSON с отчётом, правка событий, статусы,
 * очередь спорных карточек и журнал изменений. Активная вкладка хранится в адресе (?tab=).
 */

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui';
import { cn } from '@/lib/cn';

import { adminFetch } from './api';
import { Notice } from './bits';
import { ApplicationsTab } from './ApplicationsTab';
import { AuditList } from './AuditList';
import { EventsTab } from './EventsTab';
import { ImportTab } from './ImportTab';
import { LoginForm } from './LoginForm';
import { ModerationTab } from './ModerationTab';
import { TracesTab } from './TracesTab';
import { useSession } from './useSession';

const TABS = [
  { id: 'events', label: 'События' },
  { id: 'import', label: 'Импорт' },
  { id: 'moderation', label: 'Спорные' },
  { id: 'applications', label: 'Заявки' },
  { id: 'audit', label: 'Журнал' },
  { id: 'traces', label: 'Трассы ИИ' },
] as const;

type TabId = (typeof TABS)[number]['id'];

function isTab(value: string | null): value is TabId {
  return TABS.some((tab) => tab.id === value);
}

function ResetButton({ onDone }: { onDone: () => void }) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!armed) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setArmed(true)}>
        Сбросить демо-данные
      </Button>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-2" role="group" aria-label="Подтверждение сброса">
      <span className="text-[0.875rem] text-fg-soft">Правки и импорт пропадут. Сбросить?</span>
      <Button
        size="sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await adminFetch('/reset', { method: 'POST' }).catch(() => undefined);
          setBusy(false);
          setArmed(false);
          onDone();
        }}
      >
        Да, сбросить
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setArmed(false)}>
        Нет
      </Button>
    </span>
  );
}

export function AdminApp() {
  const { session, setSession, failed, logout } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tabParam = params.get('tab');
  const tab: TabId = isTab(tabParam) ? tabParam : 'events';
  const [disputedCount, setDisputedCount] = useState<number | null>(null);
  const [version, setVersion] = useState(0);

  const openTab = useCallback(
    (next: TabId) => {
      const query = new URLSearchParams(params.toString());
      if (next === 'events') query.delete('tab');
      else query.set('tab', next);
      router.replace(`${pathname}${query.size ? `?${query}` : ''}`, { scroll: false });
    },
    [params, pathname, router],
  );

  useEffect(() => {
    if (!session?.authenticated) return;
    adminFetch<{ total: number }>('/moderation')
      .then(({ data }) => setDisputedCount(data.total))
      .catch(() => undefined);
  }, [session?.authenticated, version]);

  if (failed) return <Notice tone="error">Не удалось связаться с сервером админки. Обновите страницу.</Notice>;
  if (!session) return <p className="text-fg-soft">Проверяем вход…</p>;
  if (!session.authenticated) return <LoginForm mode={session.mode} onDone={setSession} />;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
        <p className="text-[0.9375rem] text-fg-soft">
          Вы вошли как <span className="text-fg">{session.actor}</span>
          {session.mode === 'open' ? ' · демо-режим без токена' : ''}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <ResetButton onDone={() => setVersion((value) => value + 1)} />
          <Button variant="ghost" size="sm" onClick={logout}>
            Выйти
          </Button>
        </div>
      </div>

      <div role="tablist" aria-label="Разделы админки" className="flex flex-wrap gap-1 border-b border-line">
        {TABS.map((item) => (
          <button
            key={item.id}
            id={`tab-${item.id}`}
            role="tab"
            type="button"
            aria-selected={tab === item.id}
            aria-controls={`panel-${item.id}`}
            tabIndex={tab === item.id ? 0 : -1}
            onClick={() => openTab(item.id)}
            onKeyDown={(event) => {
              const index = TABS.findIndex((entry) => entry.id === tab);
              if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                event.preventDefault();
                const next = TABS[(index + (event.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
                openTab(next.id);
                document.getElementById(`tab-${next.id}`)?.focus();
              }
            }}
            className={cn(
              '-mb-px min-h-11 border-b-2 px-4 text-[0.9375rem] font-medium transition-colors duration-150',
              tab === item.id ? 'border-fg text-fg' : 'border-transparent text-fg-soft hover:text-fg',
            )}
          >
            {item.label}
            {item.id === 'moderation' && disputedCount ? (
              <span className="ml-2 rounded-xs bg-status-moved/20 px-1.5 text-[0.8125rem] text-status-moved tabular-nums">{disputedCount}</span>
            ) : null}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} key={`${tab}-${version}`}>
        {tab === 'events' ? <EventsTab /> : null}
        {tab === 'import' ? <ImportTab onOpenModeration={() => openTab('moderation')} /> : null}
        {tab === 'moderation' ? <ModerationTab onCount={setDisputedCount} /> : null}
        {tab === 'applications' ? <ApplicationsTab /> : null}
        {tab === 'audit' ? (
          <section aria-labelledby="audit-heading" className="flex flex-col gap-5">
            <h2 id="audit-heading" className="t-subtitle">
              Журнал изменений
            </h2>
            <AuditList />
          </section>
        ) : null}
        {tab === 'traces' ? <TracesTab /> : null}
      </div>
    </div>
  );
}
