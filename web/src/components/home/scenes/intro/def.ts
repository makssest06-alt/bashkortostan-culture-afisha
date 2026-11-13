import { clamp01, lerp, POSE } from '../../scene-kit/math';
import type { SceneDef, SceneEnv } from '../../scene-kit/types';

/**
 * intro: светлый «стол зрителя» и знак «АФИША».
 *
 * Жетон лежит в центре стола и за короткий переход в тёмное растёт с 23,3 до 26,9 % ширины
 * (замер по кадрам 1-7, рост продолжается в hero). Центр на месте: (49,6 %, 50 %).
 *
 * На телефоне жетон крупнее (до 60 % ширины; в оригинале 64 %, но наш абзац над ним длиннее)
 * и стоит только на свободном месте: ни абзац, ни карточка, ни подпись с плашкой его не перекрывают.
 * Мест два: полоса между абзацем и карточкой (жетон по центру) и правая колонка рядом с карточкой,
 * под абзацем и над подписью. Берётся то, где жетон выходит крупнее; полоса, если в ней он не меньше
 * половины ширины. На высоком экране это всегда полоса, на низком (390x664, 375x667) правая колонка.
 * Запас на рост: к началу ухода карточки (60 % сцены) жетон уже подрос, он и тогда не задевает текст.
 */

/** Свободное место на телефоне: замеряет сцена (index.tsx). */
export type IntroRoom = {
  /** Низ абзаца, доля высоты экрана сцены. */
  top: number;
  /** Верх карточки, доля высоты. */
  bottom: number;
  /** Правый край карточки, доля ширины. */
  cardRight: number;
  /** Правый край колонки абзаца (внутреннее поле справа), доля ширины. */
  columnRight: number;
  /** Верх подписи над плашкой справа снизу, доля высоты. */
  sideTop: number;
};

/** До первого замера: телефон 390x844, русский текст. */
const room: IntroRoom = { top: 0.365, bottom: 0.695, cardRight: 0.52, columnRight: 0.96, sideTop: 0.85 };

export const introRoom = {
  read: (): IntroRoom => room,
  write(next: IntroRoom): void {
    if (!Object.values(next).every(Number.isFinite)) return;
    Object.assign(room, next);
  },
};

/** Во сколько раз жетон вырастает за сцену: 23,3 -> 26,9 % ширины. */
const GROW = 0.269 / 0.233;
/** С этой доли сцены уходят карточка и подпись (index.tsx берёт отсюда же). */
export const INTRO_LATE = 0.6;
const MOBILE_MAX = 0.6;
/** Полоса по центру годится, если жетон в ней не меньше этой доли ширины. */
const BAND_GOOD = 0.5;
/** Воздух между текстом и жетоном, px. */
const AIR = 10;

function easeOut(t: number): number {
  const x = 1 - clamp01(t);
  return 1 - x * x;
}

/** Рост жетона к началу ухода карточки: до этого момента он обязан помещаться в свободное место. */
const GROWN = lerp(1, GROW, easeOut(INTRO_LATE));

type Rest = { x: number; y: number; scale: number };

/** Жетон в покое сцены: центр (доли окна от центра) и диаметр в долях ширины. */
function rest(env: SceneEnv): Rest {
  // В окне шире 16:9 размер держится и по высоте (41,4 % H, как в референсе), иначе жетон упирается в знак.
  if (!env.mobile) return { x: -0.004, y: 0, scale: Math.min(0.233, (0.414 * env.h) / env.w) };
  const { top, bottom, cardRight, columnRight, sideTop } = introRoom.read();
  const largest = MOBILE_MAX * env.w;

  // Полоса между абзацем и карточкой, жетон по центру экрана.
  const bandSize = Math.min(largest, ((bottom - top) * env.h - AIR * 2) / GROWN);
  const band: Rest = { x: 0, y: (top + bottom) / 2 - 0.5, scale: bandSize / env.w };
  if (bandSize >= BAND_GOOD * env.w) return band;

  // Правая колонка: справа от карточки, под абзацем, над подписью.
  const left = cardRight * env.w + AIR;
  const right = columnRight * env.w;
  const upper = top * env.h + AIR;
  const lower = sideTop * env.h - AIR;
  const sideSize = Math.min(largest, (right - left) / GROWN, (lower - upper) / GROWN);
  if (sideSize <= bandSize) return band;
  return { x: (left + right) / 2 / env.w - 0.5, y: (upper + lower) / 2 / env.h - 0.5, scale: sideSize / env.w };
}

/**
 * Углы жетона в intro: rx = -π, ry = π, rz = π. Это то же положение, что нули (лицом к зрителю,
 * курай прямо), но именно с этих чисел hero начинает свой оборот вокруг наклонной оси
 * (см. hero/def.ts). Углы на стыке смешиваются как числа, поэтому они должны совпасть.
 */
const FACE_UP = { rx: -Math.PI, ry: Math.PI, rz: Math.PI } as const;

/** Поза в конце сцены: с неё начинает hero. */
export function introEnd(env: SceneEnv): { x: number; y: number; scale: number } {
  const start = rest(env);
  return { ...start, scale: start.scale * GROW };
}

export const def: SceneDef = {
  id: 'intro',
  pinVh: 0.7,
  pinVhMobile: 0.6,
  glow: 0,
  token: (p, env) => {
    const start = rest(env);
    const angles = env.reduced ? null : FACE_UP;
    return { ...POSE, ...angles, x: start.x, y: start.y, scale: start.scale * lerp(1, GROW, easeOut(p)) };
  },
};
