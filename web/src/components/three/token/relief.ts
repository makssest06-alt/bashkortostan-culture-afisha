/**
 * Чеканка жетона из карты высот. Считается один раз на процессоре (canvas 2D), результат в кэше модуля:
 *   normal   карта нормалей RGBA: рельеф плюс лёгкая неровность чеканки и мелкое зерно;
 *   color    цвет меди (sRGB): выпуклое светлее (потёртости), у подножия рельефа темнее (патина и тень);
 *   rough    шероховатость в канале G (его читает roughnessMap): выпуклое глаже, впадины шершавее;
 *   contours контуры рельефа для режима чертежа: пары точек в координатах картинки (u, v в 0..1).
 *
 * Бортик в карте высот есть, но здесь он гасится маской: бортик и фаска сделаны геометрией (shape.ts).
 */

import { marchingSquares } from './contours';
import { TOKEN } from './shape';

export type SideRelief = {
  /** Сторона карты нормалей в пикселях. */
  size: number;
  /** Сторона карт цвета и шероховатости (вдвое меньше: там нет мелких деталей). */
  surfaceSize: number;
  normal: Uint8Array;
  color: Uint8Array;
  rough: Uint8Array;
  contours: Float32Array;
};

export type ReliefSource = { front: SideRelief; back: SideRelief };

export const RELIEF_URLS = {
  front: '/ornament/token-height.png',
  back: '/ornament/token-height-back.png',
} as const;

/** Уровни серого в картах высот: поле #2e, рельеф #e6. */
const FIELD_LEVEL = 0x2e / 255;
const RELIEF_LEVEL = 0xe6 / 255;

/** Радиус (в долях радиуса жетона), за которым рельеф из карты не берётся: дальше геометрический бортик. */
const MASK_FROM = 0.872;
const MASK_TO = 0.886;
/** Подножие и вершина внутреннего склона бортика в тех же долях. */
const RIM_FOOT = TOKEN.rimFoot / TOKEN.radius;
const RIM_TOP = TOKEN.rimInner / TOKEN.radius;

/** Средний наклон зерна (тангенс угла): мелкий шум поверхности, не зависит от размера карты. */
const GRAIN_SLOPE = 0.032;
/**
 * Мнимая выпуклость поля: нормаль у края поля отклонена наружу на этот наклон (тангенс угла).
 * Геометрия поля плоская, но свет на нём ложится градиентом и при повороте блик идёт через всё лицо,
 * а не вспыхивает разом, как на плоском зеркале.
 */
const CAMBER_SLOPE = 0.16;
const FIELD_RADIUS = 0.9;
/** Сторона сетки для контуров чертежа. */
const CONTOUR_GRID = 256;

type Rgb = readonly [number, number, number];
/** Медь: патина в поле, потёртые выпуклости, окисел во впадинах. Значения sRGB 0..255. */
const COPPER_FIELD: Rgb = [196, 104, 60];
const COPPER_WORN: Rgb = [247, 176, 124];
const COPPER_CAVITY: Rgb = [104, 46, 26];

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);
const smoothstep = (from: number, to: number, value: number) => {
  const t = clamp01((value - from) / (to - from));
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** Детерминированный генератор: у жетона всегда один и тот же рисунок зерна. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Гладкий шум на решётке cells x cells, значения -1..1. Координаты u, v в 0..1. */
function valueNoise(seed: number, cells: number): (u: number, v: number) => number {
  const random = mulberry32(seed);
  const stride = cells + 1;
  const lattice = new Float32Array(stride * stride);
  for (let i = 0; i < lattice.length; i += 1) lattice[i] = random() * 2 - 1;
  return (u, v) => {
    const fx = clamp01(u) * cells;
    const fy = clamp01(v) * cells;
    const x0 = Math.min(Math.floor(fx), cells - 1);
    const y0 = Math.min(Math.floor(fy), cells - 1);
    const tx = fx - x0;
    const ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const row = y0 * stride + x0;
    const top = lattice[row] + (lattice[row + 1] - lattice[row]) * sx;
    const bottom = lattice[row + stride] + (lattice[row + stride + 1] - lattice[row + stride]) * sx;
    return top + (bottom - top) * sy;
  };
}

const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function readHeight(url: string, size: number): Promise<Float32Array> {
  const image = new Image();
  image.decoding = 'async';
  image.src = url;
  await image.decode();

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('canvas 2D недоступен');
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, size, size);
  const { data } = context.getImageData(0, 0, size, size);

  const height = new Float32Array(size * size);
  for (let i = 0; i < height.length; i += 1) height[i] = data[i * 4] / 255;
  // Холст больше не нужен: отдаём память сразу.
  canvas.width = 0;
  canvas.height = 0;
  return height;
}

