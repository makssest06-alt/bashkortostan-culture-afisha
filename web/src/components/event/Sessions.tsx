'use client';

/**
 * Сеансы события списком: дата, время и статус у каждого.
 * Отменённые и перенесённые сеансы остаются в списке и не прячут остальные.
 */

import { CaretDown } from '@phosphor-icons/react';
import { useId, useState } from 'react';

import { StatusBadge } from '@/components/ui';
import { displayStatusOf } from '@/data/dictionaries';
import { formatTimeValue, relativeDay } from '@/lib/api/format';
import { valueDate } from '@/lib/api/time';
import type { Occurrence } from '@/lib/api/types';
import { cn } from '@/lib/cn';
import { useT } from '@/lib/i18n';

import { VISIBLE_SESSIONS, sessionTime, splitSessions } from './model';

type SessionRowProps = {
  occurrence: Occurrence;
  today: string;
};

function SessionRow({ occurrence, today }: SessionRowProps) {
  const { t, lang } = useT();
  const status = displayStatusOf(occurrence);
  const time = sessionTime(occurrence, lang, today);
  const date = valueDate(occurrence.start);
  const relative = occurrence.is_past ? null : relativeDay(date, today, lang);

  // Отменён или перенесён без новой даты: прежние дата и время уже не действуют.
  const off = status === 'cancelled' || status === 'postponed';
  const muted = off || occurrence.is_past;

  const dayLine =
    time.day === null
      ? null
      : status === 'postponed'
        ? t('event.previousDate', { date: time.day })
        : status === 'rescheduled' && occurrence.previous_start
          ? t('event.newDate', { date: time.day })
          : time.day;

  return (
    <li
      data-session={occurrence.id}
      data-session-status={status}
      className="flex flex-col gap-2 border-t border-line py-3.5 first:border-t-0 first:pt-0"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <time dateTime={occurrence.start.local} className="flex min-w-0 flex-col gap-1">
          {dayLine ? (
            <span className="t-caps flex flex-wrap items-baseline gap-x-2.5">
              <span className={muted ? 'text-fg-muted' : 'text-copper-hi'}>{dayLine}</span>
              {relative ? <span className="text-fg-soft">{relative}</span> : null}
            </span>
          ) : null}
          <span
            data-num
            className={cn(
              'font-semibold tracking-[-0.03em]',
              time.day === null ? 'text-[1.375rem] leading-[1.15]' : 'text-[1.5rem] leading-none',
              muted ? 'text-fg-muted' : 'text-fg',
              off && 'line-through decoration-1',
            )}
          >
            {time.main}
          </span>
        </time>
        {occurrence.is_past ? (
          <span className="t-caps text-fg-muted">{t('status.past')}</span>
        ) : (
          <StatusBadge occurrence={occurrence} className="mt-0.5 max-w-full" />
        )}
      </div>

      {status !== 'postponed' && occurrence.previous_start ? (
        <p className="text-[0.875rem] leading-[1.4] text-fg-soft">
          {t('event.previousDate', { date: formatTimeValue(occurrence.previous_start, lang) })}
        </p>
      ) : null}
    </li>
  );
}

export type SessionsProps = {
  occurrences: readonly Occurrence[];
  /** Сегодняшняя дата афиши: от неё считаются «сегодня», «завтра» и «до 2 декабря». */
  today: string;
  className?: string;
};

export function Sessions({ occurrences, today, className }: SessionsProps) {
  const { t } = useT();
  const [showAll, setShowAll] = useState(false);
  const listId = useId();
  const { upcoming, past } = splitSessions(occurrences);

  const hiddenCount = Math.max(0, upcoming.length - VISIBLE_SESSIONS);
  const visible = showAll ? upcoming : upcoming.slice(0, VISIBLE_SESSIONS);

  return (
    <section className={className} aria-labelledby={`${listId}-title`}>
      <h2 id={`${listId}-title`} className="t-caps mb-4 flex items-baseline justify-between gap-3 text-fg-muted">
        {t('event.sessions')}
        {upcoming.length > 1 ? <span data-num>{upcoming.length}</span> : null}
      </h2>

      {upcoming.length === 0 ? (
        <p className="t-lead text-fg-soft">{t('event.sessions.none')}</p>
      ) : (
        <ol id={listId} className="flex flex-col">
          {visible.map((occurrence) => (
            <SessionRow key={occurrence.id} occurrence={occurrence} today={today} />
          ))}
        </ol>
      )}

      {hiddenCount > 0 ? (
        <button
          type="button"
          aria-expanded={showAll}
          aria-controls={listId}
          onClick={() => setShowAll((value) => !value)}
          className="t-ui inline-flex min-h-11 items-center gap-2 rounded-xs text-fg underline decoration-line-strong decoration-1 underline-offset-[0.3em] transition-[text-decoration-color] duration-(--duration-fast) ease-out hover:decoration-fg"
        >
          {showAll ? t('event.showLess') : `${t('event.sessions.all')} (${upcoming.length})`}
          <CaretDown
            size={14}
            weight="bold"
            aria-hidden="true"
            className={cn('transition-transform duration-(--duration-fast) ease-out', showAll && 'rotate-180')}
          />
        </button>
      ) : null}

      {past.length > 0 ? (
        <details className={cn('group border-t border-line', upcoming.length === 0 && 'mt-4')}>
          <summary className="t-ui flex min-h-11 list-none items-center justify-between gap-3 text-fg-soft transition-colors duration-(--duration-fast) ease-out hover:text-fg [&::-webkit-details-marker]:hidden">
            <span>
              {t('event.sessions.past')} <span data-num>({past.length})</span>
            </span>
            <CaretDown
              size={14}
              weight="bold"
              aria-hidden="true"
              className="transition-transform duration-(--duration-fast) ease-out group-open:rotate-180"
            />
          </summary>
          <ol className="flex flex-col pt-2">
            {past.map((occurrence) => (
              <SessionRow key={occurrence.id} occurrence={occurrence} today={today} />
            ))}
          </ol>
        </details>
      ) : null}
    </section>
  );
}
