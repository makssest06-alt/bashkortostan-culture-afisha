'use client';

/**
 * Сцена gallery: «НА ЛЮБОЙ ВКУС, есть куда пойти».
 *
 * Вступление (S3a): точка, окружность и пунктирный квадрат вокруг жетона, гигантская фраза въезжает справа
 * и проходит позади жетона, билетный конверт рвётся, фраза вспыхивает и сжимается в подзаголовок,
 * квадрат вытягивается в портретную рамку, жетон садится на первую карточку.
 * Галерея (S3b): шесть категорий идут шагами под прокрутку, по бокам ленты миниатюр.
 * Выход (S3c): последняя карточка «Театр» остаётся чистым прямоугольником: из него сцена fullscreen
 * раскрывает окно на весь экран.
 *
 * Раскладка по прогрессу: ./timing.ts. Геометрия: ./frame.module.css. Поза жетона: ./def.ts.
 */

import { ArrowRight, CaretDown } from '@phosphor-icons/react';
import Link from 'next/link';
import { useEffect, useRef } from 'react';
import type { FocusEvent } from 'react';

import { scrollToTarget } from '@/components/shell/scroll';
import { Skeleton } from '@/components/ui';
import { getHome } from '@/content/home';
import type { GalleryCopy } from '@/content/home';
import { getFacets } from '@/lib/api/client';
import type { CategoryId, FacetsResponse } from '@/lib/api/types';
import { cn } from '@/lib/cn';
import { gsap, ScrollTrigger } from '@/lib/gsap';
import { useT } from '@/lib/i18n';

import { Scene, useScene, useSceneProgress, useSceneTimeline } from '../../scene-kit';
import { def } from './def';
import frame from './frame.module.css';
import styles from './gallery.module.css';
import { GalleryBackdrop } from './GalleryBackdrop';
import { scrambleText } from './scramble';
import { CARD_COUNT, galleryTiming } from './timing';
import { useRemote } from './useRemote';
import type { Remote } from './useRemote';

/** Какую долю ширины окна занимает гигантская фраза: между полями на компьютере, по ширине рамки на телефоне. */
const PHRASE_WIDTH = { desktop: 0.94, mobile: 0.8 };

type StageProps = {
  copy: GalleryCopy;
  facets: Remote<FacetsResponse>;
};

