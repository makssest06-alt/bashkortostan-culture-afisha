import { clamp01, lerp, POSE, smooth, span } from '../../scene-kit/math';
import type { SceneDef, SceneEnv } from '../../scene-kit/types';
import { introEnd } from '../intro/def';
import { makeGap } from '../intro/gap';

/**
 * hero: «НЕ ПРОСТО АФИША.».
 *
 * Жетон (доли сцены по кадрам 7-28):
 *   0-25 %    дорастает до 30,9 % ширины (старт 26,9 %, как в конце intro), замедляясь;
 *   21-61 %   оборот на 180° вокруг оси, наклонённой на 20° от вертикали (верх оси вправо):
 *             ребро около 41 % стоит наискось, в конце видна оборотная сторона;
 *   61-86 %   оборот на 180° вокруг оси, наклонённой на 20° от горизонтали (правый конец ниже),
 *             чуть быстрее в начале: ребро около 71 %, жетон снова лицом к зрителю к 86 %;
 *             пока жетон стоит ребром, он доворачивается в своей плоскости (в этот момент
 *             доворот не виден), иначе после двух оборотов курай оказался бы повёрнут;
 *   25-88 %   по синусу подлетает к зрителю на 15 %;
 *   88-100 %  уменьшается до 27,8 % и продолжает уменьшаться в ai.
 * Свечение фона разгорается с 30 % сцены и догорает уже в ai.
 *
 * Углы (порядок Эйлера XYZ, как у холста): в начале rx = -π, ry = π, rz = π (это то же положение,
 * что нули: лицом к зрителю), с них же стоит intro; в конце rx = π, ry = π, rz = π (лицом к зрителю,
 * курай прямо), с них начинает ai. Наборы углов выбраны так, чтобы они менялись непрерывно.
 *
 * На телефоне жетон стоит в зазоре между заголовком и абзацем: до 84 % ширины (в оригинале до 87 %),
 * на пике кувырка подлетает, но не дальше краёв зазора (bumpAmount): заголовок и абзац на него не ложатся.
 * При «меньше движения» подлёта и поворотов нет.
 */

/** Зазор между заголовком и абзацем на телефоне: замеряет сцена (index.tsx). */
export const heroGap = makeGap({ top: 0.33, bottom: 0.77 });

/** Множитель размера в конце сцены: 30,9 % -> 27,8 % ширины. */
export const HERO_EXIT = 0.9;

const MOBILE_MAX = 0.84;
const MOBILE_MIN = 0.5;
/** Воздух между текстом и жетоном, px. */
const AIR = 8;

/** Жетон в покое сцены: центр (49,7 %, 49,3 %) и диаметр 30,9 % ширины на компьютере. */
export function heroRest(env: SceneEnv): { x: number; y: number; scale: number } {
  // В окне шире 16:9 размер держится и по высоте (55 % H, как в референсе).
  if (!env.mobile) return { x: -0.003, y: -0.007, scale: Math.min(0.309, (0.55 * env.h) / env.w) };
  const { top, bottom } = heroGap.read();
  const room = (bottom - top) * env.h - AIR * 2;
  const scale = Math.min(MOBILE_MAX, Math.max(MOBILE_MIN, room / env.w));
  return { x: 0, y: (top + bottom) / 2 - 0.5, scale };
}

function easeOut(t: number): number {
  const x = 1 - clamp01(t);
  return 1 - x * x;
}

/** Подлёт к зрителю: жетон вырастает на 15 % на середине кувырка. */
const BUMP = 0.15;

/**
 * На низком телефоне (390x664, 375x667) зазор между заголовком и абзацем едва вмещает жетон в покое,
 * и полный подлёт заводил его край под точку заголовка и первую строку абзаца. Там подлёт меньше:
 * ровно до краёв зазора. На высоком телефоне и на компьютере он полный.
 */
function bumpAmount(env: SceneEnv, scale: number): number {
  if (!env.mobile) return BUMP;
  const { top, bottom } = heroGap.read();
  const room = (bottom - top) * env.h;
  return Math.min(BUMP, Math.max(0, room / (scale * env.w) - 1));
}

/** Оборот почти равномерный, с чуть смягчёнными началом и концом (кадры 11-20: ребро в f15-16). */
function turn(t: number): number {
  return lerp(clamp01(t), smooth(t), 0.25);
}

/** Кувырок почти равномерный, чуть быстрее в начале (кадры 20-25: ребро в f22, лицо в f25). */
function flip(t: number): number {
  return lerp(clamp01(t), easeOut(t), 0.35);
}

