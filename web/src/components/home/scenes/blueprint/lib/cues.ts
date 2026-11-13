'use client';

/**
 * Движения «по времени после порога прокрутки»: так в референсе входят и выходят тексты.
 *
 *   useCues((cue, { q, env }) => {
 *     cue({ from: 0.1, to: 0.82 }, (tl) => {
 *       tl.fromTo(q('.title .ch'), { yPercent: 110 }, { yPercent: 0, duration: 0.5, stagger: 0.02 });
 *       tl.addLabel('on');                                  // здесь текст стоит, пока прогресс внутри окна
 *       tl.to(q('.title'), { autoAlpha: 0, duration: 0.2 }); // всё после метки это выход
 *     });
 *   });
 *
 * Прогресс меньше from: таймлайн в нуле. Внутри [from, to): доигрывает до метки 'on'.
 * После to: доигрывает до конца (выход). Если метки 'on' нет, выход это вход задом наперёд.
 * Прокрутка назад проигрывает те же отрезки в обратную сторону.
 * Со скрабом сцены (useSceneTimeline) эти таймлайны не должны делить одни и те же свойства одного узла.
 */

import { gsap, useGSAP } from '@/lib/gsap';

import { SERVER_ENV, subscribeScene, useScene } from '../../../scene-kit';
import type { SceneTimelineCtx } from '../../../scene-kit';

export type CueWindow = { from: number; to?: number };
export type CueApi = (window: CueWindow, build: (tl: gsap.core.Timeline) => void) => void;

type CueItem = {
  window: CueWindow;
  tl: gsap.core.Timeline;
  on: number;
  state: -1 | 0 | 1 | 2;
  tween: gsap.core.Tween | null;
};

/** Уход быстрее входа: слушатель уже прочитал текст, ждать его незачем. */
const LEAVE_SPEED = 1.5;

export function useCues(setup: (cue: CueApi, ctx: SceneTimelineCtx) => void, deps: readonly unknown[] = []): void {
  const { def, env, rootRef, backdrop } = useScene();

  useGSAP(
    () => {
      const root = rootRef.current;
      if (!root || env === SERVER_ENV) return;

      const items: CueItem[] = [];
      setup(
        (window, build) => {
          const tl = gsap.timeline({ paused: true });
          build(tl);
          const on = typeof tl.labels.on === 'number' ? tl.labels.on : tl.duration();
          items.push({ window, tl, on, state: -1, tween: null });
        },
        { root, env, q: gsap.utils.selector(root), backdrop },
      );

      const off = subscribeScene(def.id, (progress) => {
        for (const item of items) {
          const { window, tl } = item;
          const next = progress < window.from ? 0 : window.to === undefined || progress < window.to ? 1 : 2;
          if (next === item.state) continue;
          const first = item.state === -1;
          item.state = next;

          const end = tl.duration();
          const hasExit = item.on < end - 0.0001;
          const target = next === 0 ? 0 : next === 1 ? item.on : hasExit ? end : 0;
          item.tween?.kill();
          item.tween = null;
          if (first) {
            // Первое значение приходит сразу при подписке: встаём в нужное состояние без проигрывания.
            tl.pause(target);
            continue;
          }
          const distance = Math.abs(target - tl.time());
          if (distance < 0.0001) continue;
          item.tween = tl.tweenTo(target, { ease: 'none', duration: next === 1 ? distance : distance / LEAVE_SPEED });
        }
      });

      return () => {
        off();
        for (const item of items) item.tween?.kill();
      };
    },
    { scope: rootRef, dependencies: [def.id, env, backdrop, ...deps], revertOnUpdate: true },
  );
}

/** Номер строки для каждого узла по его верхней границе: слова одной строки едут вместе. */
export function lineIndexes(nodes: readonly Element[]): number[] {
  const tops: number[] = [];
  return nodes.map((node) => {
    const top = Math.round((node as HTMLElement).getBoundingClientRect().top);
    let index = tops.findIndex((value) => Math.abs(value - top) < 4);
    if (index < 0) {
      tops.push(top);
      index = tops.length - 1;
    }
    return index;
  });
}
