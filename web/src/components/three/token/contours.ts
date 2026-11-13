/**
 * Контуры уровня по сетке высот (marching squares): линии рельефа для режима чертежа.
 * Вход: квадратная сетка size x size, значения 0..1. Выход: отрезки парами точек (u, v в 0..1).
 */

/** Точки на рёбрах клетки: верх, право, низ, лево. Пары рёбер для каждого из 16 случаев. */
const CASES: readonly (readonly number[])[] = [
  [],
  [3, 0],
  [0, 1],
  [3, 1],
  [1, 2],
  [3, 0, 1, 2],
  [0, 2],
  [3, 2],
  [2, 3],
  [2, 0],
  [0, 1, 2, 3],
  [2, 1],
  [1, 3],
  [1, 0],
  [0, 3],
  [],
];

export function marchingSquares(grid: Float32Array, size: number, level: number): Float32Array {
  const out: number[] = [];
  const edgeX = [0, 0, 0, 0];
  const edgeY = [0, 0, 0, 0];
  const cross = (a: number, b: number) => (a === b ? 0.5 : (level - a) / (b - a));

  for (let y = 0; y < size - 1; y += 1) {
    for (let x = 0; x < size - 1; x += 1) {
      const a = grid[y * size + x];
      const b = grid[y * size + x + 1];
      const c = grid[(y + 1) * size + x + 1];
      const d = grid[(y + 1) * size + x];
      const code = (a > level ? 1 : 0) | (b > level ? 2 : 0) | (c > level ? 4 : 0) | (d > level ? 8 : 0);
      const segments = CASES[code];
      if (segments.length === 0) continue;

      edgeX[0] = x + cross(a, b);
      edgeY[0] = y;
      edgeX[1] = x + 1;
      edgeY[1] = y + cross(b, c);
      edgeX[2] = x + cross(d, c);
      edgeY[2] = y + 1;
      edgeX[3] = x;
      edgeY[3] = y + cross(a, d);

      for (let i = 0; i < segments.length; i += 2) {
        const from = segments[i];
        const to = segments[i + 1];
        // Отсчёт сетки стоит в центре своего пикселя: отсюда сдвиг на половину.
        out.push(
          (edgeX[from] + 0.5) / size,
          (edgeY[from] + 0.5) / size,
          (edgeX[to] + 0.5) / size,
          (edgeY[to] + 0.5) / size,
        );
      }
    }
  }
  return new Float32Array(out);
}
