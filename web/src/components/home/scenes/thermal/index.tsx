'use client';

/**
 * Сцена thermal: «ГОРЯЧО СЕГОДНЯ».
 *
 * Основа та же, что в конце fullscreen (картинка зала, матовая панель, линейка): склейка незаметна.
 * Поверх картинки ложится её тепловая версия и раскрывается кругом от «горячей точки».
 * Слева три самых популярных события дня из API; если на сегодня их меньше трёх, список добирается
 * ближайшими, и у каждой строки стоит дата. Справа шкала от «тихо» до «горячо»: это метафора, чисел на ней нет.
 */

import { ArrowRight, ThermometerHot } from '@phosphor-icons/react';
import Link from 'next/link';
import { useEffect, useRef } from 'react';

import { Skeleton } from '@/components/ui';
import { getHome } from '@/content/home';
import type { ThermalCopy } from '@/content/home';
import { listEvents } from '@/lib/api/client';
import { formatDay } from '@/lib/api/format';
import type { EventListItem } from '@/lib/api/types';
import { cn } from '@/lib/cn';
import { gsap } from '@/lib/gsap';
import { useT } from '@/lib/i18n';

import { Scene, useScene, useSceneTimeline } from '../../scene-kit';
import { HallPicture } from '../fullscreen/HallPicture';
import { eventHref, eventTitle, order, primaryOccurrence, shortWhen, SplitTitle, usePhase } from '../fullscreen/panel';
import styles from '../fullscreen/scene.module.css';
import frame from '../gallery/frame.module.css';
import { useRemote } from '../gallery/useRemote';
import type { Remote } from '../gallery/useRemote';
import { def, THERMAL } from './def';
import heat from './thermal.module.css';
import { paintThermal } from './thermalMap';

const ROWS = 3;

type HotList = {
  rows: EventListItem[];
  /** Сегодня в поясе афиши: от этой даты считались «сегодня» и подписи строк. */
  today: string;
};

type HotState = Remote<HotList>;

/** Три популярных события дня. Если их меньше трёх, список добирается ближайшими по дате. */
async function loadHot(copy: ThermalCopy, signal: AbortSignal): Promise<HotList> {
  const today = await listEvents(copy.query, { signal });
  const rows = today.items.slice(0, ROWS);
  if (rows.length < ROWS) {
    const nearest = await listEvents({ sort: 'date', page_size: ROWS * 2 }, { signal });
    for (const item of nearest.items) {
      if (rows.length >= ROWS) break;
      if (!rows.some((row) => row.id === item.id)) rows.push(item);
    }
  }
  return { rows, today: today.reference_date };
}

