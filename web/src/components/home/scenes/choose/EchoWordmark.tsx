'use client';

/**
 * Словесный знак с эхо-шлейфом: под знаком лежат копии, каждая догоняет предыдущую.
 * Пока знак стоит, копии совпадают с ним и не видны; на ходу (прокрутка страницы или движение
 * самого знака в закреплённой сцене) они отстают и проявляются. Шаг копий растёт со скоростью
 * и ограничен 9 % высоты окна (кадры 468-469 и 488-491 референса).
 *
 * Положение знака читается раз в кадр (один getBoundingClientRect, без записи в вёрстку до чтения),
 * и только пока знак рядом с окном. При «меньше движения» шлейфа нет.
 */

import { useEffect, useRef } from 'react';
import type { ElementType } from 'react';

import { cn } from '@/lib/cn';
import { gsap } from '@/lib/gsap';
import { usePrefersReducedMotion } from '@/lib/motion';

import styles from './echo.module.css';

/** Прозрачность копий от ближней к дальней. */
const CLONE_OPACITY = [0.5, 0.32, 0.18, 0.08];
/** Доля пути, которую копия проходит за кадр 60 Гц. Меньше значение: длиннее шлейф. */
const FOLLOW = 0.5;
/** Отставание в px, с которого копия видна полностью, и максимальный шаг в долях высоты окна. */
const FADE_PX = 6;
const MAX_STEP = 0.09;

export type EchoWordmarkProps = {
  text: string;
  /** Ширина слова в кеглях до замера: чтобы знак не прыгал в первом кадре. */
  ratioHint: number;
  /** Тег корня: 'span' внутри заголовка, 'p' как самостоятельная строка. */
  as?: 'span' | 'p' | 'div';
  className?: string;
};

export function EchoWordmark({ text, ratioHint, as = 'span', className }: EchoWordmarkProps) {
  const Tag = as as ElementType;
  const root = useRef<HTMLElement>(null);
  const main = useRef<HTMLSpanElement>(null);
  const reduced = usePrefersReducedMotion();

  // Кегль подгоняется под заданную ширину: меряем ширину слова в кеглях (от размера шрифта она не зависит).
  useEffect(() => {
    const node = root.current;
    const word = main.current;
    if (!node || !word) return;
    let alive = true;
    const measure = () => {
      const fontSize = parseFloat(getComputedStyle(node).fontSize);
      if (alive && fontSize > 0 && word.offsetWidth > 0) {
        node.style.setProperty('--echo-ratio', (word.offsetWidth / fontSize).toFixed(4));
      }
    };
    measure();
    void document.fonts.ready.then(measure);
    return () => {
      alive = false;
    };
  }, [text]);

  useEffect(() => {
    const node = root.current;
    const word = main.current;
    if (!node || !word || reduced) return;
    const clones = Array.from(node.querySelectorAll<HTMLElement>('[data-echo-clone]'));
    if (clones.length === 0) return;

    let trail: number[] = [];
    let running = false;

    const tick = (_time: number, deltaMs: number) => {
      const y = word.getBoundingClientRect().top;
      if (trail.length === 0) trail = clones.map(() => y);
      const step = 1 - Math.pow(1 - FOLLOW, Math.min(deltaMs, 64) / 16.67);
      const limit = window.innerHeight * MAX_STEP;
      let lead = y;
      for (let index = 0; index < clones.length; index += 1) {
        trail[index] += (lead - trail[index]) * step;
        // Копия не отстаёт от предыдущей больше чем на предельный шаг.
        const gap = trail[index] - lead;
        if (Math.abs(gap) > limit) trail[index] = lead + Math.sign(gap) * limit;
        lead = trail[index];
        const offset = trail[index] - y;
        const shown = Math.min(1, Math.abs(offset) / FADE_PX);
        const clone = clones[index];
        clone.style.transform = `translate3d(0, ${offset.toFixed(2)}px, 0)`;
        clone.style.opacity = ((CLONE_OPACITY[index] ?? 0.08) * shown).toFixed(3);
      }
    };

    const start = () => {
      if (running) return;
      running = true;
      trail = [];
      gsap.ticker.add(tick);
    };
    const stop = () => {
      if (!running) return;
      running = false;
      gsap.ticker.remove(tick);
      for (const clone of clones) clone.style.opacity = '0';
    };

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) start();
        else stop();
      },
      { rootMargin: '40% 0px 40% 0px' },
    );
    observer.observe(node);

    return () => {
      observer.disconnect();
      stop();
      for (const clone of clones) clone.style.transform = '';
    };
  }, [reduced, text]);

  return (
    <Tag
      ref={root}
      className={cn(styles.echo, className)}
      style={{ ['--echo-ratio' as string]: ratioHint }}
    >
      {CLONE_OPACITY.map((_, index) => (
        <span key={index} data-echo-clone="" className={styles.clone} aria-hidden="true">
          {text}
        </span>
      ))}
      <span ref={main} className={styles.main}>
        {text}
      </span>
    </Tag>
  );
}