function GalleryStage({ copy, facets }: StageProps) {
  const { t } = useT();
  const { backdrop, env, rootRef } = useScene();
  const stageRef = useRef<HTMLDivElement>(null);
  const captionRef = useRef<HTMLSpanElement>(null);
  const captionOn = useRef(false);
  const hintOn = useRef(false);
  const cards = copy.cards.slice(0, CARD_COUNT);

  // Кегль гигантской фразы подгоняется под ширину: русская и башкирская строки разной длины.
  useEffect(() => {
    const phrase = backdrop?.querySelector<HTMLElement>('[data-g="phrase"]');
    if (!phrase) return;
    let alive = true;
    const fit = () => {
      if (!alive || phrase.offsetWidth === 0) return;
      const fontSize = Number.parseFloat(window.getComputedStyle(phrase).fontSize);
      const target = (env.mobile ? PHRASE_WIDTH.mobile : PHRASE_WIDTH.desktop) * window.innerWidth;
      const fitted = (fontSize * target) / phrase.offsetWidth;
      phrase.style.setProperty('--pf', ((fitted / window.innerWidth) * 100).toFixed(3));
    };
    fit();
    // Шрифт мог ещё не загрузиться: после загрузки ширина строки другая.
    void document.fonts?.ready.then(fit);
    return () => {
      alive = false;
    };
  }, [backdrop, env.w, env.mobile, copy.phrase]);

  // Подписи идут по времени: порог прокрутки включает их, дальше работают переходы в CSS.
  useSceneProgress((progress, sceneEnv) => {
    const stage = stageRef.current;
    if (!stage) return;
    const { at, exitAt } = galleryTiming(sceneEnv.mobile);

    const showCaption = progress >= at(0.13);
    if (showCaption !== captionOn.current) {
      captionOn.current = showCaption;
      stage.toggleAttribute('data-caption', showCaption);
      const node = captionRef.current;
      if (showCaption && node && !sceneEnv.reduced && progress < at(0.4)) scrambleText(node, copy.caption);
    }
    const showHint = progress >= at(0.17) && progress < exitAt(0.8);
    if (showHint !== hintOn.current) {
      hintOn.current = showHint;
      stage.toggleAttribute('data-hint', showHint);
    }
  });

  useSceneTimeline(
    (tl, { q, env: sceneEnv, backdrop: layer }) => {
      if (!layer) return;
      const b = gsap.utils.selector(layer);
      const { mobile, reduced, w, h } = sceneEnv;
      const { at, exitAt, step, stepMove, stepsStart } = galleryTiming(mobile);

      const frameNode = b('[data-g="frame"]');
      const edges = b('[data-g="edges"]');
      const circle = b('[data-g="circle"]');
      const phrase = b('[data-g="phrase"]');
      const glow = b('[data-g="glow"]');
      const wrap = b('[data-g="wrap"]');
      const cardNodes = b('[data-g="card"]');
      const zooms = b('[data-g="zoom"]');
      const tracks = b('[data-g="track"]');
      const seams = b('[data-g="seam"]');
      const stripLeft = b('[data-g="strip-l"]');
      const stripRight = b('[data-g="strip-r"]');
      const caption = q('[data-g="caption"]');
      const sub = q('[data-g="sub"]');
      const links = q('[data-g="link"]');
      const last = CARD_COUNT - 1;

      // ---------------------------------------------------------------- S3a: рамка и фраза

      tl.fromTo(
        b('[data-g="dot"]'),
        { opacity: 0, scale: reduced ? 1 : 0.5 },
        { opacity: 1, scale: 1, duration: at(0.1), ease: 'power2.out' },
        0,
      );
      tl.fromTo(
        circle,
        { opacity: 0, scale: reduced ? 1 : 0.77 },
        { opacity: 1, scale: 1, duration: at(0.2), ease: 'power2.out' },
        0,
      );
      tl.to(circle, { opacity: 0, duration: at(0.07) }, at(0.53));

      if (reduced) {
        // Меньше движения: стороны не рисуются, квадрат проявляется целиком.
        gsap.set(frameNode, { '--d': 1 });
        tl.fromTo(edges, { opacity: 0 }, { opacity: 1, duration: at(0.1) }, at(0.13));
      } else {
        // Стороны квадрата рисуются «вертушкой»: каждая от своего угла, одновременно.
        tl.fromTo(frameNode, { '--d': 0 }, { '--d': 1, duration: at(0.085) }, at(0.13));
      }

      // Квадрат вытягивается в портретную рамку, центр на месте.
      tl.fromTo(
        frameNode,
        { '--m': 0 },
        { '--m': 1, duration: at(0.2), ease: reduced ? 'steps(1)' : 'power2.inOut' },
        at(0.53),
      );

      if (reduced) {
        gsap.set(phrase, { '--px': 0 });
        tl.fromTo(phrase, { opacity: 0 }, { opacity: 1, duration: at(0.1) }, at(0.23));
        tl.to(phrase, { autoAlpha: 0, duration: at(0.12) }, at(0.72));
        tl.fromTo(sub, { opacity: 0 }, { opacity: 1, duration: at(0.12) }, at(0.84));
      } else {
        // Фраза въезжает справа и едет влево почти линейно, останавливается без отскока.
        // По кадрам левый край: 94 % W на 23 % вступления, 60 % на 30 %, 3 % на 43 %.
        tl.fromTo(phrase, { '--px': 97 }, { '--px': 0, duration: at(0.215), ease: 'none' }, at(0.215));
        // Вспышка свечения, затем спад вместе со сжатием.
        // autoAlpha: погашенное свечение уходит в visibility: hidden и не держит свой слой в отрисовке.
        tl.fromTo(glow, { autoAlpha: 0 }, { autoAlpha: 1, duration: at(0.06), ease: 'power2.out' }, at(0.57));
        tl.to(glow, { autoAlpha: 0, duration: at(0.17) }, at(0.7));
        // Сжатие в подзаголовок от левого верхнего угла; в конце гигантскую строку сменяет настоящий текст.
        tl.fromTo(phrase, { '--c': 0 }, { '--c': 1, duration: at(0.3), ease: 'power1.inOut' }, at(0.7));
        // autoAlpha: скрытая фраза отпускает свой слой (will-change), WebKit иначе держит его текстуру.
        tl.to(phrase, { autoAlpha: 0, duration: at(0.02) }, at(0.98));
        tl.fromTo(sub, { opacity: 0 }, { opacity: 1, duration: at(0.02) }, at(0.98));
      }

      // Малая подпись: появляется по центру высоты, уступает место фразе, затем встаёт над подзаголовком.
      if (!reduced) {
        if (mobile) {
          // Телефон: подпись стоит над квадратом, поднимается вместе с верхним краем рамки,
          // а затем ещё на высоту подзаголовка, который встаёт между ней и рамкой.
          const photoHeight = Math.min(1.039 * w, 0.56 * h);
          const squareHeight = Math.min(0.8 * w + 12, 0.46 * h);
          const edgeLift = (photoHeight - squareHeight) / 2 + 6;
          tl.fromTo(caption, { y: edgeLift }, { y: 0, duration: at(0.2), ease: 'power2.inOut' }, at(0.53));
          tl.fromTo(
            q('[data-g="caption-inner"]'),
            { y: 6 + 0.093 * w },
            { y: 0, duration: at(0.24), ease: 'power1.inOut' },
            at(0.74),
          );
        } else {
          tl.fromTo(caption, { y: 0.222 * h }, { y: 0.055 * h, duration: at(0.14), ease: 'power2.out' }, at(0.23));
          tl.to(caption, { y: 0, duration: at(0.3) }, at(0.7));
        }
      }

      // Билетный конверт: проявляется вокруг жетона и рвётся на две половины.
      // autoAlpha: вне своей жизни конверт скрыт (visibility), его слои не держат память.
      tl.fromTo(
        wrap,
        { autoAlpha: 0, scale: reduced ? 1 : 0.9 },
        { autoAlpha: 1, scale: 1, duration: at(0.06), ease: 'power2.out' },
        at(0.27),
      );
      if (reduced) {
        tl.to(wrap, { autoAlpha: 0, duration: at(0.1) }, at(0.47));
      } else {
        // Две ленты летят влево и вправо поверх фразы, сминаясь по пути: к 60 % вступления они у краёв окна.
        tl.to(
          b('[data-g="wrap-l"]'),
          { x: -0.64 * w, y: 0.04 * h, rotation: -38, scaleY: 0.5, duration: at(0.14), ease: 'power1.in' },
          at(0.48),
        );
        tl.to(
          b('[data-g="wrap-r"]'),
          { x: 0.64 * w, y: -0.05 * h, rotation: 30, scaleY: 0.5, duration: at(0.14), ease: 'power1.in' },
          at(0.48),
        );
        tl.set(wrap, { autoAlpha: 0 }, at(0.63));
      }

      // Рамка заливается «матовым стеклом», поверх проявляется первая карточка.
      tl.fromTo(b('[data-g="glass"]'), { autoAlpha: 0 }, { autoAlpha: 1, duration: at(0.04) }, at(0.69));
      tl.fromTo(cardNodes[0], { opacity: 0 }, { opacity: 1, duration: at(0.17), ease: 'power2.out' }, at(0.73));
      tl.fromTo(links[0], { opacity: 0 }, { opacity: 1, duration: at(0.08) }, at(0.88));
      tl.set(links[0], { pointerEvents: 'auto' }, at(0.88));

      // ---------------------------------------------------------------- S3b: лента карточек

      if (!mobile) {
        // Пока стоит первая карточка, миниатюр нет. Правая лента въезжает с края окна на первом шаге.
        tl.fromTo(
          stripRight,
          { opacity: 0, x: reduced ? 0 : 0.34 * w },
          { opacity: 1, x: 0, duration: stepMove * 1.3, ease: 'power2.out' },
          stepsStart - stepMove * 0.3,
        );
        tl.fromTo(stripLeft, { opacity: 0 }, { opacity: 1, duration: 0.01 }, stepsStart - 0.01);
      }

      // Шаги ленты на мягкой кривой sine.inOut: без резкого разгона и торможения движение под прокруткой ровнее.
      const stepWidth = 0.133 * w;
      for (let index = 1; index < CARD_COUNT; index += 1) {
        const start = stepsStart + step * (index - 1);
        // Последняя карточка стоит в «обложечном» кадрировании: крупнее на 20 %, отъезд будет в S3c.
        const rest = index === last && !reduced ? 1.2 : 1;

        if (reduced) {
          tl.fromTo(cardNodes[index], { opacity: 0 }, { opacity: 1, duration: stepMove }, start);
        } else if (mobile) {
          // Телефон: карточки сменяются сдвигом внутри рамки, шаг равен ширине рамки.
          tl.fromTo(
            cardNodes[index],
            { xPercent: 100 },
            { xPercent: 0, duration: stepMove, ease: 'sine.inOut' },
            start,
          );
          tl.to(cardNodes[index - 1], { xPercent: -100, duration: stepMove, ease: 'sine.inOut' }, start);
          tl.fromTo(
            zooms[index],
            { scale: 1.34 * rest },
            { scale: rest, duration: stepMove, ease: 'sine.inOut' },
            start,
          );
        } else {
          // Компьютер: новое фото въезжает справа налево из-под обрезки, старое уходит влево.
          tl.fromTo(
            cardNodes[index],
            { clipPath: 'inset(0% 0% 0% 100%)', xPercent: 8 },
            { clipPath: 'inset(0% 0% 0% 0%)', xPercent: 0, duration: stepMove, ease: 'sine.inOut' },
            start,
          );
          tl.to(cardNodes[index - 1], { xPercent: -15, duration: stepMove, ease: 'sine.inOut' }, start);
          tl.fromTo(
            zooms[index],
            { scale: 1.25 * rest },
            { scale: rest, duration: stepMove, ease: 'sine.inOut' },
            start,
          );
          tl.to(tracks, { x: -index * stepWidth, duration: stepMove, ease: 'sine.inOut' }, start);
          // Шов едет вместе с границей нового фото: центр полосы на линии обрезки.
          const seam = seams[index - 1];
          tl.fromTo(seam, { xPercent: 719 }, { xPercent: -50, duration: stepMove, ease: 'sine.inOut' }, start);
          tl.to(seam, { autoAlpha: 1, duration: stepMove * 0.12 }, start);
          tl.to(seam, { autoAlpha: 0, duration: stepMove * 0.18 }, start + stepMove * 0.82);
        }
        if (reduced && !mobile) tl.set(tracks, { x: -index * stepWidth }, start + stepMove / 2);

        // Полоса с подписью и ссылка: уходят с прошлой карточкой, приходят с новой.
        tl.to(links[index - 1], { opacity: 0, duration: stepMove * 0.4 }, start);
        tl.set(links[index - 1], { pointerEvents: 'none' }, start + stepMove * 0.4);
        tl.fromTo(links[index], { opacity: 0 }, { opacity: 1, duration: stepMove * 0.4 }, start + stepMove * 0.6);
        tl.set(links[index], { pointerEvents: 'auto' }, start + stepMove * 0.6);
      }

      // ---------------------------------------------------------------- S3c: чистый прямоугольник

      if (!reduced) {
        // Отъезд камеры: кадр из «обложечного» приходит в рабочий, тот же, что у окна сцены fullscreen.
        tl.to(zooms[last], { scale: 1, duration: exitAt(0.8) - exitAt(0.25), ease: 'none' }, exitAt(0.25));
      }
      if (!mobile) tl.to(stripLeft, { opacity: 0, duration: exitAt(0.55) - exitAt(0.3) }, exitAt(0.3));

      // Оформление «обложки» снимается: крупное слово уезжает вверх за край рамки, полоса тает.
      const coverTime = exitAt(0.85) - exitAt(0.5);
      tl.to(
        b('[data-g="cover"]'),
        reduced ? { opacity: 0, duration: coverTime } : { yPercent: -160, duration: coverTime, ease: 'power1.in' },
        exitAt(0.5),
      );
      tl.to(b('[data-g="cover-shade"]'), { opacity: 0, duration: coverTime }, exitAt(0.5));
      tl.to(links[last], { opacity: 0, duration: exitAt(0.7) - exitAt(0.5) }, exitAt(0.5));
      tl.set(links[last], { pointerEvents: 'none' }, exitAt(0.7));

      tl.to(edges, { opacity: 0, duration: exitAt(0.8) - exitAt(0.6) }, exitAt(0.6));
      // Подписи гаснут за 6 % выхода: при любой длине выхода таймлайн не выходит за 1.
      const blink = (1 - exitAt(0)) * 0.06;
      tl.to(caption, { autoAlpha: 0, duration: blink }, exitAt(0.88));
      tl.to(sub, { autoAlpha: 0, duration: blink }, exitAt(0.93));
    },
    [copy.phrase],
  );

  /** Фокус с клавиатуры на ссылке категории: лента доезжает до её карточки. */
  const onLinkFocus = (index: number) => (event: FocusEvent<HTMLAnchorElement>) => {
    if (!event.currentTarget.matches(':focus-visible')) return;
    const section = rootRef.current;
    const trigger = ScrollTrigger.getAll().find(
      (item) => Boolean(item.pin) && item.trigger instanceof Node && Boolean(section?.contains(item.trigger)),
    );
    if (!trigger) return;
    scrollToTarget(trigger.start + (trigger.end - trigger.start) * galleryTiming(env.mobile).cardRest(index));
  };

  const countOf = (id: CategoryId | null): number | null => {
    if (id === null || facets.status !== 'ready') return null;
    return facets.data.categories.find((entry) => entry.id === id)?.count ?? null;
  };

  return (
    <div ref={stageRef} className={cn(frame.vars, styles.stage)}>
      <h2 className={styles.heading}>
        <span className={styles.caption} data-g="caption">
          <span className={styles.captionInner} data-g="caption-inner">
            <span ref={captionRef} aria-hidden="true">
              {copy.caption}
            </span>
            <span className="visually-hidden">{copy.caption}</span>
          </span>
        </span>{' '}
        <span className={styles.sub} data-g="sub">
          {copy.phrase}
        </span>
      </h2>

      <nav className={styles.links} aria-label={t('event.category')}>
        {cards.map((card, index) => {
          const count = countOf(card.category);
          return (
            <Link key={card.id} href={card.href} className={styles.link} data-g="link" onFocus={onLinkFocus(index)}>
              <span className={styles.bar}>
                <span className={styles.barText}>
                  <span className={styles.barLabel}>{card.label}</span>
                  <span className={styles.barMeta}>
                    {facets.status === 'loading' ? (
                      <Skeleton className="my-[0.1em] h-[1em] w-[9ch]" />
                    ) : count !== null ? (
                      <span className={styles.barCount} data-num>
                        {t('events.count', { count })}
                      </span>
                    ) : null}
                    <span>{card.note}</span>
                  </span>
                </span>
                <span className={styles.barCta}>
                  {copy.cardCta}
                  <ArrowRight size={16} weight="bold" aria-hidden="true" className={styles.barArrow} />
                </span>
              </span>
            </Link>
          );
        })}
      </nav>

      <p className={cn(styles.hint, 't-caps')} aria-hidden="true">
        <span className={styles.hintIcon}>
          <CaretDown size={12} weight="bold" />
        </span>
        {t('home.scrollHint')}
      </p>
    </div>
  );
}

export default function GalleryScene() {
  const { lang } = useT();
  const home = getHome(lang);
  const copy = home.gallery;
  // Число событий по категориям: один запрос счётчиков без условий.
  const [facets] = useRemote((signal) => getFacets({}, { signal }));

  return (
    <Scene
      def={def}
      label={`${copy.caption} ${copy.phrase}`}
      backdrop={
        <GalleryBackdrop phrase={copy.phrase} wrapWord={home.intro.wordmark} cards={copy.cards.slice(0, CARD_COUNT)} />
      }
    >
      <GalleryStage copy={copy} facets={facets} />
    </Scene>
  );
}
