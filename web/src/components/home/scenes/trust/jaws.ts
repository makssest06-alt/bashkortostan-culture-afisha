/**
 * Геометрия раскрытия фактуры: две половины с рваной кромкой и их поза по прогрессу сцены.
 * Чистые функции без DOM. Числа сняты с кадров 338-352 референса (video-part-3, 3.1 и 3.3).
 *
 * По ширине каждый слой фактуры больше экрана на BLEED процентов с каждой стороны (чтобы сдвиг и поворот
 * не открывали края). По высоте у каждого слоя своя коробка: неподвижная сомкнутая фактура занимает
 * весь запас, а подвижные половины только свою часть (верхняя до щели, нижняя от щели). Так слой
 * половины почти вдвое меньше: на телефоне это десятки мегабайт памяти.
 * Все координаты в процентах экрана сцены, в CSS уходят уже пересчитанными в проценты своей коробки.
 */

import type { CSSProperties } from 'react';

import { clamp01, span } from '../../scene-kit/math';
import { TRUST } from './def';

/** Запас слоя за краями экрана, % стороны экрана. */
export const BLEED = 16;
const FULL = 100 + BLEED * 2;

/** Высота щели: 49 % экрана (v 0,488-0,495 в референсе). */
const SLIT = 49;

/** Вертикальная коробка слоя: верх и высота в процентах высоты экрана. */
type Box = { readonly top: number; readonly height: number };

/** Неподвижная фактура: весь запас сверху и снизу. */
const STILL_BOX: Box = { top: -BLEED, height: FULL };
/** Верхняя половина: от запаса сверху до чуть ниже кромки (кромка не опускается ниже 50 %). */
const UPPER_BOX: Box = { top: -BLEED, height: 51 + BLEED };
/** Нижняя половина: от чуть выше кромки (кромка не поднимается выше 48,5 %) до запаса снизу. */
const LOWER_BOX: Box = { top: 47, height: 100 + BLEED - 47 };

/** Процент ширины экрана -> процент ширины слоя (ширина у всех слоёв одна). */
function toLayerX(screenPercent: number): number {
  return ((screenPercent + BLEED) / FULL) * 100;
}

/** Процент высоты экрана -> процент высоты коробки. */
function toLayerY(screenPercent: number, box: Box): number {
  return ((screenPercent - box.top) / box.height) * 100;
}

/** Рваная линия разрыва: несколько синусов дают неровную, но одинаковую на сервере и в браузере кромку. */
function edgeY(x: number): number {
  return SLIT + 0.42 * Math.sin(x * 0.61 + 1.3) + 0.3 * Math.sin(x * 1.9 + 0.4) + 0.18 * Math.sin(x * 4.3 + 2.1);
}

/** Половина толщины щели: 1 % высоты слева, около 4 % у правого края. */
function halfGap(x: number): number {
  return 0.5 + 1.5 * clamp01(x / 100) ** 1.6;
}

function point(x: number, y: number, box: Box): string {
  return `${toLayerX(x).toFixed(2)}% ${toLayerY(y, box).toFixed(2)}%`;
}

function edgePoints(side: -1 | 1, box: Box): string[] {
  const points: string[] = [];
  for (let x = -BLEED; x <= 100 + BLEED; x += 2) {
    points.push(point(x, edgeY(x) + side * halfGap(x), box));
  }
  return points;
}

/** clip-path верхней половины: всё выше кромки. */
export const UPPER_CLIP = `polygon(0% 0%, ${edgePoints(-1, UPPER_BOX).join(', ')}, 100% 0%)`;
/** clip-path нижней половины: всё ниже кромки. */
export const LOWER_CLIP = `polygon(0% 100%, ${edgePoints(1, LOWER_BOX).join(', ')}, 100% 100%)`;
/**
 * clip-path неподвижной фактуры: обе половины одним многоугольником, щель между ними вырезана.
 * Обход: верхний край, верхняя кромка справа налево, по левому краю слоя (за экраном) через щель,
 * нижняя кромка слева направо, низ. Одна картинка вместо двух.
 */
export const STILL_CLIP = `polygon(0% 0%, 100% 0%, ${[
  ...edgePoints(-1, STILL_BOX).reverse(),
  ...edgePoints(1, STILL_BOX),
].join(', ')}, 100% 100%, 0% 100%)`;

/**
 * Место картинки и подсветки внутри коробки слоя. У всех трёх слоёв фактура должна лечь
 * в одни и те же точки экрана, поэтому верх и высота заданы от общего прямоугольника FULL x FULL,
 * а в CSS уходят в процентах своей коробки (переменные читает trust.module.css).
 */
function boxVars(box: Box): CSSProperties {
  const texInset = 0.06 * FULL;
  return {
    '--tex-top': `${toLayerY(-BLEED - texInset, box).toFixed(3)}%`,
    '--tex-h': `${(((FULL + 2 * texInset) / box.height) * 100).toFixed(3)}%`,
    '--glow-top': `${toLayerY(-BLEED, box).toFixed(3)}%`,
    '--glow-h': `${((FULL / box.height) * 100).toFixed(3)}%`,
  } as CSSProperties;
}

