'use client';

/**
 * popular (S12): волосяные линии, раскрытие панелей, горизонтальная лента с пятью популярными событиями.
 *
 * Компьютер: закреплённый трек. Позиции таймлайна записаны в кадрах референса (кадр 413 начало
 * закрепления), пересчёт в доли сцены делает frameAt():
 *   весь ход    лента едет влево с постоянной скоростью, около 1,2px на 1px прокрутки (8,6 % ширины окна
 *               за кадр). Стартует сдвинутой вправо: первая узкая панель стоит линией на u 0,63,
 *               правее жетона, первая широкая на u 0,96. В конце последняя широкая панель встаёт
 *               вплотную к правому краю, закрепление отпускает;
 *   413-421,5   узкая панель: линия 5px открывается окном от своего левого края (картинка не сжимается);
 *   413-417,3   широкая панель: линия, затем 417,3-422,5 окно до полной ширины;
 *   418,5       порог: подписи первой панели допечатываются слева направо (по времени).
 * У нас пять событий, в референсе четыре широкие панели: лента длиннее на одну пару панелей,
 * поэтому закрепление длиннее в той же пропорции (64 кадра вместо 51), скорость ленты та же.
 * Телефон и «меньше движения»: стопка панелей событий, следующая въезжает справа поверх текущей
 * (при «меньше движения» проявляется на месте). Раскладку переключает CSS: ./popular.module.css
 */

import { ArrowDown, ArrowRight, ArrowUpRight } from '@phosphor-icons/react';
import Link from 'next/link';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { FocusEvent } from 'react';

import { scrollToTarget } from '@/components/shell/scroll';
import { Button, StatusBadge } from '@/components/ui';
import { getHome } from '@/content/home';
import { listEvents } from '@/lib/api/client';
import { formatOccurrence, formatPrice } from '@/lib/api/format';
import type { EventListItem } from '@/lib/api/types';
import { cn } from '@/lib/cn';
import { pick, useT } from '@/lib/i18n';

import { Scene, useScene, useSceneProgress, useSceneTimeline } from '../../scene-kit';
import { def } from './def';
import styles from './popular.module.css';

/** Сколько событий в ленте: по одному на широкую панель. */
const PANELS = 5;
/** Узкие панели-перебивки: свои фотографии сцен. */
const NARROW_IMAGES = [1, 2, 3, 4, 5].map((n) => `/images/scenes/panel-${n}.webp`);

/** Длина закрепления в кадрах референса: 51 кадр оригинала плюс путь лишней пары панелей. */
const FRAMES = 64;
const FIRST_FRAME = 413;
/** Доля сцены, на которую приходится кадр референса. */
const frameAt = (frame: number) => (frame - FIRST_FRAME) / FRAMES;
/** Длительность в долях сцены для отрезка в кадрах референса. */
const frames = (count: number) => count / FRAMES;
/** Где лента стоит в начале закрепления: левый край первой узкой панели, в процентах ширины окна. */
const START_X = 63.2;
/** Порог, после которого у первой панели допечатываются подписи (кадры 417-420). */
const TYPED_AT = frameAt(418.5);
/** К этому кадру первая широкая панель раскрыта целиком. */
const LEAD_OPEN = frameAt(422.5);

type Feed =
  | { status: 'loading' }
  | { status: 'ready'; items: EventListItem[]; today: string }
  | { status: 'empty' }
  | { status: 'error' };

/** Окна прогресса, в которых въезжают панели стопки: со второй по последнюю. */
function stackWindows(count: number): { start: number; end: number }[] {
  if (count <= 1) return [];
  const lead = 0.08;
  const slot = 0.8 / (count - 1);
  return Array.from({ length: count - 1 }, (_, index) => ({
    start: lead + index * slot,
    end: lead + index * slot + slot * 0.7,
  }));
}

function titleSize(title: string): 's' | 'm' | 'l' {
  if (title.length <= 16) return 's';
  return title.length <= 26 ? 'm' : 'l';
}

/** Длина самого длинного слова названия: по ней CSS не даёт слову вылезти за панель. */
function longestWord(title: string): number {
  return Math.max(4, ...title.split(/[\s\u00A0-]+/).map((word) => word.length));
}

