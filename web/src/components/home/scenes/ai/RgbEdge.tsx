'use client';

import { useImperativeHandle, useRef } from 'react';
import type { Ref } from 'react';

import { gsap, useGSAP } from '@/lib/gsap';

export type RgbEdgeHandle = {
  /**
   * Включить или выключить кайму.
   * calm: кайма горит из-за фокуса в поле, а не из-за прокрутки: оттенок бежит втрое медленнее.
   */
  set: (on: boolean, calm?: boolean) => void;
};

export type RgbEdgeProps = {
  ref?: Ref<RgbEdgeHandle>;
  /** «Меньше движения»: радуга стоит на месте. */
  still?: boolean;
};

/** Полный круг оттенка, секунд (в референсе 13° за кадр при 30 к/с). */
const TURN_SECONDS = 0.95;
const CALM_RATE = 0.3;

/** Ядро у самого края, мягкий спад и слабая вуаль вглубь экрана. Размеры от ширины окна. */
function side(direction: string): string {
  return `linear-gradient(${direction}, #000 0, rgb(0 0 0 / 0.86) clamp(5px, 0.8vw, 14px), rgb(0 0 0 / 0.34) clamp(18px, 3.4vw, 60px), rgb(0 0 0 / 0.1) clamp(40px, 9vw, 150px), transparent clamp(70px, 17vw, 280px))`;
}

/** Маска-рамка: четыре стороны складываются, углы получаются ярче, как в референсе. */
const FRAME_MASK = [side('to right'), side('to left'), side('to bottom'), side('to top')].join(', ');

const RAINBOW = 'conic-gradient(#ff3b30, #ffd60a, #5dfc7a, #32e6f5, #5b6cff, #f24bff, #ff3b30)';

/**
 * Радужная кайма по периметру экрана. Цвета едут по часовой стрелке: под неподвижной маской-рамкой
 * вращается большой квадрат с коническим градиентом, поэтому на кадр меняется только transform.
 * Включается за 0,2 с, гаснет за 0,1 с (переходы opacity). Пока кайма не видна, вращение стоит.
 */
export function RgbEdge({ ref, still = false }: RgbEdgeProps) {
  const root = useRef<HTMLDivElement>(null);
  const wheel = useRef<HTMLDivElement>(null);
  const spin = useRef<gsap.core.Tween | null>(null);

  useGSAP(
    () => {
      if (still || !wheel.current) return;
      spin.current = gsap.to(wheel.current, {
        rotation: 360,
        duration: TURN_SECONDS,
        ease: 'none',
        repeat: -1,
        paused: true,
      });
      // Сцену пересобрали при горящей кайме: вращение продолжается.
      if (root.current?.hasAttribute('data-on')) spin.current.play();
      return () => {
        spin.current = null;
      };
    },
    { scope: root, dependencies: [still], revertOnUpdate: true },
  );

  useImperativeHandle(
    ref,
    () => ({
      set(on, calm = false) {
        const node = root.current;
        if (!node) return;
        node.toggleAttribute('data-on', on);
        if (on) spin.current?.timeScale(calm ? CALM_RATE : 1).play();
      },
    }),
    [],
  );

  return (
    <div
      ref={root}
      className="pointer-events-none absolute inset-0 overflow-clip opacity-0 transition-opacity duration-100 ease-in data-[on]:opacity-100 data-[on]:duration-200 data-[on]:ease-out"
      style={{ maskImage: FRAME_MASK, WebkitMaskImage: FRAME_MASK }}
      onTransitionEnd={() => {
        if (!root.current?.hasAttribute('data-on')) spin.current?.pause();
      }}
      aria-hidden="true"
    >
      <div className="absolute top-1/2 left-1/2 size-[150vmax] -translate-x-1/2 -translate-y-1/2">
        <div ref={wheel} className="size-full will-change-transform" style={{ backgroundImage: RAINBOW }} />
      </div>
    </div>
  );
}
