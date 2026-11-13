'use client';

/**
 * Общие детали левой панели сцен fullscreen и thermal: титул по буквам, фаза текстов, строка события.
 */

import { useRef } from 'react';
import type { CSSProperties, RefObject } from 'react';

import { ROUTES } from '@/content/links';
import { formatOccurrence, relativeDay } from '@/lib/api/format';
import { valueDate, valueTime } from '@/lib/api/time';
import type { EventListItem, Lang, Occurrence } from '@/lib/api/types';
import { pick } from '@/lib/i18n';

import { useSceneProgress } from '../../scene-kit';
import styles from './scene.module.css';

export type Phase = 'pre' | 'in' | 'out';

/**
 * Тексты панели идут по времени, а не по прокрутке: на порогах прогресса корень сцены получает
 * data-phase, остальное делают переходы в CSS. Работает в обе стороны прокрутки.
 */
export function usePhase(rootRef: RefObject<HTMLElement | null>, enterAt: number, leaveAt: number): void {
  const current = useRef<Phase | null>(null);

  useSceneProgress((progress) => {
    const phase: Phase = progress < enterAt ? 'pre' : progress < leaveAt ? 'in' : 'out';
    if (phase === current.current) return;
    current.current = phase;
    if (rootRef.current) rootRef.current.dataset.phase = phase;
  });
}

/** Задержка появления блока: шаг 55 мс на единицу. */
export function order(index: number): CSSProperties {
  return { '--i': index } as CSSProperties;
}

/**
 * Титул панели: каждая буква выезжает снизу из-под маски строки, вторая строка позже первой.
 * Для чтения с экрана титул отдаётся одной строкой.
 */
export function SplitTitle({ lines, className }: { lines: readonly string[]; className?: string }) {
  // Номер буквы сквозной по строкам; каждая следующая строка стартует позже на два шага.
  const starts = lines.map(
    (_, lineIndex) =>
      lines.slice(0, lineIndex).reduce((sum, line) => sum + Array.from(line).length, 0) + lineIndex * 2,
  );
  return (
    <h2 className={className ?? styles.title}>
      <span className="visually-hidden">{lines.join(' ')}</span>
      {lines.map((line, lineIndex) => (
        <span key={line} aria-hidden="true" className={styles.line}>
          {Array.from(line).map((char, charIndex) => (
            <span key={charIndex} className={styles.ch} style={order(starts[lineIndex] + charIndex)}>
              {char === ' ' ? ' ' : char}
            </span>
          ))}
        </span>
      ))}
    </h2>
  );
}

/** Сеанс, который показывает карточка в списке: ближайший подходящий. */
export function primaryOccurrence(item: EventListItem): Occurrence | undefined {
  return item.occurrences.find((occurrence) => occurrence.id === item.primary_occurrence_id) ?? item.occurrences[0];
}

export function eventTitle(item: EventListItem, lang: Lang): string {
  return lang === 'ba' && item.title_ba ? item.title_ba : item.title;
}

export function eventHref(item: EventListItem): string {
  return `${ROUTES.events}/${encodeURIComponent(item.id)}`;
}

export function eventPlace(item: EventListItem, lang: Lang): string {
  return `${item.venue.name}, ${pick(item.venue.city_name, lang)}`;
}

/**
 * Когда событие в коротком списке «сегодня»: для сегодняшнего сеанса только время,
 * для выставки с периодом её срок, для остальных дней дата со временем.
 */
export function shortWhen(occurrence: Occurrence, lang: Lang, today: string): string {
  const date = valueDate(occurrence.start);
  const time = valueTime(occurrence.start);
  if (occurrence.start.precision === 'minute' && time) {
    const day = relativeDay(date, today, lang);
    return day ? `${day}, ${time}` : formatOccurrence(occurrence, lang, today);
  }
  return formatOccurrence(occurrence, lang, today);
}
