// Построение мотива кускар: парные завитки-рога на общем стволе и ромб над развилкой.
import { DEG, V, M, L, C, Z, curve } from './geo.mjs';

// ---------- КУСКАР ----------
// Единица измерения: толщина линии w = 1. Ось симметрии x = 0, y вниз.
export const KUSKAR_DEFAULT = {
  R0: 3.4, // начальный радиус завитка
  pitch: 2.2, // шаг витка (линия + просвет)
  th0: 200 * DEG, // угол начала завитка (от центра завитка, по часовой на экране)
  sweep: 432 * DEG, // длина завитка
  cx: 4.5, // центр завитка по x
  cy: 0,
  yF: 3.4, // развилка ствола
  yB: 6.2, // основание ствола
  armA: 0.45, // доля длины плеча, идущая вертикально от развилки
  seg: 60 * DEG,
  dY: -2.5, // центр ромба
  dW: 1.15, // полуширина ромба
  dH: 1.55, // полувысота ромба
};

export function kuskarHorn(o) {
  const k = o.pitch / (2 * Math.PI);
  const r = (th) => o.R0 - k * (th - o.th0);
  const P = (th) => [o.cx + r(th) * Math.cos(th), o.cy + r(th) * Math.sin(th)];
  const dP = (th) => [-k * Math.cos(th) - r(th) * Math.sin(th), -k * Math.sin(th) + r(th) * Math.cos(th)];
  const F = [0, o.yF];
  const S = P(o.th0);
  const T = V.unit(dP(o.th0));
  const a = o.armA * V.len(V.sub(S, F));
  const P1 = [F[0], F[1] - a];
  // Совпадение кривизны в точке входа в завиток (G2): кривизна архимедовой спирали.
  const r0 = o.R0;
  const kappa = (r0 * r0 + 2 * k * k) / (r0 * r0 + k * k) ** 1.5;
  const b = Math.sqrt(((2 / 3) * Math.abs(V.cross(V.sub(S, P1), T))) / kappa);
  const P2 = V.sub(S, V.mul(T, b));
  const n = Math.ceil(o.sweep / o.seg);
  return { F, arm: C(P1, P2, S), spiral: curve(P, dP, o.th0, o.th0 + o.sweep, n), end: P(o.th0 + o.sweep) };
}

// Возвращает { line: команды для обводки, diamond: команды для заливки }.
export function kuskarMotif(opts = {}) {
  const o = { ...KUSKAR_DEFAULT, ...opts };
  const h = kuskarHorn(o);
  const mir = (p) => [-p[0], p[1]];
  const right = [M([0, o.yB]), L(h.F), h.arm, ...h.spiral];
  const left = [M(h.F), h.arm, ...h.spiral].map((c) => ({ t: c.t, p: c.p.map(mir) }));
  const diamond = o.dW > 0 ? [M([0, o.dY - o.dH]), L([o.dW, o.dY]), L([0, o.dY + o.dH]), L([-o.dW, o.dY]), Z()] : [];
  // Габариты по осевой линии (без учёта толщины).
  const k = o.pitch / (2 * Math.PI);
  const rr = (th) => o.R0 - k * (th - o.th0);
  const ext = {
    right: o.cx + rr(360 * DEG),
    top: o.cy - rr(270 * DEG),
    bottomSpiral: o.cy + rr(450 * DEG),
    left: o.cx - rr(540 * DEG),
  };
  return { line: [...right, ...left], diamond, o, ext };
}