/** Высота рельефа 0..1 над полем, без бортика. */
function toRelief(raw: Float32Array, size: number): Float32Array {
  const relief = new Float32Array(raw.length);
  const half = size / 2;
  for (let y = 0; y < size; y += 1) {
    const dy = (y + 0.5 - half) / half;
    for (let x = 0; x < size; x += 1) {
      const dx = (x + 0.5 - half) / half;
      const mask = 1 - smoothstep(MASK_FROM, MASK_TO, Math.sqrt(dx * dx + dy * dy));
      const index = y * size + x;
      relief[index] = mask === 0 ? 0 : clamp01((raw[index] - FIELD_LEVEL) / (RELIEF_LEVEL - FIELD_LEVEL)) * mask;
    }
  }
  return relief;
}

function buildNormal(relief: Float32Array, size: number, seed: number): Uint8Array {
  const hammer = valueNoise(seed, 9);
  const dents = valueNoise(seed + 17, 27);
  const random = mulberry32(seed + 101);
  // Разность двух независимых отсчётов равномерного шума имеет отклонение 0.408 амплитуды.
  const slopeScale = (TOKEN.reliefHeight * size) / 2;
  const grain = GRAIN_SLOPE / (0.408 * slopeScale);
  // Парабола в единицах высоты рельефа: её наклон на краю поля равен CAMBER_SLOPE.
  const camber = (CAMBER_SLOPE * TOKEN.radius) / (2 * FIELD_RADIUS * TOKEN.reliefHeight);

  const height = new Float32Array(size * size);
  const half = size / 2;
  for (let y = 0; y < size; y += 1) {
    const v = (y + 0.5) / size;
    const dy = (y + 0.5 - half) / half;
    for (let x = 0; x < size; x += 1) {
      const u = (x + 0.5) / size;
      const dx = (x + 0.5 - half) / half;
      const index = y * size + x;
      const lift = relief[index];
      // На самом краю картинки (гурт) шум гасим: там UV вырождены, нормаль должна быть чистой.
      const r = Math.sqrt(dx * dx + dy * dy);
      const edge = 1 - smoothstep(0.975, 0.995, r);
      // На выпуклом металл затёрт до гладкого: неровности и зерно там слабее.
      const calm = 1 - 0.6 * lift;
      const micro = (hammer(u, v) * 0.2 + dents(u, v) * 0.07 + (random() - 0.5) * grain) * calm;
      const inField = Math.min(r, FIELD_RADIUS);
      height[index] = lift + micro * edge - camber * inField * inField;
    }
  }

  const normal = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    const up = y === 0 ? 0 : y - 1;
    const down = y === size - 1 ? y : y + 1;
    for (let x = 0; x < size; x += 1) {
      const left = x === 0 ? 0 : x - 1;
      const right = x === size - 1 ? x : x + 1;
      const nx = -(height[y * size + right] - height[y * size + left]) * slopeScale;
      const ny = -(height[down * size + x] - height[up * size + x]) * slopeScale;
      const inverse = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      const out = (y * size + x) * 4;
      normal[out] = Math.round((nx * inverse * 0.5 + 0.5) * 255);
      normal[out + 1] = Math.round((ny * inverse * 0.5 + 0.5) * 255);
      normal[out + 2] = Math.round((inverse * 0.5 + 0.5) * 255);
      normal[out + 3] = 255;
    }
  }
  return normal;
}

/** Уменьшение вдвое усреднением. */
function halve(source: Float32Array, size: number): Float32Array {
  const half = size >> 1;
  const out = new Float32Array(half * half);
  for (let y = 0; y < half; y += 1) {
    for (let x = 0; x < half; x += 1) {
      const i = y * 2 * size + x * 2;
      out[y * half + x] = (source[i] + source[i + 1] + source[i + size] + source[i + size + 1]) * 0.25;
    }
  }
  return out;
}

/** Размытие прямоугольным окном в два прохода: по строкам и по столбцам. */
function boxBlur(source: Float32Array, size: number, radius: number): Float32Array {
  const pass = new Float32Array(source.length);
  const out = new Float32Array(source.length);
  const window = radius * 2 + 1;
  for (let y = 0; y < size; y += 1) {
    let sum = 0;
    for (let k = -radius; k <= radius; k += 1) sum += source[y * size + Math.min(size - 1, Math.max(0, k))];
    for (let x = 0; x < size; x += 1) {
      pass[y * size + x] = sum / window;
      sum += source[y * size + Math.min(size - 1, x + radius + 1)] - source[y * size + Math.max(0, x - radius)];
    }
  }
  for (let x = 0; x < size; x += 1) {
    let sum = 0;
    for (let k = -radius; k <= radius; k += 1) sum += pass[Math.min(size - 1, Math.max(0, k)) * size + x];
    for (let y = 0; y < size; y += 1) {
      out[y * size + x] = sum / window;
      sum += pass[Math.min(size - 1, y + radius + 1) * size + x] - pass[Math.max(0, y - radius) * size + x];
    }
  }
  return out;
}

