'use client';

/**
 * ai: «Подберёт ИИ».
 *
 * Заголовок сверху по центру, жетон в центре, снизу поднимается рука. Под жетоном наше добавление:
 * большая строка свободного запроса, быстрые подборки и пометка о том, кто разбирает запрос.
 * На телефоне заголовок стоит в две строки слева, подпись под ним, строка запроса у нижнего края.
 *
 * Доли сцены (кадры 28-70 референса):
 *   2-12 %    заголовок проявляется по буквам из размытия, слева направо;
 *   5 %       метка под заголовком (перебор символов, по времени);
 *   7-21 %    рука поднимается снизу; жетон уменьшается до 24 % (def.ts);
 *   21 %      звёздочка у заголовка;
 *   24-33 %   строка запроса встаёт на место подписи и подсказки референса, подпись набирается построчно;
 *   33-93 %   всё стоит (на этом отрезке картинка неподвижна: см. useKeyboardGuard);
 *   52-93 %   радужная кайма (включается за 0,2 с, гаснет за 0,1 с; горит и пока поле в фокусе);
 *   93-100 %  заголовок, строка запроса и рука гаснут.
 * Сноска справа снизу продолжает сноску hero и уходит вместе со сценой.
 */

import { useEffect, useMemo, useRef } from 'react';
import type { CSSProperties } from 'react';

import { getHome } from '@/content/home';
import { useT } from '@/lib/i18n';

import { Scene, requestTokenRedraw, useScene, useSceneProgress, useSceneTimeline } from '../../scene-kit';
import { Footnote } from '../hero/Footnote';
import { SplitChars } from '../hero/Split';
import { ScrambleText } from '../intro/ScrambleText';
import type { ScrambleHandle } from '../intro/ScrambleText';
import { StageClicks } from '../intro/StageClicks';
import { useGap } from '../intro/useGap';
import { AskLine } from './AskLine';
import type { AskLineHandle } from './AskLine';
import { AI_SETTLED, def } from './def';
import { Hand } from './Hand';
import { RgbEdge } from './RgbEdge';
import type { RgbEdgeHandle } from './RgbEdge';
import { aiDeskGap, aiGap, aiRest } from './slot';
import { useKeyboardGuard } from './useKeyboardGuard';

/** Пороги сцены. */
const LABEL_ON = 0.05;
const ASK_ON = AI_SETTLED;
const TYPE_ON = 0.27;
const EDGE_ON = 0.52;
const EXIT = 0.93;
/** Отрезок, где сцена неподвижна: строка запроса уже встала, выход ещё не начался. */
const STILL_FROM = 0.34;
const STILL_TO = 0.92;

/** Заголовок на телефоне: две строки примерно равной длины и кегль, при котором длинная влезает в ширину. */
function splitTitle(title: string): { lines: string[]; mobileVw: number } {
  const words = title.split(' ');
  let lines = [title];
  let longest = title.length;
  for (let index = 1; index < words.length; index += 1) {
    const first = words.slice(0, index).join(' ');
    const second = words.slice(index).join(' ');
    const length = Math.max(first.length, second.length);
    if (length < longest) {
      lines = [first, second];
      longest = length;
    }
  }
  // Средняя ширина знака в этом начертании около 0,56 кегля; 91 % ширины окна остаётся между полями.
  return { lines, mobileVw: Math.min(20.3, 91 / (longest * 0.56)) };
}

