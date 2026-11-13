'use client';

/**
 * Сцена fullscreen: «БЛИЖАЙШИЕ СОБЫТИЯ».
 *
 * Окно в зал начинается ровно с прямоугольника фото в рамке галереи и раскрывается обрезкой
 * (clip-path): сначала по высоте, потом правым краем, потом левым. Картинка не масштабируется,
 * сцена только сдвигается: герой уходит из центра окна в центр правой области.
 * Слева матовая панель с ближайшим спектаклем из API. Тексты входят и выходят по времени.
 */

import { ArrowRight, CalendarBlank } from '@phosphor-icons/react';
import Link from 'next/link';
import { useRef } from 'react';

import { PriceTag, Skeleton, StatusBadge } from '@/components/ui';
import { getHome } from '@/content/home';
import type { FullscreenCopy } from '@/content/home';
import { listEvents } from '@/lib/api/client';
import { formatDay, formatOccurrence } from '@/lib/api/format';
import { valueDate } from '@/lib/api/time';
import type { EventsListResponse } from '@/lib/api/types';
import { cn } from '@/lib/cn';
import { useT } from '@/lib/i18n';

import { Scene, useSceneTimeline } from '../../scene-kit';
import frame from '../gallery/frame.module.css';
import { useRemote } from '../gallery/useRemote';
import type { Remote } from '../gallery/useRemote';
import { def, FULLSCREEN } from './def';
import { HallPicture } from './HallPicture';
import { eventHref, eventPlace, eventTitle, order, primaryOccurrence, SplitTitle, usePhase } from './panel';
import styles from './scene.module.css';

type EventsState = Remote<EventsListResponse>;

/** Левый край окна трогается медленнее правого и догоняет к концу. */
const slowStart = (t: number): number => t ** 1.4;

function NearestEvent({ copy, events, retry }: { copy: FullscreenCopy; events: EventsState; retry: () => void }) {
  const { t, lang } = useT();

  if (events.status === 'loading') {
    return (
      <div className={styles.event} aria-busy="true">
        <span className="visually-hidden">{t('common.loading')}</span>
        <span className={styles.eventTitle} aria-hidden="true">
          <Skeleton className="h-[1em] w-11/12" />
          <Skeleton className="mt-[0.2em] h-[1em] w-3/5" />
        </span>
        <span className={styles.eventMeta} aria-hidden="true">
          <span className={styles.eventWhen}>
            <Skeleton className="h-[1em] w-1/2" />
          </span>
          <span className={styles.eventWhere}>
            <Skeleton className="mt-[0.3em] h-[1em] w-4/5" />
          </span>
        </span>
        <span className={styles.eventRow} aria-hidden="true">
          <Skeleton className="h-5 w-24" />
        </span>
      </div>
    );
  }

  if (events.status === 'error') {
    return (
      <div role="alert">
        <p className={styles.note}>{t('events.error')}</p>
        <button type="button" className={styles.retry} onClick={retry}>
          {t('common.retry')}
        </button>
      </div>
    );
  }

  const item = events.data.items[0];
  const occurrence = item ? primaryOccurrence(item) : undefined;
  if (!item || !occurrence) return <p className={styles.note}>{copy.empty}</p>;

  return (
    <Link href={eventHref(item)} className={styles.event}>
      <h3 className={styles.eventTitle}>{eventTitle(item, lang)}</h3>
      <span className={styles.eventMeta}>
        <time className={styles.eventWhen} dateTime={occurrence.start.local}>
          {formatOccurrence(occurrence, lang, events.data.reference_date)}
        </time>
        <span className={styles.eventWhere}>{eventPlace(item, lang)}</span>
      </span>
      <span className={styles.eventRow}>
        <PriceTag price={item.price_summary} />
        <StatusBadge occurrence={occurrence} size="sm" />
      </span>
      <span className={styles.eventCta}>
        {copy.eventCta}
        <ArrowRight size={16} weight="bold" aria-hidden="true" className={styles.arrow} />
      </span>
    </Link>
  );
}

