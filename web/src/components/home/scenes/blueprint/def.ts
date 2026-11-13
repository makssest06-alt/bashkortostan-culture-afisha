import { POSE, span } from '../../scene-kit/math';
import type { SceneDef } from '../../scene-kit/types';
import { BLUEPRINT_SPOT, spotFor } from './lib/layout';

/** Пороги сцены (доли прогресса): общие для позы жетона и для вёрстки. */
export const BLUEPRINT_T = {
  /** Фото стола и медный жетон проявляются после склейки. */
  photoIn: [0, 0.06],
  /** Контур обводится пунктиром по кромке жетона. */
  trace: [0.2, 0.34],
  /** Фото и жетон гаснут: остаётся чертёж. */
  dim: [0.34, 0.44],
  /** Направляющие растут от контура наружу. */
  guides: [0.38, 0.5],
  /** Пометки от руки. */
  marks: [0.52, 0.7],
  /** Чертёж едет в центр экрана. */
  slide: [0.68, 1],
  /** Матовая панель уходит. */
  panelOut: [0.88, 0.98],
  /** Окно, в котором стоят тексты панели (вход и выход идут по времени). */
  texts: [0.1, 0.8],
} as const;

/**
 * blueprint: «ПРОВЕРЕНО. ЧЕСТНО.». Вид сверху на стол с жетоном, затем фото гаснет и остаётся чертёж.
 * Жетон медный и лежит плашмя (углы нулевые): чертёж рисуется в SVG поверх него, по тем же координатам.
 */
export const def: SceneDef = {
  id: 'blueprint',
  pinVh: 3.4,
  pinVhMobile: 2.8,
  token: (p, env) => {
    const spot = spotFor(BLUEPRINT_SPOT, env.mobile);
    return {
      ...POSE,
      x: spot.x,
      y: spot.y,
      scale: spot.d,
      opacity: span(p, BLUEPRINT_T.photoIn[0], BLUEPRINT_T.photoIn[1]) * (1 - span(p, BLUEPRINT_T.dim[0], BLUEPRINT_T.dim[1])),
    };
  },
};
