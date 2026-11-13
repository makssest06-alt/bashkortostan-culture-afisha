'use client';

import { getHome } from '@/content/home';
import { useT } from '@/lib/i18n';

import { Scene, useScene, useSceneTimeline } from '../../scene-kit';
import { lineIndexes, useCues } from '../blueprint/lib/cues';
import { RIM_RATIO, WORD_CENTER, WORD_SHRINK, spotFor } from '../blueprint/lib/layout';
import { Words } from '../blueprint/lib/text';
import { WORDMARK_T as T, def } from './def';
import { BOWL, CAP, LETTERS, VIEW, VIEW_CENTER } from './glyphs';
import { Word, WordLetters, handoff, wordBoxWidthVw } from './Word';

/**
 * wordmark: знак «АФИША» с построением (S7 референса).
 * Кольцо чертежа из blueprint вырастает в чашу буквы «Ф» и уезжает на её место, остальные буквы
 * разъезжаются из центра и проявляются заливкой. После удержания построение гаснет, слово сжимается
 * до гравировки на жетоне (её подхватывает сцена filters). Всё крупное идёт от прокрутки, подписи по времени.
 */

/** Положение в процентах поля SVG: подписи направляющих стоят в тех же координатах, что и буквы. */
const px = (x: number) => `${((x - VIEW.x) / VIEW.w) * 100}%`;
const py = (y: number) => `${((y - VIEW.y) / VIEW.h) * 100}%`;

const ECHO_OPACITY = [0.3, 0.2, 0.12];

