import { lerp, POSE, smooth, span } from '../../scene-kit/math';
import type { SceneDef } from '../../scene-kit/types';

/**
 * Высота секции в экранах. Сцена идёт обычным потоком, её длина зависит от вёрстки,
 * поэтому компонент сцены замеряет секцию и записывает число сюда (setCitiesScreens).
 * До замера работает оценка: первый экран, шапка списка и восемь строк.
 */
const layout = { screens: 3.9 };

export function setCitiesScreens(screens: number): void {
  if (Number.isFinite(screens) && screens > 1) layout.screens = screens;
}

/** Диаметр жетона в долях ширины окна (референс: 0,24 ширины). На телефоне жетон в списке меньше. */
const SCALE = 0.24;
const SCALE_MOBILE = 0.4;
/** Поза на стыке с popular: та же, с которой popular начинает (ребром, в центре). */
const END_SCALE_MOBILE = 0.56;

/**
 * cities (S11): «ВСЯ РЕСПУБЛИКА НА ОДНОЙ АФИШЕ», строки-города. Обычный поток, жетон липкий.
 *
 * Прогресс сцены-потока: 0, когда верх секции показался у нижнего края окна; 1, когда низ ушёл за верхний.
 * d это путь в экранах с этого момента, top положение верха секции (1 низ окна, 0 верх окна).
 *
 * Жетон (video-part-3, 4.3):
 *   - приезжает вместе с секцией: центр на 0,49 экрана ниже её верхнего края, затем стоит в центре окна;
 *   - полуоборот вокруг горизонтальной оси, линейно: от момента, когда верх секции на 0,21 высоты окна
 *     (кадр 393), до 0,55 экрана перед концом секции (кадр 409);
 *   - последние 0,55 экрана: четверть оборота вокруг вертикальной оси, к стыку жетон стоит ребром.
 * На стыке с popular поза: x 0, y 0, scale 0.24 (телефон 0.56), rx PI, ry PI / 2, rz 0, opacity 1.
 * В начале сцены жетон ещё под светлым блоком trust (у trust жетона нет): он проявляется из прозрачности.
 */
export const def: SceneDef = {
  id: 'cities',
  pinVh: 0,
  flow: true,
  // Фон сцены рисует её подложка (тёплый тёмный и свечение сверху по центру), боковое свечение выключено.
  glow: 0,
  token: (p, env) => {
    const total = layout.screens + 1;
    const d = p * total;
    const top = 1 - d;
    const tail = total - d;
    const turnEnd = total - 0.55;

    // На телефоне жетон лежит под абзацем и названиями городов: он приглушён раньше, чем текст до него доедет
    // (абзац первого экрана встречает жетон на d = 1,14), иначе светлый текст терялся бы на меди.
    const inList = env.mobile ? smooth(span(d, 1.02, 1.14)) * smooth(span(tail, 0.5, 0.9)) : 0;
    const scale = env.mobile ? lerp(END_SCALE_MOBILE, SCALE_MOBILE, smooth(span(tail, 0.3, 0.9))) : SCALE;

    return {
      ...POSE,
      y: Math.max(0, top + (env.mobile ? 0 : -0.01)),
      scale,
      rx: env.reduced ? Math.PI : Math.PI * span(d, 0.79, turnEnd),
      ry: env.reduced ? Math.PI / 2 : (Math.PI / 2) * span(d, turnEnd, total),
      opacity: smooth(span(d, 0.08, 0.3)) * lerp(1, 0.24, inList),
    };
  },
};
