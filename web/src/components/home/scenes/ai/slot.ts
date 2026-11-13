/**
 * Место жетона в сцене ai, пока она стоит.
 *
 * На компьютере оно задано референсом: центр (50 %, 49,7 %), диаметр 16,4 % ширины. В низком окне
 * (ноутбук 1366x650, окно шире 16:9) такой жетон задевает строку запроса: тогда он уменьшается
 * до свободного места между меткой под заголовком и строкой запроса.
 * На телефоне жетон встаёт в зазор между подписью под заголовком и строкой запроса.
 * Зазор замеряет сцена (index.tsx), отсюда его читают def.ts, рука и сцена gallery.
 * Модуль без зависимостей от React.
 */

import type { SceneEnv } from '../../scene-kit/types';
import { makeGap } from '../intro/gap';

export type AiRest = {
  /** Смещение центра от центра окна в долях высоты. */
  y: number;
  /** Диаметр в долях ширины окна. */
  scale: number;
};

const DESKTOP: AiRest = { y: -0.003, scale: 0.164 };

/** Зазор между подписью под заголовком и строкой запроса на телефоне. */
export const aiGap = makeGap({ top: 0.375, bottom: 0.67 });

/**
 * Тот же зазор для компьютера. Отдельный объект, потому что до первого замера здесь стоит значение
 * для окна 16:9, при котором жетон стоит на месте референса (у телефона своё значение до замера).
 */
export const aiDeskGap = makeGap({ top: 0.28, bottom: 0.71 });

/** Воздух над жетоном и под ним на компьютере, px, и самый мелкий жетон, в долях ширины. */
const DESKTOP_AIR = 16;
const DESKTOP_MIN = 0.1;

/** Самый крупный и самый мелкий жетон на телефоне, в долях ширины. */
const MOBILE_MAX = 0.56;
const MOBILE_MIN = 0.26;
/** Воздух над жетоном и под ним, px. */
const MOBILE_AIR = 14;

function desktopRest(env: SceneEnv): AiRest {
  const { top, bottom } = aiDeskGap.read();
  const size = DESKTOP.scale * env.w;
  const center = (0.5 + DESKTOP.y) * env.h;
  const upper = top * env.h + DESKTOP_AIR;
  const lower = bottom * env.h - DESKTOP_AIR;
  if (center - size / 2 >= upper && center + size / 2 <= lower) return DESKTOP;
  // Не влезает: жетон уменьшается до свободного места. Если места совсем мало, строка запроса
  // важнее, поэтому жетон прижимается к ней сверху, а не наезжает на неё.
  const fitted = Math.max(DESKTOP_MIN * env.w, Math.min(size, lower - upper));
  const y = Math.min(Math.max(center, upper + fitted / 2), lower - fitted / 2);
  return { y: y / env.h - 0.5, scale: fitted / env.w };
}

export function aiRest(env: SceneEnv): AiRest {
  if (!env.mobile) return desktopRest(env);
  const { top, bottom } = aiGap.read();
  const room = (bottom - top) * env.h - MOBILE_AIR * 2;
  const scale = Math.min(MOBILE_MAX, Math.max(MOBILE_MIN, room / env.w));
  return { y: (top + bottom) / 2 - 0.5, scale };
}
