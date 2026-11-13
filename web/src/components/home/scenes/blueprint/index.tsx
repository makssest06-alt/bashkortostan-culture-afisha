'use client';

import { SealCheck } from '@phosphor-icons/react';
import Image from 'next/image';

import { getHome } from '@/content/home';
import { useT } from '@/lib/i18n';

import { Scene, useScene, useSceneTimeline } from '../../scene-kit';
import { BLUEPRINT_T as T, def } from './def';
import { Drawing } from './Drawing';
import { lineIndexes, useCues } from './lib/cues';
import { BLUEPRINT_SPOT, WORD_CENTER, spotFor } from './lib/layout';
import { SceneLink } from './lib/SceneLink';
import { Chars, Words } from './lib/text';
import { Marks } from './Marks';

/**
 * blueprint: «ПРОВЕРЕНО. ЧЕСТНО.» (S6 референса).
 * Вид сверху на стол с жетоном, слева матовая панель. Кромку жетона обводит пунктир с узлами,
 * фото гаснет, остаётся чертёж с направляющими и пометками. Чертёж едет в центр, панель уходит.
 * От прокрутки: фото, обводка, направляющие, пометки, сдвиг. По времени после порога: тексты панели.
 */

const GLASS =
  'bg-fg/[0.09] backdrop-blur-[36px] backdrop-saturate-125 [@media(prefers-reduced-transparency:reduce)]:bg-surface-2 [@media(prefers-reduced-transparency:reduce)]:backdrop-blur-none';
const DASH_RULE = 'bg-[repeating-linear-gradient(90deg,var(--color-fg-soft)_0_2px,transparent_2px_4px)]';

