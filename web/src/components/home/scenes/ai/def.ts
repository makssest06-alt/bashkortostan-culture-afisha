import { lerp, POSE, span } from '../../scene-kit/math';
import type { SceneDef } from '../../scene-kit/types';
import { HERO_EXIT, heroRest } from '../hero/def';
import { aiRest } from './slot';

/**
 * ai: «Подберёт ИИ».
 *
 * Жетон продолжает позу конца hero (rx = π, ry = π, rz = π, диаметр 27,8 % ширины) и за первые 24 % сцены
 * уменьшается до 16,4 % ширины, замедляясь к концу (кадры 28-38). Углы не меняются: три поворота на π
 * в сумме дают исходное положение, жетон стоит лицом к зрителю, курай прямо.
 * Дальше жетон неподвижен: на компьютере в центре, на телефоне в зазоре над строкой запроса.
 *
 * Поза в конце сцены (с неё должна начинать gallery, иначе на стыке будет лишний поворот):
 *   компьютер  x 0, y -0.003, scale 0.164, rx π, ry π, rz π (в низком окне, где жетон задел бы строку
 *              запроса, y и scale по зазору: см. slot.ts; gallery берёт их оттуда же через aiRest)
 *   телефон    x 0, y и scale по зазору (на 390x844 с русским текстом около 0.01 и 0.56), углы те же
 *   «меньше движения»: все углы 0.
 */

/** Доля сцены, к которой жетон встал на место. После неё поза не меняется. */
export const AI_SETTLED = 0.24;

export const def: SceneDef = {
  id: 'ai',
  pinVh: 1.8,
  pinVhMobile: 1.4,
  // Свечение догорает после hero. На телефоне оно слабее: под текстом внизу экрана нужен тёмный фон.
  glow: (p, env) => (env.mobile ? 0.42 : lerp(0.92, 1, span(p, 0, 0.1))),
  token: (p, env) => {
    const rest = aiRest(env);
    const from = heroRest(env);
    const fromScale = from.scale * HERO_EXIT;
    // Шаг уменьшения падает от кадра к кадру: 1 - (1 - t)^1.6 ложится на замеры 24,0 / 21,4 / 19,6 / 18,4 / 16,4.
    const settle = 1 - Math.pow(1 - span(p, 0, AI_SETTLED), 1.6);
    return {
      ...POSE,
      x: lerp(from.x, 0, settle),
      y: lerp(from.y, rest.y, settle),
      scale: lerp(fromScale, rest.scale, settle),
      rx: env.reduced ? 0 : Math.PI,
      ry: env.reduced ? 0 : Math.PI,
      rz: env.reduced ? 0 : Math.PI,
    };
  },
};
