/**
 * Раскладка сцены gallery по локальному прогрессу 0..1. Чистый модуль: его читают def.ts (поза жетона)
 * и index.tsx (таймлайн), поэтому жетон и вёрстка сверяются по одним и тем же числам.
 *
 * Источник порядка: video-part-1.md, таблицы S3a, S3b, S3c. Темп выровнен по экранам прокрутки
 * (сцена длиной 10 экранов на компьютере и 8 на телефоне, def.ts): вступление больше 3 экранов,
 * шаг карточки около 0,65 экрана, выход около полутора экранов на компьютере и экрана на телефоне.
 * Доли у телефона и компьютера разные, потому что разные длины сцены.
 *
 *                       компьютер (10 экранов)   телефон (8 экранов)
 *   вступление S3a      0..0,45  (4,5 экрана)    0..0,42  (3,4 экрана)
 *   карточка 1 стоит    0,45..0,51 (0,6)         0,42..0,48 (0,5)
 *   5 шагов ленты       по 0,066 (0,66 экрана)   по 0,082 (0,66 экрана)
 *   выход S3c           0,84..1  (1,6 экрана)    0,89..1  (0,9 экрана)
 */

/** Число карточек в ленте. */
export const CARD_COUNT = 6;

export type GalleryTiming = {
  /** Конец вступления S3a (рамка, фраза, сжатие) и начало галереи. */
  introEnd: number;
  /** Начало первого шага ленты: до него карточка 1 стоит. */
  stepsStart: number;
  /**
   * Длина одного шага: 85 % движение, 15 % плато. Было 60/40: при непрерывной прокрутке лента то ехала рывком,
   * то стояла, и это читалось как подтормаживание. Теперь движение почти непрерывное, короткая остановка остаётся.
   */
  step: number;
  stepMove: number;
  /** Конец галереи S3b и начало выхода S3c. */
  exitStart: number;
  /** Доля вступления -> прогресс сцены: at(0.23) это 23 % таблицы S3a. */
  at: (introShare: number) => number;
  /** Доля выхода S3c -> прогресс сцены. */
  exitAt: (exitShare: number) => number;
  /** Прогресс, на котором карточка index стоит в рамке (середина плато): сюда ведёт фокус с клавиатуры. */
  cardRest: (index: number) => number;
};

function makeTiming(introEnd: number, stepsStart: number, step: number): GalleryTiming {
  const stepMove = step * 0.85;
  const exitStart = stepsStart + step * (CARD_COUNT - 1);
  return {
    introEnd,
    stepsStart,
    step,
    stepMove,
    exitStart,
    at: (introShare) => introShare * introEnd,
    exitAt: (exitShare) => exitStart + exitShare * (1 - exitStart),
    cardRest: (index) =>
      index <= 0 ? (introEnd + stepsStart) / 2 : stepsStart + step * (index - 1) + stepMove + (step - stepMove) / 2,
  };
}

const DESKTOP = makeTiming(0.45, 0.51, 0.066);
const MOBILE = makeTiming(0.42, 0.48, 0.082);

/** Раскладка для ширины окна: телефон (меньше 768) или компьютер. */
export function galleryTiming(mobile: boolean): GalleryTiming {
  return mobile ? MOBILE : DESKTOP;
}
