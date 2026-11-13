'use client';

/**
 * intro: светлая сцена «стол зрителя».
 *
 * Покой: стол на весь экран (подложка под жетоном), знак «АФИША» слева сверху, абзац справа,
 * матовая карточка слева снизу, подпись и плашка со ссылкой снизу справа.
 * Переход в тёмное за 0,4 экрана: стол гаснет с ускорением к концу, абзац уходит в размытие,
 * знак тает на месте, карточка рассыпается перебором символов. Жетон остаётся и растёт (def.ts).
 */

import { ArrowRight } from '@phosphor-icons/react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { getHome } from '@/content/home';
import { useT } from '@/lib/i18n';

import { Scene, requestTokenRedraw, useSceneProgress, useSceneTimeline } from '../../scene-kit';
import { def, INTRO_LATE, introRoom } from './def';
import { DeskPicture } from './DeskPicture';
import { ScrambleText } from './ScrambleText';
import type { ScrambleHandle } from './ScrambleText';
import { StageClicks } from './StageClicks';
import { offsetLeftWithin, offsetWithin } from './useGap';

/** С этой доли сцены уходят знак и карточка, а в шапке проявляется малый логотип. */
const LATE = INTRO_LATE;

/** Кривая гашения стола: медленно, потом обвал (яркость по кадрам 100, 89, 85, 55, 0 %). */
function fall(t: number): number {
  return Math.pow(t, 2.6);
}

/**
 * Пока стол в покое, малый логотип в шапке спрятан: на экране уже стоит крупный знак.
 * Правило живёт здесь, а не в оболочке: оно нужно только этой сцене и включается её же атрибутом.
 */
const HEADER_LOGO_RULE = `
.site-header__logo{transition:opacity .2s cubic-bezier(.23,1,.32,1),transform .3s cubic-bezier(.23,1,.32,1);transform-origin:left center}
body:has([data-intro-rest]) .site-header__logo:not(:focus-visible){opacity:0;transform:translateY(8px) scale(1.2)}
@media (prefers-reduced-motion:reduce){.site-header__logo{transition:opacity .2s linear}body:has([data-intro-rest]) .site-header__logo:not(:focus-visible){transform:none}}
`;

