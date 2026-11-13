import { lerp, POSE, smooth, span } from '../../scene-kit/math';
import type { SceneDef, SceneEnv, TokenPose } from '../../scene-kit/types';
import { FILTERS_FLIP, FILTERS_T, FILTERS_TILT, FILTERS_TOKEN, spotFor } from '../blueprint/lib/layout';
import { makeGap } from '../intro/gap';

/** Пороги текстов и плашек (доли прогресса). Пороги жетона лежат в blueprint/lib/layout.ts (FILTERS_T). */
export const FILTERS_UI = {
  /** Гравировка «АФИША» на жетоне гаснет перед наклоном камеры. */
  wordOut: [0.2, 0.27],
  /** Окно, в котором стоят надстрочник, титул и абзац. */
  texts: [0.28, 0.87],
  /**
   * Телефон: текст входит чуть позже, когда камера уже наклонилась и жетон ушёл вниз. На низком экране
   * (390x664) с 0,28 последняя строка абзаца ложилась на верхний край жетона.
   */
  textsMobile: [0.33, 0.87],
  /** Пять плашек: каждая вспыхивает на своём пороге. */
  pills: [0.42, 0.5, 0.58, 0.66, 0.74],
  /** Плашки уходят вместе с посадкой жетона. */
  pillsOut: [0.9, 0.96],
  /**
   * Телефон: плашки уходят вместе с текстом, до посадки. Жетон в воздухе там стоит сразу под ними
   * и к посадке вырастает (liftedFit): плашки к этому моменту уже погасли.
   */
  pillsOutMobile: [0.84, 0.89],
} as const;

/** Доля полного переворота (0..1) и высота подъёма (0..1): по ним же считается тень на сукне. */
export function filtersFlip(p: number): { tilt: number; lift: number; flip: number } {
  return {
    tilt: smooth(span(p, FILTERS_T.tilt[0], FILTERS_T.tilt[1])),
    lift: smooth(span(p, FILTERS_T.lift[0], FILTERS_T.lift[1])) * (1 - smooth(span(p, FILTERS_T.land[0], FILTERS_T.land[1]))),
    flip: span(p, FILTERS_T.flip[0], FILTERS_T.flip[1]),
  };
}

/**
 * Телефон: низ плашек (под абзацем) и верх ссылки внизу, доли высоты экрана сцены. Замеряет index.tsx.
 * До первого замера: 390x844, русский текст.
 */
export const filtersGap = makeGap({ top: 0.525, bottom: 0.9 });

/** Воздух между нижним рядом плашек и жетоном в воздухе, px, и самый мелкий жетон в воздухе, доля ширины. */
const MOBILE_AIR = 12;
const MOBILE_MIN = 0.32;

/**
 * Жетон в воздухе на низком телефоне. Обычно он поднимается на spot.lift над точкой посадки и не меняет
 * размер. На низком экране (390x664, 375x667) плашки под абзацем доходят до этой высоты: тогда жетон
 * в воздухе меньше, его низ там же, где был бы, а верх под нижним рядом плашек. Садится он
 * в прежнюю точку и прежним размером: с неё начинают тень на сукне и сцена dedup.
 * null: места хватает, поза как на высоком экране.
 */
function liftedFit(env: SceneEnv): { y: number; d: number } | null {
  if (!env.mobile) return null;
  const spot = FILTERS_TOKEN.mobile;
  const radius = (spot.angle.d * env.w) / 2;
  const center = (0.5 + spot.angle.y - spot.lift) * env.h;
  const limit = filtersGap.read().top * env.h + MOBILE_AIR;
  if (center - radius >= limit) return null;
  const bottom = center + radius;
  const size = Math.max(MOBILE_MIN * env.w, bottom - limit);
  return { y: (bottom - size / 2) / env.h - 0.5, d: size / env.w };
}

function pose(p: number, env: SceneEnv): TokenPose {
  const spot = spotFor(FILTERS_TOKEN, env.mobile);
  const { tilt, lift, flip } = filtersFlip(p);
  const fit = liftedFit(env);
  const y = lerp(spot.top.y, spot.angle.y, tilt);
  const scale = lerp(spot.top.d, spot.angle.d, tilt);
  return {
    ...POSE,
    x: lerp(spot.top.x, spot.angle.x, tilt),
    y: fit ? lerp(y, fit.y, lift) : y - spot.lift * lift,
    scale: fit ? lerp(scale, fit.d, lift) : scale,
    // Вид сверху (0), затем наклон лежащего жетона и два оборота вокруг горизонтальной оси.
    rx: env.reduced ? 0 : FILTERS_TILT * tilt + FILTERS_FLIP * flip,
  };
}

/**
 * filters: «УМНЫЕ ФИЛЬТРЫ» (S8 референса). Жетон лежит на сукне (вид сверху), камера уходит под угол,
 * жетон поднимается и переворачивается, вокруг него по очереди вспыхивают пять плашек-фильтров.
 */
export const def: SceneDef = {
  id: 'filters',
  pinVh: 4.0,
  pinVhMobile: 3.4,
  glow: 0,
  token: pose,
};