function PopularStage() {
  const { t, lang } = useT();
  const copy = getHome(lang).popular;
  const { env, layout, rootRef } = useScene();
  const root = useRef<HTMLDivElement>(null);
  const activeDot = useRef(-1);
  const [attempt, setAttempt] = useState(0);
  const [feed, setFeed] = useState<Feed>({ status: 'loading' });

  const query = useMemo(() => ({ ...copy.query, page_size: PANELS }), [copy.query]);

  useEffect(() => {
    const controller = new AbortController();
    listEvents(query, { signal: controller.signal })
      .then((response) => {
        const items = response.items.slice(0, PANELS);
        setFeed(items.length > 0 ? { status: 'ready', items, today: response.reference_date } : { status: 'empty' });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setFeed({ status: 'error' });
      });
    return () => controller.abort();
  }, [query, attempt]);

  const items = feed.status === 'ready' ? feed.items : [];
  const today = feed.status === 'ready' ? feed.today : undefined;
  const slots = feed.status === 'loading' ? PANELS : items.length;
  const strip = !env.mobile && !env.reduced;
  const motion = strip ? 'strip' : env.reduced ? 'fade' : 'slide';
  const ctaSplit = copy.cta.label.lastIndexOf(' ');
  const ctaHead = ctaSplit > 0 ? copy.cta.label.slice(0, ctaSplit + 1) : '';
  const ctaTail = ctaSplit > 0 ? copy.cta.label.slice(ctaSplit + 1) : copy.cta.label;

  useSceneTimeline(
    (tl, { q, env: sceneEnv, backdrop }) => {
      // Свечение сверху проявляется вместе с первыми линиями: соседняя cities гасит своё на последних 8 %.
      const glow = backdrop?.querySelector('[data-pop="glow"]');
      if (glow) tl.fromTo(glow, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.05 }, 0);

      const track = q('[data-pop="track"]')[0] as HTMLElement | undefined;
      if (!track) return;

      if (!sceneEnv.mobile && !sceneEnv.reduced) {
        const vw = sceneEnv.w / 100;
        const travel = Math.max(0, track.scrollWidth - sceneEnv.w);
        const leadNarrow = q('[data-pop="lead-narrow"]');
        const leadWide = q('[data-pop="lead-wide"]');
        const power = (exponent: number) => (value: number) => Math.pow(value, exponent);

        // Лента. Замер по кадрам 413-420 (левый край первой узкой панели, доли ширины окна):
        // 0,632 / 0,545 / 0,455 / 0,347 / 0,295 / 0,201 / 0,104 / 0,024: прямая, 8,7 % ширины за кадр.
        // Первая широкая панель идёт на постоянном расстоянии от неё (0,88 / 0,82 / 0,70 / 0,60 / 0,55 /
        // 0,47 / 0,35 / 0,30 / 0,22 / 0,13 в кадрах 414-423): это ход всей ленты, отдельного «сбора» панелей нет.
        // Экран сцены въезжает снизу обычной прокруткой уже с линией на своём месте (кадры 411-413).
        tl.fromTo(track, { x: START_X * vw }, { x: -travel, duration: 1 }, 0);

        // Узкая панель. Окно от левого края: 1,2 / 2 / 3 / 5 / 8 / 25 / 40 / 64 / 95 % её ширины
        // в кадрах 413-421: медленный старт и разгон.
        tl.fromTo(
          leadNarrow,
          { opacity: 1, clipPath: 'inset(0% 98.8% 0% 0%)' },
          { opacity: 1, clipPath: 'inset(0% 0% 0% 0%)', duration: frames(8.5), ease: power(2.6) },
          0,
        );

        // Широкая панель. Сначала едва заметная линия (кадры 413-415), к кадру 417 окно 8 % её ширины,
        // затем 11 / 24 / 66 / 85 / 98 % в кадрах 418-422.
        tl.fromTo(leadWide, { opacity: 0 }, { opacity: 1, duration: frames(1.5) }, 0);
        tl.fromTo(
          leadWide,
          { clipPath: 'inset(0% 99.4% 0% 0%)' },
          { clipPath: 'inset(0% 92% 0% 0%)', duration: frames(4.3), ease: 'power3.in' },
          0,
        );
        tl.to(leadWide, { clipPath: 'inset(0% 0% 0% 0%)', duration: frames(5.2), ease: 'power2.inOut' }, frameAt(417.3));

        // Пока панель это линия, она светлая (в референсе линии светлые): засветка гаснет, когда окно открылось.
        tl.fromTo(
          q('[data-pop="flash"]'),
          { opacity: (index: number) => (index === 0 ? 0.85 : 0.3) },
          { opacity: 0, duration: frames(2.8), ease: 'power1.in' },
          0,
        );
      } else if (!sceneEnv.reduced) {
        // Стопка: панели со второй въезжают справа поверх текущей.
        // При «меньше движения» панели сменяются проявлением по порогу: это делает CSS (data-on ниже).
        const wides = q('[data-pop-wide]');
        stackWindows(wides.length).forEach((win, index) => {
          tl.fromTo(
            wides[index + 1],
            { xPercent: 106 },
            { xPercent: 0, duration: win.end - win.start, ease: 'power2.inOut' },
            win.start,
          );
        });
      }

      // Подсказка прокрутки видна, пока сцена закреплена (кадры 414-463).
      const hint = q('[data-pop="hint"]');
      tl.fromTo(hint, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.015 }, 0.008);
      tl.to(hint, { autoAlpha: 0, duration: 0.02 }, 0.975);
    },
    [slots, feed.status],
  );

  useSceneProgress((progress) => {
    const node = root.current;
    if (!node) return;
    node.toggleAttribute('data-typed', progress >= TYPED_AT);

    // Какая панель стопки сейчас верхняя: по ней горит чёрточка индикатора, а при «меньше движения»
    // по ней же панели проявляются (по времени, без сдвига).
    const wides = node.querySelectorAll<HTMLElement>('[data-pop-wide]');
    const active = stackWindows(wides.length).filter((win) => progress >= (win.start + win.end) / 2).length;
    if (active === activeDot.current && wides[active]?.hasAttribute('data-on')) return;
    activeDot.current = active;
    wides.forEach((panel, index) => panel.toggleAttribute('data-on', index <= active));
    node
      .querySelectorAll<HTMLElement>('[data-pop-dot]')
      .forEach((dot, index) => dot.toggleAttribute('data-on', index === active));
  });

  /** Панель получила фокус с клавиатуры: доводим прокрутку до места, где она на экране. */
  const revealOnFocus = (index: number) => (event: FocusEvent<HTMLAnchorElement>) => {
    const panel = event.currentTarget;
    const section = rootRef.current;
    const track = panel.parentElement;
    if (!section || !track || !panel.matches(':focus-visible') || !layout.pinned) return;

    let progress: number;
    if (strip) {
      const startX = (START_X * window.innerWidth) / 100;
      const travel = Math.max(1, track.scrollWidth - window.innerWidth);
      const offset = panel.offsetLeft - window.innerWidth * 0.07;
      // Не раньше кадра 423: к этому моменту первая панель раскрыта целиком.
      progress = Math.max(LEAD_OPEN, Math.min(1, (startX + offset) / (startX + travel)));
    } else {
      const win = stackWindows(items.length)[index - 1];
      progress = win ? win.end + 0.01 : 0.02;
    }
    const start = section.getBoundingClientRect().top + window.scrollY;
    scrollToTarget(start + progress * layout.pinVh * window.innerHeight, { immediate: true });
  };

  return (
    <div ref={root} className={styles.root} data-motion={motion}>
      <h2 className="visually-hidden">{t('events.popular')}</h2>

      {slots > 0 ? (
        <div data-pop="track" className={styles.track}>
          {Array.from({ length: slots }, (_, index) => {
            const event = items[index];
            const lead = index === 0;
            return (
              <Fragment key={event?.id ?? index}>
                <div
                  data-pop={lead ? 'lead-narrow' : undefined}
                  className={styles.narrow}
                  aria-hidden="true"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    className={styles.media}
                    src={NARROW_IMAGES[index % NARROW_IMAGES.length]}
                    alt=""
                    loading={index < 2 ? 'eager' : 'lazy'}
                    decoding="async"
                    draggable={false}
                  />
                  <span className={styles.shade} />
                  {lead ? <span className={cn(styles.eyebrow, 't-caps')}>{copy.eyebrow}</span> : null}
                  {lead ? <span data-pop="flash" className={styles.flash} /> : null}
                </div>

                {event ? (
                  <EventPanel
                    event={event}
                    index={index}
                    today={today}
                    onFocus={revealOnFocus(index)}
                  />
                ) : (
                  <div
                    data-pop={lead ? 'lead-wide' : undefined}
                    data-pop-wide=""
                    className={cn(styles.wide, 'skeleton')}
                    aria-hidden="true"
                  />
                )}
              </Fragment>
            );
          })}
        </div>
      ) : (
        <div className={styles.state} role={feed.status === 'error' ? 'alert' : 'status'}>
          <p className="t-subtitle max-w-[22ch]">{feed.status === 'error' ? t('events.error') : copy.empty}</p>
          {feed.status === 'error' ? (
            <Button
              variant="ghost"
              onClick={() => {
                setFeed({ status: 'loading' });
                setAttempt((count) => count + 1);
              }}
            >
              {t('common.retry')}
            </Button>
          ) : null}
        </div>
      )}

      <div className={styles.below}>
        <Link href={copy.cta.href} className={cn(styles.cta, 't-caps')}>
          <span>
            {ctaHead}
            {/* Последнее слово и стрелка не разрываются: на телефоне стрелка иначе уходит на строку одна */}
            <span className="whitespace-nowrap">
              {ctaTail}
              <ArrowRight size={14} weight="bold" aria-hidden="true" />
            </span>
          </span>
        </Link>

        <p data-pop="hint" className={cn(styles.hint, 't-caps invisible')} aria-hidden="true">
          <span className={styles.hintIcon}>
            <ArrowDown size={11} weight="bold" />
          </span>
          {t('home.scrollHint')}
        </p>

        {items.length > 1 ? (
          <ol className={styles.dots} aria-hidden="true">
            {items.map((event, index) => (
              <li key={event.id} data-pop-dot="" data-on={index === 0 ? '' : undefined} className={styles.dot} />
            ))}
          </ol>
        ) : null}
      </div>
    </div>
  );
}

