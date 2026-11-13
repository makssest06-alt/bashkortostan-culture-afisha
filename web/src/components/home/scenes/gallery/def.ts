import { lerp, POSE, smooth, span } from '../../scene-kit/math';
import type { SceneDef, SceneEnv, TokenPose } from '../../scene-kit/types';
import { aiRest } from '../ai/slot';
import { galleryTiming } from './timing';

/**
 * gallery: «НА ЛЮБОЙ ВКУС, есть куда пойти». Рамка, гигантская фраза, лента из шести категорий.
 *
 * Жетон (доли вступления S3a, таблица в video-part-1.md):
 *   0 %        поза конца сцены ai (её место отдаёт aiRest из ../ai/slot): на компьютере центр
 *              (50 %; 49,7 % H), диаметр 16,4 % W; углы rx = ry = rz = PI (лицом к зрителю, курай прямо);
 *   0-12 %     на телефоне жетон переходит из зазора сцены ai в центр рамки (на компьютере место то же);
 *   13-30 %    один оборот вокруг вертикальной оси (ry: PI -> 3 PI);
 *   50-67 %    подлёт вверх с перелётом (центр 50 -> 24 -> 31,5 % H) и переворот через ребро (rx: PI -> 2 PI);
 *              пока жетон идёт через ребро, он доворачивается в своей плоскости (rz: PI -> 2 PI),
 *              чтобы надпись на обороте легла прямо, а не вверх ногами;
 *   70-87 %    «садится» на первую карточку: (49,6 % W; 35,8 % H), диаметр 6,9 % W;
 *   84-92 %    гаснет вместе с проявлением фото. Дальше жетона в сцене нет (null).
 *
 * Углы в конце жизни жетона: rx = 2 PI, ry = 3 PI, rz = 2 PI (оборотной стороной к зрителю, надпись прямо).
 * При «меньше движения» все углы нулевые.
 */

const SIT_START = 0.7;
const SIT_END = 0.87;

function easeIn(t: number): number {
  return t ** 1.7;
}

function tokenPose(p: number, sceneEnv: SceneEnv): TokenPose | null {
  const mobile = sceneEnv.mobile;
  const u = p / galleryTiming(mobile).introEnd;
  if (u >= 1.04) return null;

  // Старт совпадает с концом ai численно; затем жетон встаёт в центр рамки.
  const from = aiRest(sceneEnv);
  const frameSpot = mobile ? { y: 0.047, scale: 0.41 } : { y: from.y, scale: from.scale };
  const arrive = smooth(span(u, 0, 0.12));
  const start = { y: lerp(from.y, frameSpot.y, arrive), scale: lerp(from.scale, frameSpot.scale, arrive) };

  if (sceneEnv.reduced) {
    // Без поворотов и подлёта: жетон стоит в рамке и гаснет, когда проявляется первая карточка.
    return { ...POSE, y: start.y, scale: start.scale, opacity: 1 - span(u, 0.7, 0.86) };
  }

  const peak = mobile ? { y: -0.1, scale: 0.36 } : { y: -0.26, scale: 0.17 };
  const rest = mobile ? { y: -0.06, scale: 0.34 } : { y: -0.185, scale: 0.17 };
  const sit = mobile ? { x: 0, y: -0.04, scale: 0.16 } : { x: -0.004, y: -0.142, scale: 0.069 };

  // Подлёт с разгоном (центр 50 -> 48 -> 35 -> 24 % H по кадрам), затем мягкая осадка на 7 % H.
  const jump = span(u, 0.5, 0.667);
  const rise = easeIn(span(jump, 0, 0.8));
  const settle = smooth(span(jump, 0.8, 1));
  const flownY = lerp(lerp(start.y, peak.y, rise), rest.y, settle);
  const flownScale = lerp(lerp(start.scale, peak.scale, rise), rest.scale, settle);

  const seat = smooth(span(u, SIT_START, SIT_END));

  return {
    ...POSE,
    x: lerp(0, sit.x, seat),
    y: lerp(flownY, sit.y, seat),
    scale: lerp(flownScale, sit.scale, seat),
    rx: Math.PI * (1 + span(u, 0.52, 0.667)),
    ry: Math.PI * (1 + 2 * span(u, 0.13, 0.3)),
    rz: Math.PI * (1 + smooth(span(u, 0.54, 0.65))),
    opacity: 1 - span(u, 0.84, 0.92),
  };
}

export const def: SceneDef = {
  id: 'gallery',
  // Темп выровнен по экранам прокрутки: вступление больше 3 экранов, шаг карточки около 0,65 экрана (timing.ts).
  pinVh: 10,
  pinVhMobile: 8,
  token: (p, sceneEnv) => tokenPose(p, sceneEnv),
};
