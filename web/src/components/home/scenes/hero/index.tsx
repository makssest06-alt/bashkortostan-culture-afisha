'use client';

/**
 * hero: «НЕ ПРОСТО АФИША.».
 *
 * Три колонки на одной горизонтали: заголовок слева, жетон в центре, абзац справа; сноска справа снизу.
 * На телефоне текст стоит над жетоном и под ним (live.md, раздел 7).
 *
 * Доли сцены (кадры 7-28 референса):
 *   0-12 %    заголовок проявляется из размытия целым блоком;
 *   4-17 %    абзац проявляется по строкам, слева направо;
 *   вся сцена заголовок дрейфует вниз, абзац навстречу вверх: быстро на входе, почти стоят в середине;
 *   84-100 %  абзац гаснет по строкам сверху вниз;
 *   88-100 %  заголовок гаснет по буквам с конца.
 * Сноска остаётся до конца сцены и продолжается в ai на том же месте (на телефоне гаснет на 90-99 %).
 */

import { useEffect, useRef } from 'react';

import { getHome } from '@/content/home';
import { useT } from '@/lib/i18n';

import { Scene, useSceneTimeline } from '../../scene-kit';
import { StageClicks } from '../intro/StageClicks';
import { useGap } from '../intro/useGap';
import { def, heroGap } from './def';
import { Footnote } from './Footnote';
import { groupLines, SplitChars, SplitWords } from './Split';
import { useFontsReady } from './useFontsReady';

function HeroStage() {
  const { lang } = useT();
  const copy = getHome(lang).hero;
  const fontsReady = useFontsReady();
  const stage = useRef<HTMLDivElement>(null);
  const titleBox = useRef<HTMLDivElement>(null);
  const bodyBox = useRef<HTMLDivElement>(null);

  // Телефон: жетон стоит в зазоре между заголовком и абзацем.
  useGap(heroGap, stage, titleBox, bodyBox, [lang, fontsReady]);

  // Компьютер: правый край заголовка не дальше 31 % ширины, иначе на пике кувырка жетон
  // задевает длинную строку (башкирский заголовок шире русского). Ширину заголовка отдаём в CSS,
  // а левый край считает правило md:left-[...] ниже: сдвиг влево только когда строка длинная.
  useEffect(() => {
    const box = titleBox.current;
    const title = box?.querySelector('h2');
    if (!box || !title) return;
    const write = () => box.style.setProperty('--hero-title-w', `${title.offsetWidth}px`);
    write();
    const observer = new ResizeObserver(write);
    observer.observe(title);
    return () => observer.disconnect();
  }, [lang]);

  useSceneTimeline(
    (tl, { q, env }) => {
      const title = q('.hero-title');
      const chars = q('.hero-title .char');
      const body = q('.hero-body');
      const lines = groupLines(q('.hero-body .word') as HTMLElement[]);
      const still = env.reduced;
      const h = env.h;

      // Заголовок: целым блоком из размытия.
      tl.fromTo(
        title,
        { autoAlpha: 0.1, filter: still ? 'none' : 'blur(6px)' },
        { autoAlpha: 1, filter: still ? 'none' : 'blur(0px)', duration: 0.12, ease: 'power2.out' },
        0,
      );

      // Абзац: строка за строкой, внутри строки слева направо.
      const lineIn = 0.07;
      const stepIn = Math.min(0.03, (0.13 - lineIn) / Math.max(1, lines.length - 1));
      lines.forEach((line, index) => {
        tl.fromTo(
          line,
          { autoAlpha: 0 },
          { autoAlpha: 1, duration: lineIn * 0.7, ease: 'power2.out', stagger: { amount: lineIn * 0.3 } },
          0.04 + index * stepIn,
        );
      });
      tl.fromTo(q('.hero-note'), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.1 }, 0.1);

      // Встречный дрейф: заголовок вниз на 6,4 % высоты, абзац вверх на 1,8 %.
      if (!still) {
        tl.fromTo(title, { y: -0.033 * h }, { y: 0, duration: 0.5, ease: 'power2.out' }, 0);
        tl.to(title, { y: 0.036 * h, duration: 0.5, ease: 'power2.in' }, 0.5);
        tl.fromTo(body, { y: 0.0125 * h }, { y: 0, duration: 0.45, ease: 'power2.out' }, 0);
        tl.to(body, { y: -0.0055 * h, duration: 0.3, ease: 'power2.in' }, 0.7);
      }

      // Уход: абзац по строкам сверху вниз, заголовок по буквам с конца.
      const lineOut = 0.07;
      const stepOut = (0.155 - lineOut) / Math.max(1, lines.length - 1);
      lines.forEach((line, index) => {
        tl.to(line, { autoAlpha: 0, duration: lineOut, ease: 'power1.in' }, 0.84 + index * stepOut);
      });
      tl.to(
        chars,
        {
          autoAlpha: 0,
          filter: still ? 'none' : 'blur(4px)',
          duration: 0.06,
          stagger: { amount: 0.06, from: 'end' },
        },
        0.875,
      );
      // На компьютере сноска продолжается в сцене ai на том же месте. На телефоне там стоит
      // строка запроса, поэтому сноска уходит вместе с текстом, а не пропадает на склейке.
      if (env.mobile) tl.to(q('.hero-note'), { autoAlpha: 0, duration: 0.09, ease: 'power1.in' }, 0.9);
    },
    [lang, fontsReady],
  );

  return (
    <div ref={stage} className="relative h-full text-fg">
      <StageClicks id={def.id} />
      <div
        ref={titleBox}
        className="absolute top-[24%] left-(--gutter) md:inset-y-0 md:top-0 md:left-[max(var(--gutter),min(9vw,calc(31vw-var(--hero-title-w,0px))))] md:flex md:items-center"
      >
        <h2 className="hero-title text-[10.1vw] leading-[0.98] font-semibold tracking-[-0.045em] uppercase md:text-[3.6vw]">
          {copy.title.map((line) => (
            <span key={line} className="block whitespace-nowrap">
              <SplitChars text={line} />
            </span>
          ))}
        </h2>
      </div>

      <div
        ref={bodyBox}
        className="absolute right-(--gutter) bottom-[12.5%] left-(--gutter) flex justify-end md:inset-y-0 md:right-[6.4vw] md:bottom-0 md:left-auto md:w-[max(20.2vw,min(15rem,26vw))] md:items-center md:justify-start"
      >
        <p className="hero-body max-w-[21.5rem] text-right text-[1rem] leading-[1.36] font-medium text-fg-soft md:max-w-none md:text-left md:text-[max(1rem,1.38vw)]">
          <SplitWords text={copy.body} />
        </p>
      </div>

      <Footnote text={copy.footnote} className="hero-note" />
    </div>
  );
}

export default function HeroScene() {
  const { lang } = useT();
  const copy = getHome(lang).hero;

  return (
    <Scene def={def} label={copy.title.join(' ')}>
      <HeroStage />
    </Scene>
  );
}
