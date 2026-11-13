import { lerp, POSE, span } from '../../scene-kit/math';
import type { SceneDef } from '../../scene-kit/types';
import { FILTERS_FLIP, FILTERS_TILT, FILTERS_TOKEN, spotFor } from '../blueprint/lib/layout';

/** Пороги сцены (доли прогресса). */
export const DEDUP_T = {
  /** Наезд камеры на кромку жетона: рост по экспоненте, затем мягкая остановка. */
  zoom: [0, 0.2],
  /** Медленный доезд. */
  drift: [0.2, 0.4],
  /** Цвет уходит в чёрно-белое. */
  gray: [0.24, 0.4],
  /** Светлое чёрно-белое темнеет, дальний план размывается. */
  dark: [0.4, 0.46],
  /** Окно, в котором стоят надстрочник, титул и абзац. */
  texts: [0.46, 0.89],
  /** Порог карточки: шапка, копии записей, слияние в одну. */
  card: 0.5,
  /** Затемнение в чёрный перед следующей сценой. */
  out: [0.94, 1],
} as const;

/**
 * dedup: «ОДНО СОБЫТИЕ. ОДНА КАРТОЧКА.» (S9 референса). Камера наезжает на жетон до макро,
 * цвет уходит в чёрно-белое, по центру три записи источников сходятся в одну карточку.
 */
export const def: SceneDef = {
  id: 'dedup',
  // Четыре смысловых шага (наезд до макро, уход в серое, затемнение с текстами, слияние карточки)
  // по 0,55-0,65 экрана: темп выровнен с остальными сценами.
  pinVh: 2.6,
  pinVhMobile: 2.2,
  glow: 0,
  token: (p, env) => {
    const from = spotFor(FILTERS_TOKEN, env.mobile).angle;
    const zoom = span(p, 0, 0.16);
    // Жетон растворяется в макрокадре, а потом (уже невидимый) возвращается в нейтральную позу:
    // следующая сцена получает нулевые углы и не делает лишний оборот.
    const reset = span(p, 0.3, 0.5);
    return {
      ...POSE,
      x: lerp(from.x, 0, reset),
      y: lerp(from.y, 0, reset),
      scale: lerp(from.d * Math.pow(7, zoom), POSE.scale, reset),
      rx: env.reduced ? 0 : lerp(FILTERS_TILT + FILTERS_FLIP, 0, reset),
      opacity: 1 - span(p, 0.05, 0.13),
    };
  },
};
