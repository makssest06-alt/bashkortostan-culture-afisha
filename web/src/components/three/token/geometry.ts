/**
 * Геометрия жетона: тело вращения по профилю (shape.ts) и линейный каркас для режима чертежа.
 * Создаётся один раз на компонент, освобождается вызывающим (geometry.dispose()).
 */

import { BufferAttribute, BufferGeometry } from 'three';

import { reededRadius, TOKEN, tokenProfile, WALL_TOP } from './shape';

/**
 * Тело жетона одним мешем из двух групп: 0 лицевая половина, 1 оборот.
 * Ряд на экваторе (z = 0) продублирован: у половин разные UV (на обороте U зеркален,
 * чтобы надпись читалась прямо, когда жетон повёрнут оборотом к зрителю вокруг вертикальной оси).
 * UV плоские: u = 0.5 ± x, v = 0.5 - y. Строки карт идут сверху вниз (flipY выключен).
 */
export function buildTokenGeometry(): BufferGeometry {
  const profile = tokenProfile();
  const segments = TOKEN.segments;
  const rows = profile.length;
  const perHalf = 1 + rows * segments;

  const positions = new Float32Array(perHalf * 2 * 3);
  const uvs = new Float32Array(perHalf * 2 * 2);
  const trianglesPerHalf = segments + (rows - 1) * segments * 2;
  const indices = new Uint16Array(trianglesPerHalf * 2 * 3);

  let cursor = 0;
  for (let half = 0; half < 2; half += 1) {
    const side = half === 0 ? 1 : -1;
    const base = half * perHalf;

    // Центр поля.
    positions.set([0, 0, side * TOKEN.fieldZ], base * 3);
    uvs.set([0.5, 0.5], base * 2);

    for (let row = 0; row < rows; row += 1) {
      const point = profile[row];
      for (let column = 0; column < segments; column += 1) {
        const angle = (column / segments) * Math.PI * 2;
        const radius = reededRadius(point.r, point.reed, angle);
        const x = radius * Math.cos(angle);
        const y = radius * Math.sin(angle);
        const vertex = base + 1 + row * segments + column;
        positions[vertex * 3] = x;
        positions[vertex * 3 + 1] = y;
        positions[vertex * 3 + 2] = side * point.z;
        uvs[vertex * 2] = 0.5 + side * x;
        uvs[vertex * 2 + 1] = 0.5 - y;
      }
    }

    // Обход против часовой стрелки, если смотреть снаружи: у оборота порядок вершин обратный.
    const triangle = (a: number, b: number, c: number) => {
      indices[cursor] = a;
      indices[cursor + 1] = side === 1 ? b : c;
      indices[cursor + 2] = side === 1 ? c : b;
      cursor += 3;
    };

    for (let column = 0; column < segments; column += 1) {
      const next = (column + 1) % segments;
      triangle(base, base + 1 + column, base + 1 + next);
    }
    for (let row = 0; row < rows - 1; row += 1) {
      const inner = base + 1 + row * segments;
      const outer = inner + segments;
      for (let column = 0; column < segments; column += 1) {
        const next = (column + 1) % segments;
        triangle(inner + column, outer + column, outer + next);
        triangle(inner + column, outer + next, inner + next);
      }
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  geometry.addGroup(0, trianglesPerHalf * 3, 0);
  geometry.addGroup(trianglesPerHalf * 3, trianglesPerHalf * 3, 1);
  geometry.computeBoundingSphere();
  return geometry;
}

/** Высота линий рельефа над серединой жетона: чуть выше поля, чтобы линии не тонули в теле. */
export const CONTOUR_Z = TOKEN.fieldZ + TOKEN.reliefHeight * 0.6;

/**
 * Контуры формы для чертежа: окружности перегибов профиля на обеих сторонах и риски насечки.
 * Возвращает пары точек для LineSegments (x, y, z подряд).
 */
export function buildOutlineSegments(): Float32Array {
  const { radius, halfThickness, rimCrown, fieldZ, rimFoot, rimInner, rimOuter, reeds } = TOKEN;
  const wallTop = WALL_TOP;
  const shoulder = halfThickness - rimCrown;
  const out: number[] = [];

  const circleSteps = 180;
  const circle = (r: number, z: number) => {
    for (let step = 0; step < circleSteps; step += 1) {
      const a0 = (step / circleSteps) * Math.PI * 2;
      const a1 = ((step + 1) / circleSteps) * Math.PI * 2;
      out.push(r * Math.cos(a0), r * Math.sin(a0), z, r * Math.cos(a1), r * Math.sin(a1), z);
    }
  };

  for (const side of [1, -1]) {
    circle(rimFoot, side * fieldZ);
    circle(rimInner, side * shoulder);
    circle(rimOuter, side * shoulder);
    circle(radius, side * wallTop);
  }

  // Риски насечки: по одной на зубец, на гребне.
  for (let reed = 0; reed < reeds; reed += 1) {
    const angle = (reed / reeds) * Math.PI * 2;
    const x = radius * Math.cos(angle);
    const y = radius * Math.sin(angle);
    out.push(x, y, wallTop - 0.006, x, y, -(wallTop - 0.006));
  }

  return new Float32Array(out);
}

/**
 * Переводит контуры рельефа из координат картинки (u, v в 0..1) в линии на поле жетона.
 * На обороте U зеркален так же, как в UV тела.
 */
export function contoursToSegments(contours: Float32Array, side: 1 | -1): Float32Array {
  const out = new Float32Array((contours.length / 2) * 3);
  for (let i = 0, o = 0; i < contours.length; i += 2, o += 3) {
    out[o] = side * (contours[i] - 0.5);
    out[o + 1] = 0.5 - contours[i + 1];
    out[o + 2] = side * CONTOUR_Z;
  }
  return out;
}