/** Наклон оси первого оборота от вертикали в плоскости экрана, верх оси вправо (кадры 15-16, live M003). */
const TURN_TILT = (20 * Math.PI) / 180;
/** Наклон оси второго оборота от горизонтали, правый конец ниже (кадры 21-23). */
const FLIP_TILT = (20 * Math.PI) / 180;

type Angles = { rx: number; ry: number; rz: number };

/*
 * Холст ставит углы как rotation.set(rx, ry, rz) с порядком Эйлера XYZ, а в нём ось поворота
 * одним углом не наклонить. Поэтому повороты вокруг наклонных осей посчитаны как матрицы
 * и переведены в XYZ формулами ниже. Из двух равносильных наборов углов (α, β, γ) и
 * (α + π, π - β, γ + π) взят тот, что идёт непрерывно и сходится с соседями: холст сглаживает
 * каждый угол отдельно, скачок между наборами дал бы лишний оборот.
 */

/**
 * Первый оборот: на phi (0..π) вокруг оси, наклонённой на TURN_TILT от вертикали,
 * то есть Rz(-t)·Ry(phi)·Rz(t). Углы идут от (-π, π, π) (исходное положение, лицом к зрителю)
 * до (0, π, 2t) (оборотной стороной к зрителю, повёрнут в своей плоскости на 2t).
 */
function tiltedTurn(phi: number): Angles {
  const c = Math.cos(TURN_TILT);
  const s = Math.sin(TURN_TILT);
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.max(0, Math.sin(phi));
  const rx = Math.atan2(s * sinPhi, cosPhi);
  const ry = Math.asin(c * sinPhi);
  const rz = Math.atan2(-c * s * (1 - cosPhi), cosPhi * c * c + s * s);
  return { rx: rx - Math.PI, ry: Math.PI - ry, rz: rz + Math.PI };
}

/**
 * Второй оборот: на psi (0..π) вокруг оси, наклонённой на FLIP_TILT от горизонтали, начиная
 * с положения (0, π, 0), то есть Rz(-t)·Rx(psi)·Rz(t)·Ry(π). Углы идут от (0, π, 0)
 * до (π, π, -2t) (лицом к зрителю, повёрнут в своей плоскости на -2t).
 */
function tiltedFlip(psi: number): Angles {
  const c = Math.cos(FLIP_TILT);
  const s = Math.sin(FLIP_TILT);
  const cosPsi = Math.cos(psi);
  const sinPsi = Math.max(0, Math.sin(psi));
  const rx = Math.atan2(-c * sinPsi, -cosPsi);
  const ry = Math.asin(s * sinPsi);
  const rz = Math.atan2(Math.max(0, c * s * (1 - cosPsi)), -(c * c + s * s * cosPsi));
  return { rx: rx + Math.PI, ry: Math.PI - ry, rz: rz - Math.PI };
}

export const def: SceneDef = {
  id: 'hero',
  pinVh: 2.8,
  pinVhMobile: 2.2,
  // На телефоне свечение слабее: текст стоит внизу экрана, как раз там, где оно ярче всего.
  glow: (p, env) => (env.mobile ? 0.42 : 0.92) * span(p, 0.3, 1),
  token: (p, env) => {
    const base = heroRest(env);
    const from = introEnd(env);
    const arrive = easeOut(span(p, 0, 0.25));
    const flight = span(p, 0.25, 0.88);
    const bump = env.reduced ? 1 : 1 + bumpAmount(env, base.scale) * Math.sin(Math.PI * flight);
    const exit = lerp(1, HERO_EXIT, span(p, 0.88, 1));

    const first = turn(span(p, 0.21, 0.61));
    const second = flip(span(p, 0.61, 0.86));
    const placement = {
      x: lerp(from.x, base.x, arrive),
      y: lerp(from.y, base.y, arrive),
      scale: lerp(from.scale, base.scale, arrive) * bump * exit,
    };
    if (env.reduced) return { ...POSE, ...placement };

    // Первый оборот: вокруг наклонной оси, ребро в середине стоит наискось, как в оригинале.
    // Пока жетон стоит ребром, он доворачивается в своей плоскости на -2t: оборот в конце читается прямо.
    if (second <= 0) {
      const angles = tiltedTurn(Math.PI * first);
      return { ...POSE, ...placement, ...angles, rz: angles.rz - 2 * TURN_TILT * smooth(span(first, 0.3, 0.7)) };
    }

    // Второй оборот: вокруг почти горизонтальной оси. Пока жетон идёт через ребро, он доворачивается
    // в своей плоскости на π + 2t: курай в конце стоит прямо, углы приходят к (π, π, π).
    const angles = tiltedFlip(Math.PI * second);
    return { ...POSE, ...placement, ...angles, rz: angles.rz + (Math.PI + 2 * FLIP_TILT) * smooth(span(second, 0.3, 0.7)) };
  },
};