/**
 * polish 0..1: насколько отполировано поле. У оборота поле глаже и светлее,
 * поэтому в кувырке он вспыхивает ярче лица (как дно объекта в референсе).
 */
function buildSurface(
  relief: Float32Array,
  size: number,
  seed: number,
  polish: number,
): { color: Uint8Array; rough: Uint8Array } {
  const radius = Math.max(2, Math.round(size * 0.012));
  const spread = boxBlur(boxBlur(relief, size, radius), size, radius);
  const wearNoise = valueNoise(seed + 31, 7);
  const mottle = valueNoise(seed + 47, 19);
  const random = mulberry32(seed + 211);

  const color = new Uint8Array(size * size * 4);
  const rough = new Uint8Array(size * size * 4);
  const half = size / 2;

  for (let y = 0; y < size; y += 1) {
    const v = (y + 0.5) / size;
    const dy = (y + 0.5 - half) / half;
    for (let x = 0; x < size; x += 1) {
      const u = (x + 0.5) / size;
      const dx = (x + 0.5 - half) / half;
      const r = Math.sqrt(dx * dx + dy * dy);
      const index = y * size + x;
      const lift = relief[index];

      // Впадина: точка ниже своего окружения (поле вплотную к рельефу, просветы в завитках).
      const cavity = clamp01((spread[index] - lift) * 1.7);
      // Подножие бортика изнутри: туда свет почти не попадает.
      const foot = smoothstep(0.86, RIM_FOOT, r) * (1 - smoothstep(RIM_FOOT, RIM_TOP, r));
      // Потёртость: вершины рельефа и бортик, неравномерно.
      const rim = smoothstep(RIM_FOOT + 0.006, RIM_TOP, r);
      const uneven = 0.78 + 0.22 * wearNoise(u, v);
      const worn = clamp01(Math.max(lift, rim, polish * 0.22) * uneven);
      const shade = clamp01(cavity * 0.7 + foot * 0.45);
      const grain = random() - 0.5;
      // Затенение впадин запечено в цвет: у металла цвет и есть сила отражения, отдельная карта AO не нужна.
      const occlusion = 1 - 0.38 * cavity - 0.26 * foot;
      const tone = (1 + 0.07 * mottle(u, v) + 0.03 * grain) * occlusion;

      const out = index * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        const base = mix(mix(COPPER_FIELD[channel], COPPER_WORN[channel], worn), COPPER_CAVITY[channel], shade);
        color[out + channel] = Math.round(Math.min(255, Math.max(0, base * tone)));
      }
      color[out + 3] = 255;

      const roughness = mix(0.52, 0.26, worn) - 0.06 * polish + 0.12 * cavity + 0.08 * mottle(v, u) + 0.05 * grain;
      const byte = Math.round(Math.min(0.8, Math.max(0.2, roughness)) * 255);
      rough[out] = byte;
      rough[out + 1] = byte;
      rough[out + 2] = byte;
      rough[out + 3] = 255;
    }
  }
  return { color, rough };
}

async function buildSide(url: string, size: number, seed: number, polish: number): Promise<SideRelief> {
  const raw = await readHeight(url, size);
  const relief = toRelief(raw, size);
  await nextTask();
  const normal = buildNormal(relief, size, seed);
  await nextTask();
  const surfaceSize = size >> 1;
  const reduced = halve(relief, size);
  const { color, rough } = buildSurface(reduced, surfaceSize, seed, polish);
  await nextTask();

  let grid = reduced;
  let gridSize = surfaceSize;
  while (gridSize > CONTOUR_GRID) {
    grid = halve(grid, gridSize);
    gridSize >>= 1;
  }
  const contours = marchingSquares(grid, gridSize, 0.5);
  return { size, surfaceSize, normal, color, rough, contours };
}

const cache = new Map<number, Promise<ReliefSource>>();

/**
 * Обе стороны чеканки для карты нормалей со стороной size (степень двойки).
 * Повторный вызов с тем же размером отдаёт уже посчитанное.
 */
export function loadReliefSource(size: number): Promise<ReliefSource> {
  let pending = cache.get(size);
  if (!pending) {
    pending = (async () => {
      const front = await buildSide(RELIEF_URLS.front, size, 102, 0);
      await nextTask();
      const back = await buildSide(RELIEF_URLS.back, size, 2026, 1);
      return { front, back };
    })();
    // Неудачную загрузку не кэшируем: следующий монтаж попробует снова.
    pending.catch(() => cache.delete(size));
    cache.set(size, pending);
  }
  return pending;
}