function IntroStage({ posterHidden }: { posterHidden: boolean }) {
  const { lang, t } = useT();
  const copy = getHome(lang).intro;
  const root = useRef<HTMLDivElement>(null);
  const leadBox = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const caption = useRef<HTMLParagraphElement>(null);
  const cardLines = useRef<(ScrambleHandle | null)[]>([]);

  // Телефон: жетон стоит на свободном месте между абзацем, карточкой и подписью (def.ts).
  useEffect(() => {
    const stage = root.current;
    const lead = leadBox.current;
    const cardNode = card.current;
    const side = caption.current;
    if (!stage || !lead || !cardNode || !side) return;
    const measure = () => {
      const width = stage.offsetWidth;
      const height = stage.offsetHeight;
      if (width <= 0 || height <= 0) return;
      introRoom.write({
        top: (offsetWithin(lead, stage) + lead.offsetHeight) / height,
        bottom: offsetWithin(cardNode, stage) / height,
        cardRight: (offsetLeftWithin(cardNode, stage) + cardNode.offsetWidth) / width,
        columnRight: (offsetLeftWithin(lead, stage) + lead.offsetWidth) / width,
        sideTop: offsetWithin(side, stage) / height,
      });
      requestTokenRedraw();
    };
    measure();
    const observer = new ResizeObserver(measure);
    for (const node of [stage, lead, cardNode, side]) observer.observe(node);
    return () => observer.disconnect();
  }, [lang]);

  useSceneTimeline((tl, { q, env, backdrop }) => {
    const desk = [...q('.intro-desk'), ...(backdrop ? Array.from(backdrop.querySelectorAll('.intro-desk')) : [])];

    // Стол: 100 -> 89 % за первую четверть, дальше обвал в чёрный.
    tl.to(desk, { opacity: 0.89, duration: 0.25 }, 0);
    tl.to(desk, { opacity: 0, duration: 0.75, ease: fall }, 0.25);

    // Абзац: гаснет и размывается первым, строки не одновременно.
    tl.to(
      q('.intro-lead'),
      {
        autoAlpha: 0,
        filter: env.reduced ? 'none' : 'blur(6px)',
        duration: 0.5,
        ease: 'power1.in',
        stagger: 0.08,
      },
      0.02,
    );

    // Знак тает на месте, без движения и масштаба.
    tl.to(q('.intro-mark'), { autoAlpha: 0, duration: 0.4 }, 0.5);

    // Карточка, подпись и плашка уходят во второй половине перехода.
    tl.to(q('.intro-late'), { autoAlpha: 0, duration: 0.4 }, LATE);
  });

  useSceneProgress((p, env) => {
    const late = p >= LATE;
    root.current?.toggleAttribute('data-intro-rest', !late);
    for (const line of cardLines.current) line?.set(!late, env.reduced);
  });

  return (
    <div ref={root} className="relative h-full text-fg" data-intro-rest="">
      <style href="intro-header-logo" precedence="default">
        {HEADER_LOGO_RULE}
      </style>
      <StageClicks id={def.id} />

      {/*
        Подложка под жетоном появляется только в браузере. До этого стол показывает этот слой:
        картинка есть уже в разметке с сервера, первый экран не мигает чёрным.
      */}
      <div
        className="pointer-events-none absolute inset-0 transition-[opacity,visibility] duration-300 ease-out data-[hidden]:invisible data-[hidden]:opacity-0"
        data-hidden={posterHidden ? '' : undefined}
        aria-hidden="true"
      >
        <DeskPicture preload />
      </div>

      <h1
        className="intro-mark absolute top-[max(9.3%,5.25rem)] left-(--gutter) md:top-[max(9%,4.75rem)]"
        aria-label={t('common.brandFull')}
      >
        <span
          className="absolute right-0 bottom-full mb-2 block text-[0.75rem] leading-[1.2] font-bold tracking-[0.01em] whitespace-nowrap uppercase md:mb-[0.5vw] md:text-[max(0.75rem,1.2vw)]"
          aria-hidden="true"
        >
          {copy.slogan}
        </span>
        <span
          className="block text-[22.6vw] leading-[0.74] font-extrabold tracking-[-0.03em] uppercase md:text-[10.4vw]"
          aria-hidden="true"
        >
          {copy.wordmark}
        </span>
      </h1>

      <div className="absolute top-[max(20.5%,calc(5.25rem+16.72vw+0.875rem))] right-(--gutter) w-[63%] md:inset-y-0 md:top-0 md:right-auto md:left-[63.9%] md:flex md:w-[31%] md:items-center">
        <div ref={leadBox}>
          <p className="intro-lead text-[1.17rem] leading-[1.22] font-medium tracking-[-0.015em] md:text-[max(1.125rem,1.9vw)] md:leading-[1.26]">
            {copy.tagline.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </p>
          <p className="intro-lead mt-2.5 text-[0.875rem] leading-[1.42] text-fg/90 md:mt-[1vw] md:text-[max(0.9375rem,1.12vw)] md:leading-[1.45]">
            {copy.body}
          </p>
        </div>
      </div>

      {/* Матовая карточка: тёмное стекло, чтобы текст читался на светлом столе */}
      <div
        ref={card}
        className="intro-late absolute bottom-[2.4%] left-(--gutter) flex min-h-[28%] w-[48%] flex-col justify-between gap-6 rounded-xs border border-fg/20 bg-bg/55 p-3.5 backdrop-blur-lg md:top-[58.8%] md:bottom-[3.2%] md:min-h-0 md:w-[max(18.6vw,13.5rem)] md:p-[1.2vw]"
      >
        <h2 className="text-[0.9375rem] leading-[1.2] font-semibold tracking-[-0.01em] uppercase md:text-[max(0.9375rem,1.4vw)]">
          {copy.card.title.map((line, index) => (
            <ScrambleText
              key={line}
              text={line}
              className="block"
              ref={(handle) => {
                cardLines.current[index] = handle;
              }}
            />
          ))}
        </h2>
        <p className="border-t border-fg/25 pt-3 text-[0.8125rem] leading-[1.45] text-fg/90 md:pt-[1vw] md:text-right md:text-[max(0.8125rem,0.94vw)] md:leading-[1.6]">
          {copy.card.note}
        </p>
      </div>

      <p
        ref={caption}
        className="intro-late t-caps absolute right-(--gutter) bottom-[calc(2.4%+4.75rem)] flex max-w-[42%] items-start gap-2 md:right-[calc(3.4%+max(12.6vw,11.5rem)+1.5rem)] md:bottom-[4.2%] md:left-[64.7%] md:max-w-none md:max-lg:right-[3.4%] md:max-lg:bottom-[calc(13.2%+0.75rem)] md:max-lg:left-auto md:max-lg:max-w-[40%]">
        <span className="mt-[0.3em] size-1.5 shrink-0 rounded-full bg-fg" aria-hidden="true" />
        {copy.caption}
      </p>

      <Link
        href={copy.cta.href}
        className="intro-late group absolute right-(--gutter) bottom-[2.4%] flex min-h-14 w-[42%] flex-col justify-center gap-1 rounded-md bg-bg/85 px-3.5 py-2.5 backdrop-blur-sm transition-[background-color,scale] duration-(--duration-press) ease-out active:scale-[0.97] md:right-[3.4%] md:bottom-[3.2%] md:h-[10%] md:w-[max(12.6vw,11.5rem)] md:px-[1vw] pointer-fine:hover:bg-bg"
      >
        <span className="t-caps text-fg-muted">{copy.tag}</span>
        <span className="flex items-center justify-between gap-2 text-[0.875rem] leading-[1.2] font-medium md:text-[max(0.875rem,0.98vw)]">
          {copy.cta.label}
          <ArrowRight
            size={16}
            weight="bold"
            className="shrink-0 transition-[translate] duration-(--duration-fast) ease-out pointer-fine:group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </span>
      </Link>
    </div>
  );
}

export default function IntroScene() {
  const { t } = useT();
  const [deskReady, setDeskReady] = useState(false);

  return (
    <Scene def={def} label={t('common.brandFull')} backdrop={<DeskPicture onReady={() => setDeskReady(true)} />}>
      <IntroStage posterHidden={deskReady} />
    </Scene>
  );
}