type EventPanelProps = {
  event: EventListItem;
  index: number;
  today: string | undefined;
  onFocus: (event: FocusEvent<HTMLAnchorElement>) => void;
};

function EventPanel({ event, index, today, onFocus }: EventPanelProps) {
  const { lang } = useT();
  const copy = getHome(lang).popular;
  const lead = index === 0;
  const title = lang === 'ba' && event.title_ba ? event.title_ba : event.title;
  const occurrence =
    event.occurrences.find((item) => item.id === event.primary_occurrence_id) ?? event.occurrences[0];
  const image = event.image ?? NARROW_IMAGES[(index + 2) % NARROW_IMAGES.length];

  return (
    <Link
      href={`/events/${event.id}`}
      data-pop={lead ? 'lead-wide' : undefined}
      data-pop-wide=""
      data-lead={lead ? '' : undefined}
      className={styles.wide}
      onFocus={onFocus}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className={styles.media}
        src={image}
        alt=""
        loading={lead ? 'eager' : 'lazy'}
        decoding="async"
        draggable={false}
      />
      <span className={styles.shade} />
      <span className={styles.frame} />

      <h3 className={styles.title} data-size={titleSize(title)} style={{ ['--pop-word' as string]: longestWord(title) }}>
        {title}
      </h3>

      <div className={styles.info}>
        <dl className={cn(styles.caps, 't-caps')}>
          {occurrence ? (
            <div className={styles.cap}>
              <dt className={cn(styles.capLabel, 'inline')}>{copy.labels.when}</dt>
              <dd className="inline">
                <time dateTime={occurrence.start.local}>{formatOccurrence(occurrence, lang, today)}</time>
              </dd>
            </div>
          ) : null}
          <div className={styles.cap}>
            <dt className={cn(styles.capLabel, 'inline')}>{copy.labels.where}</dt>
            <dd className="inline">
              {pick(event.venue.city_name, lang)}, {event.venue.name}
            </dd>
          </div>
          <div className={styles.cap}>
            <dt className={cn(styles.capLabel, 'inline')}>{copy.labels.price}</dt>
            <dd className="inline" data-num>
              {formatPrice(event.price_summary, lang)}
            </dd>
          </div>
        </dl>

        <div className={styles.foot}>
          {occurrence ? <StatusBadge occurrence={occurrence} size="sm" /> : <span />}
          <span className={cn(styles.open, 't-caps')}>
            <span>{copy.openLabel}</span>
            <ArrowUpRight size={16} weight="bold" aria-hidden="true" />
          </span>
        </div>
      </div>
      {lead ? <span data-pop="flash" className={styles.flash} /> : null}
    </Link>
  );
}

export default function PopularScene() {
  const { t } = useT();
  return (
    <Scene def={def} label={t('events.popular')} backdrop={<div data-pop="glow" className={styles.backdrop} />}>
      <PopularStage />
    </Scene>
  );
}
