/**
 * Форма жетона-тәңкә: размеры и профиль вращения.
 * Все числа в долях диаметра: диаметр жетона ровно 1, центр в начале координат, лицо смотрит в +Z.
 *
 * Карта высот (public/ornament/token-height*.png, 1024 px) ложится на жетон один к одному:
 * край картинки это край жетона, поле кончается на радиусе 466 px = 0.455, дальше бортик.
 * Бортик, фаска и гурт сделаны геометрией, мелкий рельеф (кускар, курай, надпись) картой нормалей.
 */

export const TOKEN = {
  /** Внешний радиус по гребням насечки. */
  radius: 0.5,
  /** Половина толщины по бортику. */
  halfThickness: 0.043,
  /** Уровень поля (дно чеканки) над серединой жетона: поле утоплено под бортик на 0.014. */
  fieldZ: 0.029,
  /** Подножие внутреннего склона бортика. */
  rimFoot: 0.4525,
  /** Начало и конец плоской вершины бортика. */
  rimInner: 0.4665,
  rimOuter: 0.4865,
  /** Радиус скругления внешней фаски. */
  bevel: 0.0135,
  /** Выпуклость вершины бортика: по ней блик идёт поперёк бортика, а не вспыхивает разом. */
  rimCrown: 0.0014,
  /** Насечка гурта: число зубцов и глубина канавки. */
  reeds: 90,
  reedDepth: 0.0036,
  /** Высота чеканного рельефа над полем: из неё считается наклон в карте нормалей. */
  reliefHeight: 0.007,
  /** Сегментов по окружности: по 4 на зубец насечки. */
  segments: 360,
} as const;

export type ProfilePoint = {
  /** Радиус. */
  r: number;
  /** Высота над серединой жетона (для лицевой половины; оборот зеркален). */
  z: number;
  /** Доля глубины насечки в этой точке: 0 на фаске, 1 на гурте. */
  reed: number;
};

function smoothstep01(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * Профиль лицевой половины от центра к экватору (z = 0), без самой центральной точки.
 * Опорные ряды рядом с перегибами держат плоскости плоскими при сглаженных нормалях.
 */
export function tokenProfile(): ProfilePoint[] {
  const { fieldZ, halfThickness, rimFoot, rimInner, rimOuter, bevel, rimCrown, radius } = TOKEN;
  const points: ProfilePoint[] = [];
  const push = (r: number, z: number, reed = 0) => points.push({ r, z, reed });
  const shoulder = halfThickness - rimCrown;

  // Поле: плоское дно чеканки.
  push(0.2, fieldZ);
  push(0.36, fieldZ);
  push(0.44, fieldZ);
  push(rimFoot - 0.003, fieldZ);

  // Внутренний склон бортика: S-образный, без острых рёбер (чеканка, а не токарка).
  const slopeSteps = 8;
  for (let step = 0; step <= slopeSteps; step += 1) {
    const t = step / slopeSteps;
    push(rimFoot + (rimInner - rimFoot) * t, fieldZ + (shoulder - fieldZ) * smoothstep01(t));
  }

  // Вершина бортика: пологая дуга с максимумом посередине.
  const crownSteps = 6;
  for (let step = 1; step <= crownSteps; step += 1) {
    const t = step / crownSteps;
    push(rimInner + (rimOuter - rimInner) * t, halfThickness - rimCrown * (2 * t - 1) ** 2);
  }

  // Внешняя фаска: четверть окружности, по ней бежит блик.
  const bevelSteps = 6;
  for (let step = 1; step <= bevelSteps; step += 1) {
    const angle = (step / bevelSteps) * (Math.PI / 2);
    push(rimOuter + bevel * Math.sin(angle), shoulder - bevel + bevel * Math.cos(angle));
  }

  // Гурт: насечка набирает глубину сразу под фаской и идёт до середины.
  const wallTop = shoulder - bevel;
  push(radius, wallTop - 0.006, 1);
  push(radius, wallTop * 0.4, 1);
  push(radius, 0, 1);

  return points;
}

/** Высота верхней кромки гурта (низ фаски) над серединой жетона. */
export const WALL_TOP = TOKEN.halfThickness - TOKEN.rimCrown - TOKEN.bevel;

/** Радиус точки гурта с учётом насечки: гребень на полном радиусе, канавка глубже на reedDepth. */
export function reededRadius(r: number, reed: number, angle: number): number {
  if (reed === 0) return r;
  return r - TOKEN.reedDepth * reed * (0.5 - 0.5 * Math.cos(TOKEN.reeds * angle));
}