export const STILL_VARS = boxVars(STILL_BOX);
export const UPPER_VARS = boxVars(UPPER_BOX);
export const LOWER_VARS = boxVars(LOWER_BOX);

/**
 * Наклон кромки верхней половины по прогрессу сцены, градусы (прогресс = (кадр - 318) / 61).
 * Кадр 341: 1°, 344: 2°, 346: 5,5°, 347: 10°, 348: 16°, 349: 21°, 350: 24°, 351: 34°, дальше рывок за край.
 */
const ANGLE: readonly (readonly [number, number])[] = [
  [TRUST.openFrom, 0],
  [0.38, 1],
  [0.426, 2],
  [0.459, 5.5],
  [0.475, 10],
  [0.492, 16],
  [0.508, 21],
  [0.525, 24],
  [0.541, 34],
  [0.557, 46],
  [TRUST.openTo, 58],
];

/** Нижняя половина наклонена слабее верхней (9° против 14°, 26° против 32°). */
const LOWER_RATIO = 0.8;

function angleAt(p: number): number {
  if (p <= ANGLE[0][0]) return 0;
  for (let i = 1; i < ANGLE.length; i += 1) {
    const [toP, toDeg] = ANGLE[i];
    if (p <= toP) {
      const [fromP, fromDeg] = ANGLE[i - 1];
      return fromDeg + ((toDeg - fromDeg) * (p - fromP)) / (toP - fromP);
    }
  }
  return ANGLE[ANGLE.length - 1][1];
}

export type JawsPose = {
  upper: string;
  lower: string;
  /** Смаз вдоль движения, px. */
  blur: number;
  /** Где сейчас шарнир: % ширины экрана. Левее него фактура ещё сомкнута (её держит неподвижный слой). */
  hinge: number;
};

/** Половины сомкнуты: поза до начала раскрытия. */
export const JAWS_CLOSED: JawsPose = { upper: 'none', lower: 'none', blur: 0, hinge: 100 };

/**
 * Поза половин фактуры. Шарнир едет по линии щели справа налево (клин раскрытия бежит от правого края:
 * u 0,85 в кадре 339, 0,46 в кадре 344, 0,20 после кадра 347), наклон кромки растёт по таблице ANGLE.
 * В конце половины уезжают за левые углы: верхняя вверх и влево, нижняя вниз и влево.
 *
 * Наклон задан сдвигом (skewY) вокруг шарнира, а не поворотом: точки на вертикали шарнира остаются
 * на месте, поэтому подвижная половина без шва стыкуется с неподвижной фактурой левее шарнира,
 * а сама фактура растягивается вдоль кромки, как в кадрах 347-350. Разворот правого края к зрителю
 * (rotateY в перспективе) идёт вокруг той же вертикали и шва тоже не даёт.
 *
 * На телефоне (flat) поза плоская: без rotateY и без смаза. Разворот там даёт меньше 7 % увеличения
 * у правого края и не читается, а 3D-слой и размытие на слое больше экрана дороги по памяти в WebKit.
 */
export function jawsPose(p: number, flat: boolean): JawsPose {
  if (p <= TRUST.openFrom) return JAWS_CLOSED;

  const angle = angleAt(p);
  const hinge = 100 * clamp01(1 - (p - TRUST.openFrom) / 0.225);
  const leave = span(p, 0.525, TRUST.openTo) ** 2;
  const tilt = -14 * span(p, 0.4, 0.56);
  const hingeX = toLayerX(hinge).toFixed(2);
  const shiftX = (-36 * leave).toFixed(2);
  // Уход за угол: 30 % высоты прежнего слоя FULL, то есть 39,6 % экрана.
  const shiftScreen = 0.3 * FULL * leave;

  const pose = (deg: number, dir: -1 | 1, box: Box) => {
    const hingeY = toLayerY(SLIT, box).toFixed(2);
    const y = ((dir * shiftScreen * 100) / box.height).toFixed(2);
    const move = flat ? `translate(${shiftX}%, ${y}%)` : `translate3d(${shiftX}%, ${y}%, 0)`;
    const turn = flat ? '' : ` rotateY(${tilt.toFixed(2)}deg)`;
    return (
      `${move} translate(${hingeX}%, ${hingeY}%) skewY(${deg.toFixed(2)}deg)${turn} ` +
      `translate(-${hingeX}%, -${hingeY}%)`
    );
  };

  return {
    upper: pose(-angle, -1, UPPER_BOX),
    lower: pose(angle * LOWER_RATIO, 1, LOWER_BOX),
    // Смаз включается, когда клин уже дошёл до левой трети: резкой границы с неподвижной фактурой не видно.
    blur: flat ? 0 : 6 * span(p, 0.47, 0.57),
    hinge,
  };
}
