/**
 * Геометрия слова «АФИША» для построения: замеры Golos Text Variable, вес 600, кегль 1000.
 * Единицы: тысячные кегля, ось y вниз, базовая линия на y = 700, верх прописных на y = 0.
 * Замер: .reanimate/home/check/h3/measure-font.mjs (холст в Chromium с тем же шрифтом, что на сайте).
 * Если сменится шрифт или вес знака, числа нужно снять заново.
 */

export const CAP = 700;
export const FONT_SIZE = 1000;

/** Буквы слова: сдвиг начала (сумма ширин набора) и чернильные границы внутри своей ячейки. */
export const LETTERS = [
  { char: 'А', x: 0, left: 10, right: 679, top: 0, bottom: 700 },
  { char: 'Ф', x: 689, left: 45, right: 855, top: -30, bottom: 729 },
  { char: 'И', x: 1589, left: 80, right: 680, top: 0, bottom: 700 },
  { char: 'Ш', x: 2349, left: 80, right: 910, top: 0, bottom: 700 },
  { char: 'А', x: 3338, left: 10, right: 679, top: 0, bottom: 700 },
] as const;

/** Чернильные границы всего слова. */
export const INK = { left: 10, right: 4017 } as const;
export const INK_WIDTH = INK.right - INK.left;

/** Поле SVG: слово по центру, запас под узлы, ручки и подписи. */
export const VIEW = { x: -190, y: -300, w: 4407, h: 1300 } as const;
export const VIEW_CENTER = { x: VIEW.x + VIEW.w / 2, y: CAP / 2 } as const;

/** Чаша буквы «Ф»: внешний и внутренний овалы и стойка. */
export const BOWL = {
  cx: 689 + 450,
  cy: 349.5,
  rx: 405,
  ry: 316.5,
  innerRx: 249,
  innerRy: 200,
  stem: [689 + 375, 689 + 524],
} as const;

/** Вершина и опоры буквы «А» внутри её ячейки. */
export const A_POINTS = [
  [344, 0],
  [84, 700],
  [600, 700],
] as const;