function HotEvents({ copy, hot, retry }: { copy: ThermalCopy; hot: HotState; retry: () => void }) {
  const { t, lang } = useT();

  if (hot.status === 'loading') {
    return (
      <ul className={styles.list} aria-busy="true">
        <li className="visually-hidden">{t('common.loading')}</li>
        {Array.from({ length: ROWS }, (_, index) => (
          <li key={index} aria-hidden="true">
            <span className={styles.row}>
              <span className={cn(styles.rowText, 'w-full')}>
                <Skeleton className="h-[1.05em] w-4/5" />
                <Skeleton className="mt-2 h-[0.8em] w-3/5" />
              </span>
            </span>
          </li>
        ))}
      </ul>
    );
  }

  if (hot.status === 'error') {
    return (
      <div role="alert">
        <p className={styles.note}>{t('events.error')}</p>
        <button type="button" className={styles.retry} onClick={retry}>
          {t('common.retry')}
        </button>
      </div>
    );
  }

  if (hot.data.rows.length === 0) {
    return (
      <div>
        <p className={styles.note}>{copy.empty.text}</p>
        <Link href={copy.empty.link.href} className={styles.more}>
          {copy.empty.link.label}
          <ArrowRight size={14} weight="bold" aria-hidden="true" className={styles.arrow} />
        </Link>
      </div>
    );
  }

  return (
    <ul className={styles.list}>
      {hot.data.rows.map((item) => {
        const occurrence = primaryOccurrence(item);
        return (
          <li key={item.id}>
            <Link href={eventHref(item)} className={styles.row}>
              <span className={styles.rowText}>
                <span className={styles.rowTitle}>{eventTitle(item, lang)}</span>
                <span className={styles.rowMeta}>
                  {occurrence ? (
                    <>
                      <time className={styles.rowWhen} dateTime={occurrence.start.local}>
                        {shortWhen(occurrence, lang, hot.data.today)}
                      </time>
                      {', '}
                    </>
                  ) : null}
                  {item.venue.name}
                </span>
              </span>
              <ArrowRight size={16} weight="bold" aria-hidden="true" className={styles.arrow} />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function ThermalStage({ copy, hot, retry }: { copy: ThermalCopy; hot: HotState; retry: () => void }) {
  const { t, lang } = useT();
  const { env } = useScene();
  const rootRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  usePhase(rootRef, THERMAL.textIn, THERMAL.textOut);

  // Тепловая версия картинки считается один раз, в простое, когда фото зала загрузилось.
  useEffect(() => {
    const image = imageRef.current;
    const canvas = canvasRef.current;
    if (!image || !canvas) return;
    let timer = 0;
    let painted = false;
    const paint = () => {
      if (painted || !image.complete || image.naturalWidth === 0) return;
      // Холст берёт пропорции своего места (кадрирование как у фото) и не больше 900 точек
      // по длинной стороне на телефоне, 1600 на компьютере.
      const box = canvas.parentElement;
      painted = paintThermal(canvas, image, {
        boxWidth: box?.offsetWidth || window.innerWidth,
        boxHeight: box?.offsetHeight || window.innerHeight,
        maxSide: env.mobile ? 900 : 1600,
        pixelRatio: window.devicePixelRatio || 1,
      });
    };
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(paint, 120);
    };
    if (image.complete) schedule();
    image.addEventListener('load', schedule);
    return () => {
      window.clearTimeout(timer);
      image.removeEventListener('load', schedule);
    };
    // Размер холста зависит от места на экране: при смене размера окна холст красится заново.
  }, [env.mobile, env.w, env.h]);

  useSceneTimeline((tl, { q, env: sceneEnv }) => {
    const thermal = q('[data-t="thermal"]');
    const all = q('[data-t="all"]');
    const scale = q('[data-t="scale"]');

    if (sceneEnv.reduced) {
      // Меньше движения: палитра не расходится кругом, а проявляется.
      gsap.set(thermal, { '--tr': 1 });
      tl.fromTo(thermal, { opacity: 0 }, { opacity: 1, duration: THERMAL.paletteOpen }, 0);
    } else {
      // Палитра расходится от горячей точки, по кромке идёт тёплая волна.
      tl.fromTo(thermal, { '--tr': 0 }, { '--tr': 1, duration: THERMAL.paletteOpen, ease: 'power2.in' }, 0);
      // autoAlpha: погасшая кромка скрыта (visibility) и не держит свой слой.
      tl.fromTo(
        q('[data-t="rim"]'),
        { '--tr': 0, autoAlpha: 1 },
        { '--tr': 1, autoAlpha: 0, duration: THERMAL.paletteOpen, ease: 'power2.in' },
        0,
      );
    }
    tl.fromTo(scale, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.05 }, 0.06);

    // Выход: шкала гаснет, палитра возвращается в обычную, камера наезжает, сцена уходит в фон страницы.
    tl.to(scale, { autoAlpha: 0, duration: 0.05 }, THERMAL.textOut);
    tl.to(thermal, { autoAlpha: 0, duration: 0.1 }, THERMAL.textOut);
    if (!sceneEnv.reduced) {
      tl.fromTo(
        all,
        { scale: 1 },
        { scale: 1.07, duration: 1 - THERMAL.zoomStart, ease: 'power2.in' },
        THERMAL.zoomStart,
      );
    }
    tl.to(all, { opacity: 0, duration: 1 - THERMAL.fadeStart }, THERMAL.fadeStart);
  });

  // При «меньше движения» fullscreen не сдвигает кадр: здесь он стоит так же, и горячая точка вместе с ним.
  const settled = !env.reduced;

  return (
    <div
      ref={rootRef}
      className={cn(frame.vars, styles.root)}
      data-phase="pre"
      data-unsettled={settled ? undefined : ''}
    >
      <div className={styles.all} data-t="all">
        <div className={cn(styles.window, styles.windowOpen)}>
          <HallPicture settled={settled} imageRef={imageRef} sync />

          <div className={heat.thermal} data-t="thermal">
            <div className={cn(styles.shift, settled && styles.shiftDone)}>
              <div className={styles.pic}>
                <canvas ref={canvasRef} width={16} height={9} className={heat.thermalCanvas} />
              </div>
            </div>
            <div className={heat.hot} />
            <div className={heat.thermalShade} />
          </div>
          <div className={heat.rim} data-t="rim" />

          <div className={cn(styles.scrim, styles.scrimOn)} />
          <div className={styles.glass} />
        </div>

        <div className={styles.panel}>
          <div className={styles.head}>
            <span className={cn(styles.icon, styles.rise)} style={order(0)}>
              <ThermometerHot size={24} weight="fill" aria-hidden="true" />
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
            <div className={cn(styles.data, styles.rise)} style={order(3)}>
              <div className={styles.listBox}>
                <HotEvents copy={copy} hot={hot} retry={retry} />
              </div>
              <Link href={copy.cta.href} className={styles.more}>
                {copy.cta.label}
                <ArrowRight size={14} weight="bold" aria-hidden="true" className={styles.arrow} />
              </Link>
            </div>

            {/* Шкала справа: метафора интереса, без чисел. На телефоне стоит над нижней панелью */}
            <div className={heat.scaleBox} data-t="scale">
              <span className={heat.scale} aria-hidden="true" />
              <p className={cn(heat.scaleLabel, heat.scaleHigh, 't-caps')}>{copy.scale.high}</p>
              <p className={cn(heat.scaleLabel, heat.scaleLow, 't-caps')}>{copy.scale.low}</p>
            </div>
          </div>

          <span className={styles.ruler} aria-hidden="true" />
        </div>

        {/* Правый нижний угол: сегодняшняя дата, от которой считан список */}
        <div className={cn(styles.corner, styles.rise)} style={order(4)} aria-hidden="true">
          <p className={styles.cornerNote}>{t('common.today')}</p>
          <p className={styles.cornerBig} data-num>
            {hot.status === 'loading' ? (
              <Skeleton className="h-[0.9em] w-[5.4ch]" />
            ) : hot.status === 'ready' ? (
              formatDay(hot.data.today, lang)
            ) : null}
          </p>
        </div>
      </div>
    </div>
  );
}

export default function ThermalScene() {
  const { lang } = useT();
  const copy = getHome(lang).thermal;
  const [hot, retry] = useRemote((signal) => loadHot(copy, signal));

  return (
    <Scene def={def} label={`${copy.eyebrow}: ${copy.title.join(' ')}`}>
      <ThermalStage copy={copy} hot={hot} retry={retry} />
    </Scene>
  );
}