function BlueprintStage() {
  const { lang } = useT();
  const { env } = useScene();
  const copy = getHome(lang).blueprint;
  const stat = `${copy.stat.value} ${copy.stat.label}`;
  const claim = copy.title.join(' ');

  // Скраб: фото, обводка контура, направляющие, пометки, сдвиг чертежа в центр, уход панели.
  useSceneTimeline(
    (tl, { q, env: e, backdrop }) => {
      const photo = backdrop?.querySelector('.bp-photo') ?? null;
      const from = spotFor(BLUEPRINT_SPOT, e.mobile);
      const to = spotFor(WORD_CENTER, e.mobile);
      const d = (range: readonly [number, number]) => range[1] - range[0];

      if (photo) {
        tl.fromTo(photo, { opacity: 0 }, { opacity: 1, duration: d(T.photoIn) }, T.photoIn[0]);
        tl.to(photo, { opacity: 0, duration: d(T.dim) }, T.dim[0]);
      }
      tl.fromTo(q('.bp-glass'), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.05 }, 0);
      tl.to(q('.bp-glass'), { autoAlpha: 0, duration: d(T.panelOut) }, T.panelOut[0]);

      // Обводка: штрих идёт по кромке от верхней точки, узлы встают следом за ним.
      tl.fromTo(q('.bp-trace'), { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: d(T.trace) }, T.trace[0]);
      const nodes = q('.bp-node');
      nodes.forEach((node, index) => {
        // Узлы в разметке идут от правой точки по часовой стрелке, штрих стартует сверху.
        const order = (index + 2) % nodes.length;
        tl.fromTo(
          node,
          { autoAlpha: 0, scale: e.reduced ? 1 : 0.3, transformOrigin: '50% 50%' },
          { autoAlpha: 1, scale: 1, duration: 0.03, ease: 'power2.out' },
          T.trace[0] + 0.01 + (order / nodes.length) * (d(T.trace) - 0.02),
        );
      });
      tl.fromTo(q('.bp-rim2'), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.05 }, T.trace[1] - 0.03);
      tl.fromTo(q('.bp-relief'), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.08 }, T.dim[0]);

      // Направляющие растут от контура наружу.
      tl.fromTo(
        q('.bp-guide-h'),
        { autoAlpha: 0, scaleX: e.reduced ? 1 : 0.26, transformOrigin: '50% 50%' },
        { autoAlpha: 1, scaleX: 1, duration: d(T.guides), ease: 'power2.out', stagger: 0.008 },
        T.guides[0],
      );
      tl.fromTo(
        q('.bp-guide-v'),
        { autoAlpha: 0, scaleY: e.reduced ? 1 : 0.26, transformOrigin: '50% 50%' },
        { autoAlpha: 1, scaleY: 1, duration: d(T.guides), ease: 'power2.out', stagger: 0.008 },
        T.guides[0] + 0.01,
      );

      // Пометки от руки проявляются по очереди и гаснут перед словом.
      tl.fromTo(q('.bp-mark'), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.1, stagger: 0.04 }, T.marks[0]);
      tl.to(q('.bp-mark'), { autoAlpha: 0, duration: 0.07 }, 0.91);

      // Чертёж едет в центр: равномерно, как в оригинале. Копии контура дают шлейф, пока он движется.
      if (!e.reduced) {
        tl.fromTo(q('.bp-copy'), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.06, stagger: 0.025 }, T.slide[0]);
      } else {
        tl.set(q('.bp-copy'), { autoAlpha: 0 }, 0);
      }
      if (e.reduced) {
        // Меньше движения: чертёж не едет, а гаснет на месте. Слово в следующей сцене проявится собранным.
        tl.to(q('.bp-draw'), { autoAlpha: 0, duration: 0.08 }, 0.9);
      } else {
        tl.fromTo(
          q('.bp-draw'),
          { x: 0, y: 0 },
          { x: (to.x - from.x) * e.w, y: (to.y - from.y) * e.h, duration: d(T.slide), ease: 'none' },
          T.slide[0],
        );
      }
      // К стыку со словом остаются два контура, четыре узла с ручками и направляющие.
      tl.to(q('.bp-copy'), { autoAlpha: 0, duration: 0.06 }, 0.9);
      tl.to(q('.bp-relief, .bp-node-diag'), { autoAlpha: 0, duration: 0.08 }, 0.88);
    },
    [lang],
  );

  // По времени: иконка, заголовок, абзац, линейка, титул, подпись справа снизу.
  useCues(
    (cue, { q, env: e }) => {
      const rise = e.reduced ? 0 : 135;
      const hidden = e.reduced ? 0 : 1;
      const scope = e.mobile ? '.bp-m' : '.bp-d';
      const words = q(`${scope} .bp-body .w`);
      const lines = lineIndexes(words.map((word) => word.parentElement ?? word));
      const lastLine = Math.max(0, ...lines);

      cue({ from: T.texts[0], to: T.texts[1] }, (tl) => {
        tl.fromTo(q(`${scope} .bp-icon`), { autoAlpha: 0, scale: e.reduced ? 1 : 0.6 }, { autoAlpha: 1, scale: 1, duration: 0.4, ease: 'power3.out' }, 0);
        tl.fromTo(q(`${scope} .bp-eyebrow .ch`), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.18, stagger: 0.014 }, 0.04);
        words.forEach((word, index) => {
          tl.fromTo(word, { yPercent: rise, autoAlpha: hidden }, { yPercent: 0, autoAlpha: 1, duration: 0.55, ease: 'power3.out' }, 0.1 + lines[index] * 0.05);
        });
        tl.fromTo(q(`${scope} .bp-rule`), { clipPath: 'inset(0% 100% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 0.55, ease: 'power3.out' }, 0.06);
        tl.fromTo(q(`${scope} .bp-stat .ch`), { yPercent: rise, autoAlpha: hidden }, { yPercent: 0, autoAlpha: 1, duration: 0.5, ease: 'power3.out', stagger: 0.016 }, 0.1);
        tl.fromTo(q(`${scope} .bp-fade`), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.35, stagger: 0.06 }, 0.22);
        tl.addLabel('on');

        // Выход: заголовок стирается справа налево, абзац построчно снизу вверх, титул по символам, иконка последней.
        tl.to(q(`${scope} .bp-eyebrow .ch`), { autoAlpha: 0, duration: 0.12, stagger: { each: 0.008, from: 'end' } }, 'on');
        words.forEach((word, index) => {
          tl.to(word, { yPercent: rise, autoAlpha: hidden, duration: 0.3, ease: 'power2.in' }, `on+=${(lastLine - lines[index]) * 0.04}`);
        });
        tl.to(q(`${scope} .bp-stat .ch`), { yPercent: -rise, autoAlpha: hidden, duration: 0.3, ease: 'power2.in', stagger: 0.01 }, 'on');
        tl.to(q(`${scope} .bp-rule`), { clipPath: 'inset(0% 0% 0% 100%)', duration: 0.3, ease: 'power2.in' }, 'on');
        tl.to(q(`${scope} .bp-fade`), { autoAlpha: 0, duration: 0.2 }, 'on+=0.08');
        tl.to(q(`${scope} .bp-icon`), { autoAlpha: 0, scale: e.reduced ? 1 : 0.5, duration: 0.22, ease: 'power2.in' }, 'on+=0.18');
      });
    },
    [lang],
  );

  return (
    <>
      <Drawing />
      <Marks marks={copy.marks} mobile={env.mobile} />

      {/* Компьютер: матовая панель слева на всю высоту, справа снизу подпись и ссылка. */}
      <div className="bp-d hidden md:block">
        <div className="absolute inset-y-0 left-0 w-[32vw]">
          <div className={`bp-glass absolute inset-0 ${GLASS}`} />
          <div className="absolute top-[18%] left-(--gutter) -translate-y-1/2">
            <div className="bp-icon flex size-[4.7vw] items-center justify-center rounded-full bg-fg/15 text-fg">
              <SealCheck weight="bold" aria-hidden="true" className="size-[2vw]" />
            </div>
          </div>
          <h2 className="bp-eyebrow absolute top-[27.2%] left-(--gutter) text-[clamp(14px,1.25vw,24px)] leading-[1.09] font-semibold tracking-[-0.01em] uppercase">
            <Chars text={copy.eyebrow} mask={false} />
          </h2>
          <p className="bp-body absolute top-[31.6%] left-(--gutter) w-[20.5vw] text-[clamp(15px,1.25vw,24px)] leading-[1.33] text-fg">
            <Words text={copy.body} />
          </p>
          <div className="absolute right-[6vw] bottom-[8.1%] left-(--gutter)">
            <span className={`bp-rule block h-px w-full ${DASH_RULE}`} aria-hidden="true" />
            <p className="bp-stat mt-[4.2vh] ml-auto max-w-[22vw] text-right text-[clamp(26px,2.34vw,45px)] leading-none font-semibold tracking-[-0.03em] text-balance uppercase">
              <Chars text={stat} />
            </p>
          </div>
        </div>

        <div className="absolute right-[5vw] bottom-[3.4%] flex items-end gap-[2.5vw]">
          <div className="bp-fade pb-[0.3vw]">
            <SceneLink href={copy.cta.href}>{copy.cta.label}</SceneLink>
          </div>
          <p className="bp-fade text-right text-[clamp(16px,1.67vw,32px)] leading-[1.09] font-medium tracking-[-0.02em] uppercase">
            {copy.title.map((line) => (
              <span key={line} className="block whitespace-nowrap">
                {line}
              </span>
            ))}
          </p>
        </div>
      </div>

      {/* Телефон: «пилюля» сверху, матовая панель снизу на всю внутреннюю ширину. */}
      <div className="bp-m md:hidden">
        <div className="absolute inset-x-0 top-[11%] flex justify-center">
          <div className={`bp-glass flex min-h-14 items-center gap-3 rounded-full py-2 pr-6 pl-2.5 ${GLASS}`}>
            <span className="bp-icon flex size-[37px] items-center justify-center rounded-full bg-fg/15 text-fg">
              <SealCheck weight="bold" size={18} aria-hidden="true" />
            </span>
            <h2 className="bp-eyebrow text-base leading-[1.09] font-semibold uppercase">
              <Chars text={copy.eyebrow} mask={false} />
            </h2>
          </div>
        </div>
        <div className={`bp-glass absolute inset-x-(--gutter) bottom-[5.5%] rounded-md px-5 pt-5 pb-2 text-center ${GLASS}`}>
          <p className="bp-fade t-caps text-fg-soft">{claim}</p>
          <span className={`bp-rule mt-3 block h-px w-full ${DASH_RULE}`} aria-hidden="true" />
          <p className="bp-stat mt-3 text-[27px] leading-[1.07] font-semibold tracking-[-0.03em] text-balance uppercase">
            <Chars text={stat} />
          </p>
          <p className="bp-body mt-3 text-[0.9375rem] leading-[1.45] text-fg">
            <Words text={copy.body} />
          </p>
          <div className="bp-fade mt-1 flex justify-center">
            <SceneLink href={copy.cta.href}>{copy.cta.label}</SceneLink>
          </div>
        </div>
      </div>
    </>
  );
}

export default function BlueprintScene() {
  const { lang } = useT();
  return (
    <Scene
      def={def}
      label={getHome(lang).blueprint.eyebrow}
      backdrop={
        <div className="bp-photo absolute inset-0 min-h-[100lvh] opacity-0">
          <Image
            src="/images/scenes/desk.webp"
            alt=""
            fill
            sizes="100vw"
            className="object-cover object-[73%_50%] md:object-center"
          />
          {/* Временное фото слабое: притушено, чтобы сцену держали жетон и типографика. */}
          <div className="absolute inset-0 bg-bg/40" />
        </div>
      }
    >
      <BlueprintStage />
    </Scene>
  );
}