function FullscreenStage({ copy, events, retry }: { copy: FullscreenCopy; events: EventsState; retry: () => void }) {
  const { t, lang } = useT();
  const rootRef = useRef<HTMLDivElement>(null);

  usePhase(rootRef, FULLSCREEN.textIn, FULLSCREEN.textOut);

  useSceneTimeline((tl, { q, env }) => {
    const windowNode = q('[data-f="window"]');

    // Окно: по высоте раскрывается первым, правый край приходит раньше левого.
    tl.fromTo(windowNode, { '--ct': 1, '--cb': 1 }, { '--ct': 0, '--cb': 0, duration: FULLSCREEN.heightOpen }, 0);
    // Кривые по кадрам 171-178: правый край 68 -> 78 -> 100 % W, левый 33 -> 29 -> 22 -> 16 -> 12 -> 3 -> 0 % W.
    tl.fromTo(windowNode, { '--cr': 1 }, { '--cr': 0, duration: FULLSCREEN.rightOpen, ease: 'power2.in' }, 0);
    tl.fromTo(windowNode, { '--cl': 1 }, { '--cl': 0, duration: FULLSCREEN.leftOpen, ease: slowStart }, 0);

    // Матовая панель встаёт слева направо в последние кадры раскрытия, вместе с приходом левого края.
    if (!env.mobile) {
      tl.fromTo(
        q('[data-f="glass"]'),
        { clipPath: 'inset(0% 100% 0% 0%)' },
        { clipPath: 'inset(0% 0% 0% 0%)', duration: FULLSCREEN.leftOpen - FULLSCREEN.glassIn },
        FULLSCREEN.glassIn,
      );
    }

    // Сцена сдвигается, масштаб содержимого не меняется. При «меньше движения» кадр стоит на месте.
    if (!env.reduced) {
      tl.fromTo(q('[data-hall-shift]'), { '--sp': 1 }, { '--sp': 0, duration: FULLSCREEN.leftOpen }, 0);
    }

    tl.fromTo(q('[data-f="scrim"]'), { opacity: 0 }, { opacity: 1, duration: 0.22 }, 0.06);
  });

  const item = events.status === 'ready' ? events.data.items[0] : undefined;
  const occurrence = item ? primaryOccurrence(item) : undefined;

  return (
    <div ref={rootRef} className={cn(frame.vars, styles.root)} data-phase="pre">
      <div className={styles.window} data-f="window">
        <HallPicture sync live />
        <div className={styles.scrim} data-f="scrim" />
        <div className={styles.glass} data-f="glass" />
      </div>

      <div className={styles.panel}>
        <div className={styles.head}>
          <span className={cn(styles.icon, styles.rise)} style={order(0)}>
            <CalendarBlank size={24} weight="fill" aria-hidden="true" />
          </span>
          <p className={cn(styles.eyebrow, styles.rise)} style={order(1)}>
            {copy.eyebrow}
          </p>
        </div>

        <div className={styles.sheet}>
          <SplitTitle lines={copy.title} />
          <p className={cn(styles.body, styles.rise)} style={order(2)}>
            {copy.body}
          </p>
          <div className={cn(styles.data, styles.eventBox, styles.rise)} style={order(3)}>
            <NearestEvent copy={copy} events={events} retry={retry} />
            <Link href={copy.cta.href} className={cn(styles.more, styles.moreAside)}>
              {copy.cta.label}
              <ArrowRight size={14} weight="bold" aria-hidden="true" className={styles.arrow} />
            </Link>
          </div>
        </div>

        <span className={styles.ruler} aria-hidden="true" />
      </div>

      {/* Правый нижний угол: крупная дата ближайшего сеанса (в референсе здесь формула) */}
      <div className={cn(styles.corner, styles.rise)} style={order(4)} aria-hidden="true">
        <p className={styles.cornerNote}>{t('event.sessions.nearest')}</p>
        <p className={styles.cornerBig} data-num>
          {events.status === 'loading' ? (
            <Skeleton className="h-[0.9em] w-[5.4ch]" />
          ) : occurrence ? (
            formatDay(valueDate(occurrence.start), lang)
          ) : null}
        </p>
      </div>
    </div>
  );
}

export default function FullscreenScene() {
  const { lang } = useT();
  const copy = getHome(lang).fullscreen;
  const [events, retry] = useRemote((signal) => listEvents(copy.query, { signal }));

  return (
    <Scene def={def} label={`${copy.eyebrow}: ${copy.title.join(' ')}`}>
      <FullscreenStage copy={copy} events={events} retry={retry} />
    </Scene>
  );
}
