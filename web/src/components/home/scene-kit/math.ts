/**
 * Маленькие чистые функции для поз жетона и порогов прогресса.
 * Без зависимостей: можно импортировать из def.ts сцен.
 */

import type { TokenPose } from './types';

export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/**
 * Доля пути внутри отрезка прогресса: 0 до `start`, 1 после `end`, линейно между ними.
 *   span(p, 0.25, 0.63)  // кувырок идёт с 25 % по 63 % сцены
 */
export function span(p: number, start: number, end: number): number {
  if (end <= start) return p >= end ? 1 : 0;
  return clamp01((p - start) / (end - start));
}

/** Плавный вход и выход (S-образная кривая) для значения 0..1. */
export function smooth(t: number): number {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

/** Поза по умолчанию: жетон по центру лицом к зрителю. Удобно расширять: { ...POSE, scale: 0.3 }. */
export const POSE: TokenPose = { x: 0, y: 0, scale: 0.24, rx: 0, ry: 0, rz: 0, opacity: 1, mode: 'solid' };

/** Смешение двух поз. Режим (solid или wire) берётся от ближайшей позы. */
export function mixPose(a: TokenPose, b: TokenPose, t: number): TokenPose {
  const w = clamp01(t);
  return {
    x: lerp(a.x, b.x, w),
    y: lerp(a.y, b.y, w),
    scale: lerp(a.scale, b.scale, w),
    rx: lerp(a.rx, b.rx, w),
    ry: lerp(a.ry, b.ry, w),
    rz: lerp(a.rz, b.rz, w),
    opacity: lerp(a.opacity, b.opacity, w),
    mode: (w < 0.5 ? a.mode : b.mode) ?? 'solid',
  };
}
