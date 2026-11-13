/**
 * Общая геометрия четырёх сцен blueprint, wordmark, filters, dedup.
 * Чистый модуль без зависимостей: его можно импортировать и из def.ts, и из компонентов.
 * Все доли: x, y это смещение от центра окна (как в TokenPose), d это диаметр в долях ширины окна.
 */

export type Spot = { x: number; y: number; d: number };

/** Жетон на столе в сцене blueprint: правая область на компьютере, центр на телефоне. */
export const BLUEPRINT_SPOT: Record<'desktop' | 'mobile', Spot> = {
  desktop: { x: 0.154, y: 0, d: 0.11 },
  mobile: { x: 0, y: -0.1, d: 0.4 },
};

/** Центр, куда чертёж приезжает к концу blueprint и где стоит слово в wordmark. */
export const WORD_CENTER: Record<'desktop' | 'mobile', { x: number; y: number }> = {
  desktop: { x: 0, y: 0.02 },
  mobile: { x: 0, y: 0 },
};

/** Ширина слова «АФИША» в долях ширины окна. */
export const WORD_WIDTH: Record<'desktop' | 'mobile', number> = { desktop: 0.92, mobile: 0.94 };

/** Во сколько раз слово сжимается к концу wordmark: 92 % W становятся 8,4 % W. */
export const WORD_SHRINK = 0.0913;

/** Отношение внутреннего контура жетона к внешнему (ободок). */
export const RIM_RATIO = 0.888;

/** Жетон в сцене filters: вид сверху, затем вид под углом. */
export const FILTERS_TOKEN: Record<'desktop' | 'mobile', { top: Spot; angle: Spot; lift: number }> = {
  desktop: { top: { x: 0, y: 0.02, d: 0.224 }, angle: { x: 0.006, y: 0.14, d: 0.14 }, lift: 0.07 },
  mobile: { top: { x: 0, y: 0, d: 0.5 }, angle: { x: 0, y: 0.23, d: 0.5 }, lift: 0.045 },
};

/** Наклон лежащего жетона при виде под углом, радианы. */
export const FILTERS_TILT = -1.0;
/**
 * Два оборота вокруг горизонтальной оси, пока жетон в воздухе. В оригинале полтора (объект ложится
 * другой стороной вверх). У жетона на обороте надпись: после полутора оборотов она легла бы вверх ногами,
 * поэтому жетон делает целое число оборотов и ложится лицом вверх.
 */
export const FILTERS_TURNS = 2;
export const FILTERS_FLIP = -FILTERS_TURNS * 2 * Math.PI;

/** Пороги сцены filters (доли прогресса), общие для позы жетона и вёрстки. */
export const FILTERS_T = {
  tilt: [0.27, 0.4],
  lift: [0.33, 0.42],
  flip: [0.4, 0.87],
  land: [0.89, 0.97],
} as const;

export function spotFor<D, M>(pair: { readonly desktop: D; readonly mobile: M }, mobile: boolean): D | M {
  return mobile ? pair.mobile : pair.desktop;
}
