'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRef } from 'react';
import type { CSSProperties } from 'react';

import { getHome } from '@/content/home';
import { useT } from '@/lib/i18n';

import { Scene, requestTokenRedraw, useScene, useSceneProgress, useSceneTimeline } from '../../scene-kit';
import { lineIndexes, useCues } from '../blueprint/lib/cues';
import { FILTERS_T, FILTERS_TURNS, WORD_CENTER, WORD_SHRINK, spotFor } from '../blueprint/lib/layout';
import { SceneLink } from '../blueprint/lib/SceneLink';
import { Chars, Words } from '../blueprint/lib/text';
import { useGap } from '../intro/useGap';
import { WordLetters, wordBoxWidthVw } from '../wordmark/Word';
import { FILTERS_UI as U, def, filtersFlip, filtersGap } from './def';
import { ANGLE_FRAME, ANGLE_IMAGE, ANGLE_SCRIM } from './frame';

/**
 * filters: «УМНЫЕ ФИЛЬТРЫ» (S8 референса).
 * От прокрутки: проявление стола, наклон камеры (смена кадра стола), подъём и переворот жетона, тень.
 * По времени после порога: надстрочник, титул из размытия по символам, абзац по строкам, вспышки плашек.
 */

/** Центры плашек на компьютере, в процентах окна: вокруг жетона, который висит в точке (50,6; 57). */
const PILL_SPOTS: readonly (readonly [number, number])[] = [
  [32.5, 49],
  [68.5, 49],
  [30, 65.5],
  [71, 65.5],
  [50.6, 81],
];

