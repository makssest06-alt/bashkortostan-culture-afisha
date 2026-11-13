'use client';

import { useEffect, useEffectEvent } from 'react';
import type { RefObject } from 'react';

import type { Gap } from './gap';

/** Верх узла относительно экрана сцены по вёрстке: движение таймлайна (transform) в замер не попадает. */
export function offsetWithin(node: HTMLElement, root: HTMLElement): number {
  let top = 0;
  let current: HTMLElement | null = node;
  while (current && current !== root) {
    top += current.offsetTop;
    current = current.offsetParent as HTMLElement | null;
  }
  return top;
}

/** Левый край узла относительно экрана сцены по вёрстке, как offsetWithin. */
export function offsetLeftWithin(node: HTMLElement, root: HTMLElement): number {
  let left = 0;
  let current: HTMLElement | null = node;
  while (current && current !== root) {
    left += current.offsetLeft;
    current = current.offsetParent as HTMLElement | null;
  }
  return left;
}

/**
 * Замеряет зазор между блоком над жетоном и блоком под ним и пишет его в gap.
 * Перемеряет при смене размеров любого из трёх узлов и при смене deps (язык, окружение).
 * stage должен быть position: relative, блоки лежат внутри него.
 */
export function useGap(
  gap: Gap,
  stage: RefObject<HTMLElement | null>,
  above: RefObject<HTMLElement | null>,
  below: RefObject<HTMLElement | null>,
  deps: readonly unknown[],
  onChange?: () => void,
): void {
  const changed = useEffectEvent(() => onChange?.());

  useEffect(() => {
    const stageNode = stage.current;
    const aboveNode = above.current;
    const belowNode = below.current;
    if (!stageNode || !aboveNode || !belowNode) return;

    const measure = () => {
      const height = stageNode.offsetHeight;
      if (height <= 0) return;
      gap.write(
        (offsetWithin(aboveNode, stageNode) + aboveNode.offsetHeight) / height,
        offsetWithin(belowNode, stageNode) / height,
      );
      changed();
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stageNode);
    observer.observe(aboveNode);
    observer.observe(belowNode);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps задаёт вызывающая сцена
  }, [gap, stage, above, below, ...deps]);
}