function AiStage() {
  const { lang } = useT();
  const home = getHome(lang);
  const copy = home.ai;
  const { rootRef, env, backdrop } = useScene();
  const title = useMemo(() => splitTitle(copy.title), [copy.title]);

  const stage = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const askBlock = useRef<HTMLDivElement>(null);
  const askInner = useRef<HTMLDivElement>(null);
  const ask = useRef<AskLineHandle>(null);
  const edge = useRef<RgbEdgeHandle>(null);
  const label = useRef<ScrambleHandle>(null);
  const hint = useRef<ScrambleHandle>(null);
  const captionLines = useRef<(ScrambleHandle | null)[]>([]);
  const progress = useRef(0);
  const focused = useRef(false);
  const blurFrame = useRef(0);

  const guard = useKeyboardGuard(rootRef, { safeFrom: STILL_FROM, safeTo: STILL_TO });

  const syncEdge = () => {
    const byScroll = progress.current >= EDGE_ON && progress.current < EXIT;
    const on = focused.current || byScroll;
    edge.current?.set(on, focused.current && !byScroll);
    // Подложки под мелким текстом у краёв экрана нужны, только пока по ним бежит кайма.
    stage.current?.toggleAttribute('data-edge', on);
  };

  useSceneTimeline(
    (tl, ctx) => {
      const { q } = ctx;
      const still = ctx.env.reduced;

      // Заголовок: буква за буквой из размытия.
      tl.fromTo(
        q('.ai-title .char'),
        { autoAlpha: 0, filter: still ? 'none' : 'blur(8px)' },
        { autoAlpha: 1, filter: still ? 'none' : 'blur(0px)', duration: 0.04, stagger: { amount: 0.06 } },
        0.02,
      );
      tl.fromTo(q('.ai-star'), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.02 }, 0.21);

      // Рука: снизу до хвата, почти равномерно, с мягкой остановкой.
      const hand = ctx.backdrop?.querySelector('.ai-hand');
      if (hand) {
        tl.fromTo(
          hand,
          { autoAlpha: 0, y: still ? 0 : 0.45 * ctx.env.h },
          { autoAlpha: 1, y: 0, duration: 0.14, ease: 'sine.out' },
          0.07,
        );
        tl.to(hand, { autoAlpha: 0, duration: 0.07, ease: 'power1.in' }, EXIT);
      }

      // Строка запроса: встаёт снизу, черта поля прорисовывается слева направо, следом подборки и пометка.
      tl.fromTo(
        q('.ai-ask'),
        { autoAlpha: 0, y: still ? 0 : 28 },
        { autoAlpha: 1, y: 0, duration: 0.09, ease: 'power2.out' },
        ASK_ON,
      );
      tl.fromTo(q('.ai-ask-line'), { scaleX: 0 }, { scaleX: 1, duration: 0.08, ease: 'power2.out' }, ASK_ON + 0.01);
      tl.fromTo(q('.ai-ask-row'), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.04, stagger: 0.015 }, ASK_ON + 0.04);

      // Узкий компьютер (до 1280 px): строка запроса доходит до сноски справа снизу.
      // Тогда сноска уступает место, когда строка встаёт, а не стоит под ней.
      const foot = q('.ai-foot')[0] as HTMLElement | undefined;
      const askBox = askBlock.current;
      const crowded =
        !ctx.env.mobile &&
        foot !== undefined &&
        askBox !== null &&
        askBox.getBoundingClientRect().right > foot.getBoundingClientRect().left - 12;
      if (crowded) tl.to(foot, { autoAlpha: 0, duration: 0.05, ease: 'power1.in' }, ASK_ON - 0.03);

      // Выход: заголовок целиком, не по буквам (кадры 66-70: 1 -> 0,7 -> 0,15 -> 0).
      tl.to(q('.ai-title'), { autoAlpha: 0, duration: 0.05, ease: 'power1.in' }, EXIT);
      tl.to(q(crowded ? '.ai-ask' : '.ai-ask, .ai-foot'), { autoAlpha: 0, duration: 0.07, ease: 'power1.in' }, EXIT);
    },
    [lang],
  );

  useSceneProgress((p, sceneEnv) => {
    const instant = sceneEnv.reduced;
    progress.current = p;

    label.current?.set(p >= LABEL_ON && p < 0.98, instant);
    const captionOn = p >= ASK_ON && p < EXIT;
    for (const line of captionLines.current) line?.set(captionOn, instant);
    hint.current?.set(p >= ASK_ON + 0.03 && p < EXIT, instant);

    if (p >= TYPE_ON) ask.current?.type(instant);
    else if (p < ASK_ON) ask.current?.rewind();

    // Сцена ушла с экрана: строка запроса прячется вместе с экраном, поле отпускает фокус.
    // Фокус снимается на следующем кадре: при пересчёте закреплений (клавиатура сжала окно) сцена
    // «уходит» на одно мгновение и тут же возвращается на место (useKeyboardGuard), ввод при этом не рвётся.
    const out = p <= 0 || p >= 1;
    askInner.current?.toggleAttribute('data-typing', focused.current && !out);
    window.cancelAnimationFrame(blurFrame.current);
    if (out && focused.current) {
      blurFrame.current = window.requestAnimationFrame(() => {
        if (progress.current <= 0 || progress.current >= 1) ask.current?.blur();
      });
    }
    syncEdge();
  });

  useEffect(() => () => window.cancelAnimationFrame(blurFrame.current), []);

  // Зазор под жетон между меткой (на телефоне подписью) под заголовком и строкой запроса.
  // На телефоне по нему встаёт жетон, на компьютере он нужен низкому окну. Рука привязана к жетону.
  useGap(aiGap, stage, head, askBlock, [env, backdrop, lang], () => {
    const measured = aiGap.read();
    aiDeskGap.write(measured.top, measured.bottom);
    const rest = aiRest(env);
    const handBox = backdrop?.querySelector<HTMLElement>('[data-ai-hand]');
    handBox?.style.setProperty('--d', `${(rest.scale * 100).toFixed(2)}vw`);
    handBox?.style.setProperty('--cy', `${((0.5 + rest.y) * 100).toFixed(2)}%`);
    requestTokenRedraw();
  });

  const captionNodes = (offset: number, className: string) =>
    copy.caption.map((line, index) => (
      <ScrambleText
        key={line}
        text={line}
        delay={index * 0.07}
        className={className}
        ref={(handle) => {
          captionLines.current[offset + index] = handle;
        }}
      />
    ));

  return (
    <div ref={stage} className="group/ai relative h-full text-fg">
      <StageClicks id={def.id} />
      {/* Кайма лежит под текстом сцены: надписи у краёв экрана остаются читаемыми, пока она горит */}
      <RgbEdge ref={edge} still={env.reduced} />

      <div
        ref={head}
        className="absolute top-[10%] right-(--gutter) left-(--gutter) md:top-[11.5%] md:right-auto md:left-1/2 md:-translate-x-1/2"
      >
        <h2
          className="ai-title relative text-(length:--ai-title-size) leading-[0.86] font-medium tracking-[-0.04em] md:text-[8.1vw] md:leading-none md:whitespace-nowrap"
          style={{ '--ai-title-size': `${title.mobileVw.toFixed(2)}vw` } as CSSProperties}
        >
          {title.lines.map((line, index) => (
            <span key={line} className="block md:inline">
              {index > 0 ? ' ' : null}
              <SplitChars text={line} />
              {index === title.lines.length - 1 ? (
                <span
                  className="ai-star absolute text-[0.4em] leading-none font-semibold tracking-normal max-md:static max-md:inline-block max-md:-translate-y-[0.95em] md:top-[0.1em] md:left-[calc(100%+0.04em)]"
                  aria-hidden="true"
                >
                  *
                </span>
              ) : null}
            </span>
          ))}
        </h2>
        <ScrambleText
          text={copy.label}
          ref={label}
          className="mt-3 block text-[0.9375rem] leading-[1.1] font-bold tracking-[0.01em] text-copper-hi uppercase md:mt-[0.2vw] md:text-right md:text-[max(0.8125rem,1.2vw)]"
        />
        <p className="t-caps mt-2 md:hidden">{captionNodes(0, 'block')}</p>
      </div>

      {/* Внешний блок держит место (его же замеряет зазор под жетон), внутренний двигает таймлайн */}
      <div
        ref={askBlock}
        className="absolute right-(--gutter) bottom-[2.2%] left-(--gutter) md:right-auto md:bottom-[3.4%] md:left-1/2 md:w-[min(92vw,max(49.2vw,40rem))] md:-translate-x-1/2"
      >
        {/*
          Пока в поле печатают, строка запроса не гаснет, даже если прокрутка ушла в зону выхода:
          правило с !important сильнее инлайновых стилей таймлайна. На телефоне у неё появляется подложка.
        */}
        <div
          ref={askInner}
          className="ai-ask rounded-sm data-[typing]:!visible data-[typing]:!opacity-100 max-md:data-[typing]:bg-bg/85 max-md:data-[typing]:shadow-[0_0_0_10px_oklch(0.162_0.006_39.3/0.85)]"
        >
          <div className="mb-2 flex items-end justify-between gap-6 md:mb-[max(0.6rem,1.5vh)]">
            <ScrambleText text={copy.hint} ref={hint} className="t-caps block text-fg" />
            <p className="t-caps hidden text-right md:block">{captionNodes(copy.caption.length, 'block')}</p>
          </div>
          <AskLine
            copy={copy}
            ref={ask}
            onFocusChange={(next) => {
              focused.current = next;
              askInner.current?.toggleAttribute('data-typing', next);
              if (next) guard.engage();
              else guard.release();
              syncEdge();
            }}
          />
        </div>
      </div>

      {/*
        Та же сноска, что в hero, на том же месте: на склейке сцен она не меняется.
        Подложка проявляется, только пока по углу бежит кайма (data-edge ставит syncEdge).
      */}
      <Footnote
        text={home.hero.footnote}
        className="ai-foot -mr-1.5 -mb-1.5 rounded-xs bg-bg/0 p-1.5 transition-[background-color] duration-200 ease-out group-data-[edge]/ai:bg-bg/60 group-data-[edge]/ai:backdrop-blur-sm max-md:hidden"
      />
    </div>
  );
}

/**
 * z-[1] у экрана сцены: при склейке секция следующей сцены (gallery) уже лежит поверх нижней части
 * этого экрана. Её экран спрятан, но сам блок секции ловит клики, а внизу у нас поле и ссылки.
 * Подъём по z-index ставит наш экран выше чужой секции; свои секции пропускают клики сами (StageClicks).
 */
const STAGE_CLASS = 'z-[1]';

export default function AiScene() {
  const { lang } = useT();
  const copy = getHome(lang).ai;

  return (
    <Scene def={def} className={STAGE_CLASS} label={copy.title} backdrop={<Hand />}>
      <AiStage />
    </Scene>
  );
}