function FiltersStage() {
  const { lang } = useT();
  const { env, backdrop } = useScene();
  const copy = getHome(lang).filters;
  const center = spotFor(WORD_CENTER, env.mobile);
  const shadow = useRef<HTMLElement | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const pills = useRef<HTMLUListElement>(null);
  const cta = useRef<HTMLDivElement>(null);

  // Телефон: низ плашек решает, помещается ли жетон в воздухе над сукном (def.ts, liftedFit).
  useGap(filtersGap, stage, pills, cta, [env, lang], requestTokenRedraw);

  // Тень на сукне повторяет силуэт: когда жетон ребром, она сжимается в полосу.
  useSceneProgress((p, e) => {
    if (!shadow.current || !shadow.current.isConnected) shadow.current = backdrop?.querySelector<HTMLElement>('.fl-shadow') ?? null;
    const node = shadow.current;
    if (!node) return;
    const { tilt, lift, flip } = filtersFlip(p);
    const edge = e.reduced ? 1 : Math.abs(Math.cos(Math.PI * 2 * FILTERS_TURNS * flip));
    node.style.opacity = (tilt * (1 - 0.25 * lift)).toFixed(3);
    node.style.transform = `translate3d(${(-lift * 1.6).toFixed(2)}vw, 0, 0) scale(${(1 + 0.12 * lift).toFixed(3)}, ${(0.14 + 0.86 * edge).toFixed(3)})`;
  });

  useSceneTimeline((tl, { q, env: e, backdrop: bg }) => {
    const top = bg?.querySelector('.fl-top') ?? null;
    const angle = bg?.querySelector('.fl-angle') ?? null;
    const d = (range: readonly [number, number]) => range[1] - range[0];
    const move = !e.reduced;

    if (top && angle) {
      // Стол проявляется из тёмного, затем камера уходит под угол: вид сверху сменяется видом сбоку.
      tl.fromTo(top, { opacity: 0 }, { opacity: 1, duration: 0.05 }, 0);
      tl.to(top, { opacity: 0, scale: move ? 1.14 : 1, yPercent: move ? 5 : 0, duration: d(FILTERS_T.tilt), ease: 'power2.inOut' }, FILTERS_T.tilt[0]);
      tl.fromTo(
        angle,
        { opacity: 0, scale: move ? 1.1 : 1, yPercent: move ? -4 : 0 },
        { opacity: 1, scale: 1, yPercent: 0, duration: d(FILTERS_T.tilt), ease: 'power2.inOut' },
        FILTERS_T.tilt[0],
      );
    }
    tl.to(q('.fl-word'), { autoAlpha: 0, duration: d(U.wordOut) }, U.wordOut[0]);
    const pillsOut = e.mobile ? U.pillsOutMobile : U.pillsOut;
    tl.to(q('.fl-pills'), { autoAlpha: 0, yPercent: move ? 1.5 : 0, duration: d(pillsOut) }, pillsOut[0]);
  });

  useCues(
    (cue, { q, env: e }) => {
      const rise = e.reduced ? 0 : 135;
      const hidden = e.reduced ? 0 : 1;
      const blur = e.reduced ? 'blur(0px)' : 'blur(12px)';
      const words = q('.fl-body .w');
      const lines = lineIndexes(words.map((word) => word.parentElement ?? word));
      // На телефоне размытие по символам дорогое: размываются строки целиком.
      const titleParts = e.mobile ? q('.fl-title .fl-line') : q('.fl-title .ch');

      const texts = e.mobile ? U.textsMobile : U.texts;
      cue({ from: texts[0], to: texts[1] }, (tl) => {
        tl.fromTo(q('.fl-eyebrow'), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.25 }, 0);
        tl.fromTo(titleParts, { autoAlpha: 0, filter: blur }, { autoAlpha: 1, filter: 'blur(0px)', duration: 0.45, ease: 'power2.out', stagger: e.mobile ? 0.08 : 0.014 }, 0.08);
        words.forEach((word, index) => {
          tl.fromTo(word, { yPercent: rise, autoAlpha: hidden }, { yPercent: 0, autoAlpha: 1, duration: 0.5, ease: 'power3.out' }, 0.3 + lines[index] * 0.05);
        });
        tl.fromTo(q('.fl-cta'), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.3 }, 0.45);
        tl.addLabel('on');
        // Выход: надстрочник, титул гаснет ровно, абзац построчно сверху вниз.
        tl.to(q('.fl-eyebrow'), { autoAlpha: 0, duration: 0.15 }, 'on');
        tl.to(q('.fl-title'), { autoAlpha: 0, duration: 0.3, ease: 'power1.in' }, 'on');
        words.forEach((word, index) => {
          tl.to(word, { yPercent: -rise, autoAlpha: hidden, duration: 0.28, ease: 'power2.in' }, `on+=${lines[index] * 0.04}`);
        });
        tl.to(q('.fl-cta'), { autoAlpha: 0, duration: 0.2 }, 'on');
      });

      // Плашка: контур, белая вспышка, затем тёмная заливка с текстом.
      q('.fl-pill-link').forEach((pill, index) => {
        const from = U.pills[index];
        if (from === undefined) return;
        const flash = pill.querySelector('.fl-flash');
        cue({ from }, (tl) => {
          tl.fromTo(pill, { autoAlpha: 0, scale: e.reduced ? 1 : 0.92 }, { autoAlpha: 1, scale: 1, duration: 0.3, ease: 'power3.out' }, 0);
          if (flash) tl.fromTo(flash, { opacity: 0.95 }, { opacity: 0, duration: 0.4, ease: 'power2.out' }, 0.08);
        });
      });
    },
    [lang],
  );

  return (
    <div ref={stage} className="relative h-full">
      <div
        className="fl-word pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 text-fg"
        style={{ left: `${(0.5 + center.x) * 100}%`, top: `${(0.5 + center.y) * 100}%`, width: `${wordBoxWidthVw(env.mobile) * WORD_SHRINK}vw` }}
      >
        <WordLetters />
      </div>

      {/*
        Телефон: текст и плашки идут одной колонкой, плашки встают сразу под абзацем при любой высоте
        экрана и длине перевода (раньше они стояли на 35 % высоты и на низком экране ложились на абзац).
        Компьютер: обёртки нет (display: contents), текст и плашки расставлены по экрану сами.
      */}
      <div className="absolute inset-x-(--gutter) top-[10%] flex flex-col items-center md:contents">
        <div className="flex flex-col items-center text-center md:absolute md:inset-x-(--gutter) md:top-[12.1%]">
          <p className="fl-eyebrow t-caps text-fg">{copy.eyebrow}</p>
          <h2 className="fl-title mt-[2.6vh] text-[clamp(30px,9vw,50px)] leading-[0.94] font-semibold tracking-[-0.035em] uppercase md:mt-[4vh] md:text-[clamp(32px,3.54vw,76px)]">
            {copy.title.map((line) => (
              <span key={line} className="fl-line block will-change-[filter,opacity]">
                <Chars text={line} mask={false} />
              </span>
            ))}
          </h2>
          <p className="fl-body mt-[2vh] max-w-[34ch] text-base leading-[1.45] text-fg md:mt-[2.9vh] md:max-w-[25vw] md:text-[clamp(15px,1.25vw,24px)] md:leading-[1.33]">
            <Words text={copy.body} />
          </p>
        </div>

        <ul ref={pills} className="fl-pills mt-[2.2vh] flex flex-wrap justify-center gap-x-2 gap-y-2 md:absolute md:inset-0 md:mt-0 md:block">
          {copy.pills.map((pill, index) => {
            const spot = PILL_SPOTS[index] ?? PILL_SPOTS[0];
            const style = { '--px': `${spot[0]}%`, '--py': `${spot[1]}%` } as CSSProperties;
            return (
              <li key={pill.id} style={style} className="md:absolute md:top-(--py) md:left-(--px) md:-translate-x-1/2 md:-translate-y-1/2">
                <Link
                  href={pill.href}
                  className="fl-pill-link group flex min-h-11 items-center gap-2 rounded-full bg-bg/90 px-3.5 md:flex-col md:gap-1.5 md:rounded-none md:bg-transparent md:px-0"
                >
                  <span className="t-caps text-fg-soft md:rounded-xs md:border md:border-dashed md:border-fg/55 md:px-3 md:py-1 md:text-fg">{pill.label}</span>
                  <span className="t-caps relative inline-flex items-center justify-center overflow-hidden text-fg transition-[background-color] duration-(--duration-fast) ease-out md:min-h-11 md:min-w-[10.7vw] md:rounded-full md:bg-bg/95 md:px-5 md:group-hover:bg-surface-2">
                    {pill.example}
                    <span className="fl-flash pointer-events-none absolute inset-0 hidden rounded-full bg-fg opacity-0 md:block" aria-hidden="true" />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>

      <div ref={cta} className="fl-cta absolute inset-x-0 bottom-[4.5%] flex justify-center md:bottom-[6%]">
        <SceneLink href={copy.cta.href}>{copy.cta.label}</SceneLink>
      </div>
    </div>
  );
}

export default function FiltersScene() {
  const { lang } = useT();
  return (
    <Scene
      def={def}
      label={getHome(lang).filters.eyebrow}
      backdrop={
        <div className="absolute inset-0 min-h-[100lvh] bg-bg">
          <div className="fl-top absolute top-[-17%] left-[-34%] h-[134%] w-[134%] opacity-0 will-change-transform max-md:top-[-20%] max-md:left-[-231%] max-md:h-[140%] max-md:w-[380%]">
            <Image src="/images/scenes/desk.webp" alt="" fill sizes="(min-width: 768px) 134vw, 380vw" className="object-cover" />
            {/* Затемнение заливкой, а не filter: brightness на кадре шире экрана WebKit рисует через буфер во весь кадр */}
            <div className="absolute inset-0 bg-[rgb(0_0_0/0.38)]" />
          </div>
          <div className={`fl-angle opacity-0 will-change-transform ${ANGLE_FRAME}`}>
            <Image src="/images/scenes/desk-angle.webp" alt="" fill sizes="(min-width: 768px) 130vw, 300vw" className={ANGLE_IMAGE} />
            <div className="absolute inset-0 bg-[rgb(0_0_0/0.4)]" />
          </div>
          {/* Затемнение сверху под текст и по краям: временное фото не должно спорить с типографикой. */}
          <div className={ANGLE_SCRIM} />
          <div
            className="fl-shadow absolute top-[74.5%] left-[45.8%] -mt-[5.5vh] -ml-[6.2vw] h-[11vh] w-[12.4vw] rounded-[50%] bg-[radial-gradient(closest-side,oklch(0.06_0.02_150/0.92)_0%,oklch(0.06_0.02_150/0.8)_55%,transparent_100%)] opacity-0 blur-[5px] will-change-transform max-md:top-[87%] max-md:left-[44%] max-md:-mt-[3.5vh] max-md:-ml-[22vw] max-md:h-[7vh] max-md:w-[44vw]"
            aria-hidden="true"
          />
        </div>
      }
    >
      <FiltersStage />
    </Scene>
  );
}
