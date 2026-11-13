// Геометрические помощники: команды пути, дуги и параметрические кривые в кубических Безье.
export const DEG = Math.PI / 180;

export const num = (n, digits = 2) => {
  const k = 10 ** digits;
  const v = Math.round(n * k) / k;
  return (Object.is(v, -0) ? 0 : v).toString();
};

const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const mul = (a, s) => [a[0] * s, a[1] * s];
const len = (a) => Math.hypot(a[0], a[1]);
const unit = (a) => mul(a, 1 / len(a));
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
export const V = { add, sub, mul, len, unit, cross };

// Команда: { t: 'M'|'L'|'C'|'Q'|'Z', p: [[x,y], ...] }
export const M = (p) => ({ t: 'M', p: [p] });
export const L = (p) => ({ t: 'L', p: [p] });
export const C = (c1, c2, p) => ({ t: 'C', p: [c1, c2, p] });
export const Q = (c, p) => ({ t: 'Q', p: [c, p] });
export const Z = () => ({ t: 'Z', p: [] });

// Дуга окружности в кубических Безье, куски не длиннее 90 градусов.
export function arc(center, r, a0, a1) {
  const n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 2) - 1e-9));
  const da = (a1 - a0) / n;
  const k = (4 / 3) * Math.tan(da / 4);
  const out = [];
  for (let i = 0; i < n; i++) {
    const s = a0 + i * da;
    const e = s + da;
    const p0 = [center[0] + r * Math.cos(s), center[1] + r * Math.sin(s)];
    const p3 = [center[0] + r * Math.cos(e), center[1] + r * Math.sin(e)];
    const c1 = [p0[0] - k * r * Math.sin(s), p0[1] + k * r * Math.cos(s)];
    const c2 = [p3[0] + k * r * Math.sin(e), p3[1] - k * r * Math.cos(e)];
    out.push(C(c1, c2, p3));
  }
  return out;
}

export const onCircle = (center, r, a) => [center[0] + r * Math.cos(a), center[1] + r * Math.sin(a)];

// Параметрическая кривая P(t) с производной dP(t): эрмитова подгонка кубиками.
export function curve(P, dP, t0, t1, n) {
  const h = (t1 - t0) / n;
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = t0 + i * h;
    const b = a + h;
    out.push(C(add(P(a), mul(dP(a), h / 3)), sub(P(b), mul(dP(b), h / 3)), P(b)));
  }
  return out;
}

export const tfCmds = (cmds, fn) => cmds.map((c) => ({ t: c.t, p: c.p.map(fn) }));

export const affine = (a, b, c, d, e, f) => (p) => [a * p[0] + c * p[1] + e, b * p[0] + d * p[1] + f];
export const translate = (tx, ty) => affine(1, 0, 0, 1, tx, ty);
export const scale = (sx, sy = sx) => affine(sx, 0, 0, sy, 0, 0);
export const rotate = (ang, cx = 0, cy = 0) => {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return (p) => {
    const x = p[0] - cx;
    const y = p[1] - cy;
    return [cx + c * x - s * y, cy + s * x + c * y];
  };
};
export const compose = (...fns) => (p) => fns.reduce((q, fn) => fn(q), p);

export function toD(cmds, digits = 2) {
  let out = '';
  for (const c of cmds) {
    if (c.t === 'Z') {
      out += 'Z';
      continue;
    }
    out += c.t + c.p.map((p) => `${num(p[0], digits)} ${num(p[1], digits)}`).join(' ');
  }
  return out;
}

// Габариты по опорным точкам (для кубиков это оценка сверху, нам достаточно).
export function bbox(cmds) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const c of cmds) {
    for (const p of c.p) {
      x0 = Math.min(x0, p[0]);
      y0 = Math.min(y0, p[1]);
      x1 = Math.max(x1, p[0]);
      y1 = Math.max(y1, p[1]);
    }
  }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}
