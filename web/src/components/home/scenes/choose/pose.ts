/**
 * Геометрия и позы жетона сцены choose. Чистый модуль: импортирует только математику и типы scene-kit,
 * поэтому его можно подключать из def.ts (своей сцены и соседней popular) без цикла с реестром.
 *
 * Сцена choose идёт потоком (flow), а короткое закрепление на компьютере делает сама через position: sticky.
 * Так локальный прогресс идёт по всей секции: вход снизу, закрепление, уход вверх вместе с колонками сравнения.
 * Жетон поэтому может стоять в центре на входе, перестроиться в закреплении и уехать вместе со страницей.
 *
 * Прогресс сцены-потока: 0, когда верх секции показался снизу окна; 1, когда низ ушёл за верх.
 * Пройденный путь в экранах: s = p * (total + 1).
 *   s от 0 до 1               вход: секция поднимается снизу до верха окна;
 *   s от 1 до 1 + pin         закрепление (только компьютер, без «меньше движения»);
 *   дальше                    уход: экран сцены и колонки сравнения едут вверх.
 */

import { clamp01, lerp, POSE, smooth, span } from '../../scene-kit/math';
import type { SceneEnv, TokenPose } from '../../scene-kit/types';

/** Длина закрепления на компьютере, в экранах (S13: около 1,5 экрана). В CSS это же число: --choose-pin. */
export const CHOOSE_PIN = 1.5;

/** Наклон «в три четверти»: жетон лежит как на полу, вид сверху под углом около 65 градусов. */
export const THREE_QUARTER = -1.13;

/**
 * Замеры секции. Пишет компонент сцены после вёрстки (ResizeObserver), читает поза жетона.
 * Значения в экранах (высотах окна). До замера стоят правдоподобные числа по макету.
 */
export const chooseGeometry = {
  /** Высота всей секции. */
  total: 3.9,
  /** Центр места под жетон от верха секции: нужен там, где сцена идёт без закрепления. */
  anchor: 0.75,
};

/** Закреплена ли сцена: только компьютер и только без «меньше движения». */
export function isChoosePinned(env: SceneEnv): boolean {
  return !env.mobile && !env.reduced;
}

/** Пройденный путь в экранах по локальному прогрессу. */
export function chooseTravel(progress: number): number {
  return progress * (chooseGeometry.total + 1);
}

/** Доля закрепления 0..1 по локальному прогрессу (для таймлайна сцены). */
export function choosePinProgress(progress: number): number {
  return clamp01((chooseTravel(progress) - 1) / CHOOSE_PIN);
}

/** Локальный прогресс сцены для доли закрепления q: позиции таймлайна пишутся через эту функцию. */
export function chooseProgressAt(q: number): number {
  return (1 + CHOOSE_PIN * q) / (chooseGeometry.total + 1);
}

function easeOut(t: number): number {
  const x = clamp01(t);
  return 1 - (1 - x) * (1 - x);
}

/** Диаметр жетона в покое в центре экрана (S12 и начало S13: 23,4 % ширины). */
const SCALE_CENTER = 0.234;
/** Диаметр в три четверти под знаком (S13: 22 % ширины). */
const SCALE_REST = 0.22;
/** На телефоне жетон под вкладками занимает около половины ширины (51 %). */
const SCALE_MOBILE = 0.51;

/** Центр жетона по вертикали в долях окна: чуть ниже середины на входе, 0,748 в покое под знаком. */
const CENTER_ENTER = 0.51;
const CENTER_LOW = 0.775;
const CENTER_REST = 0.748;

/**
 * Поза жетона сцены choose по пройденному пути s (в экранах).
 * Эта же функция при s = 0 даёт позу, которой заканчивается сцена popular: углы на стыке совпадают.
 */
export function choosePoseAt(s: number, env: SceneEnv): TokenPose {
  if (!isChoosePinned(env)) {
    // Телефон и «меньше движения»: жетон стоит в своём месте под вкладками и едет вместе со страницей.
    const center = 1 - s + chooseGeometry.anchor;
    return {
      ...POSE,
      y: center - 0.5,
      scale: env.mobile ? SCALE_MOBILE : SCALE_REST,
      rx: THREE_QUARTER,
      // Ниже окна жетон просто не виден; гасим его, только когда он уехал далеко вверх.
      opacity: center > -0.4 ? 1 : 0,
    };
  }

  if (s <= 1) {
    // Вход: полоса popular уезжает вверх, жетон проявляется в центре оборотом к зрителю. Пока поверх него
    // уезжает панель popular (первая половина входа), жетон скрыт, иначе он торчит из-под панели.
    return { ...POSE, y: CENTER_ENTER - 0.5, scale: SCALE_CENTER, ry: Math.PI, opacity: smooth(span(s, 0.62, 1)) };
  }

  const q = clamp01((s - 1) / CHOOSE_PIN);
  // Вниз с торможением (кадры 470-475), затем чуть приподнимается вместе со знаком (475-478).
  const center =
    CENTER_ENTER +
    (CENTER_LOW - CENTER_ENTER) * easeOut(span(q, 0, 0.45)) -
    (CENTER_LOW - CENTER_REST) * smooth(span(q, 0.55, 0.82));
  const after = Math.max(0, s - 1 - CHOOSE_PIN);
  const y = center - after;

  return {
    ...POSE,
    y: y - 0.5,
    scale: lerp(SCALE_CENTER, SCALE_REST, smooth(span(q, 0.09, 0.82))),
    // Переворот лицом (кадры 470-471), затем наклон в три четверти. Наклон закончен к 0,62 закрепления:
    // кольцо на полу (оно нарисовано уже в наклоне) проявляется с 0,5, когда жетон почти лёг, и они совпадают.
    ry: Math.PI * (1 - smooth(span(q, 0.05, 0.22))),
    rx: THREE_QUARTER * easeOut(span(q, 0.2, 0.62)),
    opacity: y > -0.35 ? 1 : 0,
  };
}

/** Поза на входе в сцену: её берёт popular как свою последнюю позу. */
export function chooseEntryPose(env: SceneEnv): TokenPose {
  return choosePoseAt(0, env);
}
