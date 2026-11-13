import Link from 'next/link';

import { cn } from '@/lib/cn';

export type MergeEvent = { id: string; title: string; place: string; when: string; count: number };

/** Откуда съезжаются копии записей: сдвиг в процентах размера карточки и поворот в градусах. */
export const GHOST_FAN = [
  { x: -64, y: -12, r: -6 },
  { x: 0, y: -40, r: 0 },
  { x: 64, y: -12, r: 6 },
] as const;

type MergeCardProps = {
  event: MergeEvent | null;
  sourcesLabel: string;
  cardLabel: string;
  /** «Сведено из 3 источников»: готовая строка из словаря. */
  sourcesText: string | null;
  demoLabel: string;
};

/**
 * Карточка сцены dedup: несколько полупрозрачных записей источников съезжаются в одну карточку события.
 * Событие приходит из API (демо-данные, помечено). Пока его нет, в карточке стоят полосы-заглушки без чисел.
 * Под карточкой пунктирная дуга: точки на ней сходятся в одну вместе с записями.
 */
export function MergeCard({ event, sourcesLabel, cardLabel, sourcesText, demoLabel }: MergeCardProps) {
  const ghosts = GHOST_FAN.slice(0, event ? Math.min(Math.max(event.count, 2), GHOST_FAN.length) : GHOST_FAN.length);
  const frame = 'dd-card relative block overflow-hidden rounded-md border border-line-strong bg-surface text-left text-fg';

  const inner = (
    <>
      <span className="dd-head t-caps flex h-7 items-center justify-between gap-3 bg-cream px-3 text-ink md:h-[max(3.3vh,28px)]">
        <span className="relative block min-w-0 flex-1">
          <span className="dd-label-a block truncate">{sourcesLabel}</span>
          <span className="dd-label-b absolute inset-0 block truncate">{cardLabel}</span>
        </span>
        <span className="dd-count" data-num aria-hidden="true">
          {event ? event.count : ''}
        </span>
      </span>
      <span className="dd-content block px-3 pt-2.5 pb-3">
        {event ? (
          <>
            <span className="line-clamp-2 block text-[0.9375rem] leading-[1.25] font-semibold">{event.title}</span>
            <span className="mt-1 block truncate text-[0.8125rem] leading-[1.35] text-fg-soft">{[event.when, event.place].filter(Boolean).join(', ')}</span>
            <span className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[0.8125rem] leading-[1.35]">
              <span>{sourcesText}</span>
              <span className="t-caps text-fg-muted">{demoLabel}</span>
            </span>
          </>
        ) : (
          <span className="block space-y-2.5 py-1" aria-hidden="true">
            <span className="block h-3 w-4/5 rounded-xs bg-fg/20" />
            <span className="block h-3 w-3/5 rounded-xs bg-fg/15" />
            <span className="block h-3 w-2/5 rounded-xs bg-fg/15" />
          </span>
        )}
      </span>
    </>
  );

  return (
    <div className="absolute top-[58.5%] left-1/2 w-[76vw] -translate-x-1/2 md:top-[56%] md:w-[max(21vw,280px)]">
      <div className="dd-box">
        <div className="relative">
          {ghosts.map((ghost, index) => (
            <div key={index} className="dd-ghost invisible absolute inset-0 overflow-hidden rounded-md border border-fg/45 bg-fg/[0.07] will-change-transform" aria-hidden="true">
              <span className="block h-7 bg-cream/55 md:h-[max(3.3vh,28px)]" />
              <span className="mx-3 mt-3 block h-2.5 w-3/5 rounded-xs bg-fg/25" />
              <span className="mx-3 mt-2 block h-2.5 w-2/5 rounded-xs bg-fg/15" />
            </div>
          ))}
          {event ? (
            <Link href={`/events/${event.id}`} className={cn(frame, 'transition-[border-color] duration-(--duration-fast) ease-out hover:border-fg')}>
              {inner}
            </Link>
          ) : (
            <div className={frame}>{inner}</div>
          )}
        </div>
        <svg viewBox="0 0 300 44" className="dd-arc mt-[1.4vh] block w-full overflow-visible text-fg" fill="none" aria-hidden="true" focusable={false}>
          <path d="M10 8Q150 46 290 8" stroke="currentColor" strokeOpacity={0.6} strokeWidth={1} strokeDasharray="1 4" strokeLinecap="round" className="[vector-effect:non-scaling-stroke]" />
          {ghosts.map((ghost, index) => (
            <circle key={index} className="dd-dot" cx={150} cy={27} r={4} fill="currentColor" data-x={ghost.x} />
          ))}
        </svg>
      </div>
    </div>
  );
}