function WordmarkStage() {
  const { lang } = useT();
  const { env } = useScene();
  const copy = getHome(lang).wordmark;
  const center = spotFor(WORD_CENTER, env.mobile);
  const [capLabel, baseLabel, moduleLabel] = copy.guides;

  useSceneTimeline((tl, { q, env: e }) => {
    const d = (range: readonly [number, number]) => range[1] - range[0];
    const fills = q('.wm-fill');
    const cells = q('.wm-cell');

    if (e.reduced) {
      // Меньше движения: слово с построением проявляется собранным и так же гаснет.
      tl.set(q('.wm-ghost, .wm-echo, .wm-frame'), { autoAlpha: 0 }, 0);
      tl.set(q('.wm-letters'), { opacity: 0.4 }, 0);
      tl.fromTo(q('.wm-word'), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.14 }, 0.02);
      tl.to(q('.wm-word'), { autoAlpha: 0, duration: 0.1 }, 0.88);
      return;
    }

    const { r0 } = handoff(e.mobile);
    const moveX = VIEW_CENTER.x - BOWL.cx;
    const grow = { duration: d(T.grow), ease: 'power1.inOut' };

    // 1. Кольцо чертежа (как в конце blueprint) вырастает в овал чаши «Ф».
    tl.fromTo(q('.wm-ring-outer'), { scaleX: r0 / BOWL.rx, scaleY: r0 / BOWL.ry, transformOrigin: '50% 50%' }, { scaleX: 1, scaleY: 1, ...grow }, T.grow[0]);
    tl.fromTo(
      q('.wm-ring-inner'),
      { scaleX: (r0 * RIM_RATIO) / BOWL.innerRx, scaleY: (r0 * RIM_RATIO) / BOWL.innerRy, transformOrigin: '50% 50%' },
      { scaleX: 1, scaleY: 1, ...grow },
      T.grow[0],
    );
    const nodeFrom = [{ x: r0 - BOWL.rx, y: 0 }, { x: 0, y: r0 - BOWL.ry }, { x: BOWL.rx - r0, y: 0 }, { x: 0, y: BOWL.ry - r0 }];
    q('.wm-node').forEach((node, index) => {
      tl.fromTo(node, nodeFrom[index] ?? { x: 0, y: 0 }, { x: 0, y: 0, ...grow }, T.grow[0]);
    });
    tl.fromTo(q('.wm-node .wm-handle'), { scale: 0.48, transformOrigin: '50% 50%' }, { scale: 1, ...grow }, T.grow[0]);

    // Направляющие чертежа расходятся к типографским линиям: вертикали к краям чаши и стойке, горизонтали к строке.
    const vFrom = [BOWL.rx - r0, BOWL.cx - r0 * RIM_RATIO - BOWL.stem[0], BOWL.cx + r0 * RIM_RATIO - BOWL.stem[1], r0 - BOWL.rx];
    q('.wm-guide-v').forEach((line, index) => {
      tl.fromTo(line, { x: vFrom[index] ?? 0 }, { x: 0, ...grow }, T.grow[0]);
    });
    const hFrom = [BOWL.cy - r0, BOWL.cy - r0 * RIM_RATIO - (BOWL.cy - BOWL.ry), BOWL.cy + r0 * RIM_RATIO - (BOWL.cy + BOWL.ry), BOWL.cy + r0 - CAP];
    const hScale = handoff(e.mobile).guideHalf / (VIEW.w / 2);
    q('.wm-guide-h').forEach((line, index) => {
      tl.fromTo(line, { y: hFrom[index] ?? 0 }, { y: 0, ...grow }, T.grow[0]);
      tl.fromTo(line, { scaleX: hScale, transformOrigin: '50% 50%' }, { scaleX: 1, duration: d(T.split), ease: 'power2.out' }, T.split[0]);
    });

    // 2. Кольцо уезжает на место «Ф», за ним догоняют эхо-копии. Буквы разъезжаются из центра.
    tl.fromTo(q('.wm-ring'), { x: moveX }, { x: 0, duration: d(T.split), ease: 'power2.inOut' }, T.split[0]);
    q('.wm-ghost').forEach((ghost, index) => {
      const lag = 0.016 * (index + 1);
      tl.fromTo(ghost, { x: moveX }, { x: 0, duration: d(T.split), ease: 'power2.inOut' }, T.split[0] + lag);
      tl.fromTo(ghost, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.02 }, T.split[0] + 0.01);
      tl.to(ghost, { autoAlpha: 0, duration: 0.04 }, T.split[1] + lag - 0.03);
    });
    cells.forEach((cell, index) => {
      const letter = LETTERS[index];
      if (!letter || index === 1) return;
      const letterCenter = letter.x + (letter.left + letter.right) / 2;
      tl.fromTo(cell, { x: (VIEW_CENTER.x - letterCenter) * 0.55 }, { x: 0, duration: d(T.split), ease: 'power2.out' }, T.split[0]);
    });
    fills.forEach((fill, index) => {
      const late = index === 1 ? 0.07 : 0.03;
      tl.fromTo(fill, { autoAlpha: 0 }, { autoAlpha: 1, duration: d(T.split) - late, ease: 'power1.in' }, T.split[0] + late);
    });
    tl.fromTo(q('.wm-letters'), { opacity: 0.4 }, { opacity: 1, duration: 0.14 }, 0.82);
    tl.fromTo(q('.wm-frame'), { autoAlpha: 0 }, { autoAlpha: 0.7, duration: 0.05 }, T.split[0] + 0.04);
    tl.to(q('.wm-frame'), { autoAlpha: 0, duration: 0.06 }, T.split[1] + 0.01);
    tl.fromTo(q('.wm-node-late'), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.05, stagger: 0.004 }, T.split[1] - 0.03);

    // 3. Построение гаснет, слово сжимается вокруг своего центра. Эхо отстаёт и догоняет к концу.
    tl.to(q('.wm-build'), { autoAlpha: 0, duration: d(T.buildOut) }, T.buildOut[0]);
    tl.fromTo(q('.wm-word'), { scale: 1 }, { scale: WORD_SHRINK, duration: d(T.shrink), ease: 'sine.inOut' }, T.shrink[0]);
    q('.wm-echo').forEach((echo, index) => {
      const lag = 0.016 * (index + 1);
      tl.fromTo(echo, { scale: 1 }, { scale: WORD_SHRINK, duration: d(T.shrink) - lag, ease: 'sine.inOut' }, T.shrink[0] + lag);
      tl.fromTo(echo, { autoAlpha: 0 }, { autoAlpha: ECHO_OPACITY[index] ?? 0.1, duration: 0.03 }, T.shrink[0] + 0.02);
      tl.to(echo, { autoAlpha: 0, duration: 0.05 }, 0.94);
    });
  });

  useCues(
    (cue, { q, env: e }) => {
      const rise = e.reduced ? 0 : 135;
      const hidden = e.reduced ? 0 : 1;
      const words = q('.wm-body .w');
      const lines = lineIndexes(words.map((word) => word.parentElement ?? word));
      cue({ from: T.texts[0], to: T.texts[1] }, (tl) => {
        tl.fromTo(q('.wm-eyebrow'), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.3 }, 0);
        tl.fromTo(q('.wm-label'), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.3, stagger: 0.06 }, 0.05);
        words.forEach((word, index) => {
          tl.fromTo(word, { yPercent: rise, autoAlpha: hidden }, { yPercent: 0, autoAlpha: 1, duration: 0.55, ease: 'power3.out' }, 0.08 + lines[index] * 0.05);
        });
      });
    },
    [lang],
  );

  return (
    <>
      <h2 className="visually-hidden">{copy.word}</h2>
      <p className="wm-eyebrow t-caps absolute inset-x-0 top-[16%] text-center text-fg-soft md:top-[12.2%]">{copy.eyebrow}</p>

      <div
        className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
        style={{ left: `${(0.5 + center.x) * 100}%`, top: `${(0.5 + center.y) * 100}%`, width: `${wordBoxWidthVw(env.mobile)}vw` }}
      >
        {ECHO_OPACITY.map((opacity) => (
          <WordLetters key={opacity} className="wm-echo invisible absolute inset-0 text-fg will-change-transform" />
        ))}
        <div className="wm-word relative will-change-transform">
          <Word mobile={env.mobile} />
          <span className="wm-label wm-build t-caps absolute -translate-y-full pb-1.5 whitespace-nowrap text-fg-soft" style={{ left: px(LETTERS[0].left), top: py(0) }}>
            {capLabel}
          </span>
          <span className="wm-label wm-build t-caps absolute pt-1.5 whitespace-nowrap text-fg-soft" style={{ left: px(LETTERS[0].left), top: py(CAP) }}>
            {baseLabel}
          </span>
          <span
            className="wm-label wm-build t-caps absolute -translate-x-1/2 -translate-y-full pb-1.5 whitespace-nowrap text-fg-soft max-md:-mt-4"
            style={{ left: px((BOWL.stem[0] + BOWL.stem[1]) / 2), top: py(-150) }}
          >
            {moduleLabel}
          </span>
        </div>
      </div>

      <p className="wm-body absolute inset-x-(--gutter) top-[64%] mx-auto max-w-[34ch] text-center text-[0.9375rem] leading-[1.45] text-fg md:top-auto md:bottom-[9.5%] md:max-w-[30vw] md:text-[clamp(15px,1.25vw,24px)] md:leading-[1.33]">
        <Words text={copy.body} />
      </p>
    </>
  );
}

export default function WordmarkScene() {
  const { lang } = useT();
  return (
    <Scene def={def} label={getHome(lang).wordmark.word}>
      <WordmarkStage />
    </Scene>
  );
}
