// Генератор орнаментов: SVG мотивов, исходники карт высот жетона и paths.ts для компонентов.
//
// Запуск из каталога web:
//   node src/components/ornament/_build/generate.mjs          SVG и paths.ts
//   node src/components/ornament/_build/generate.mjs --png    то же и PNG карт высот (нужны playwright и magick)
//
// Буквы «АФИША» и число 102 переводятся в контуры из шрифта Golos Text (статический срез 700).
// Для этого нужны два пакета, которых нет в зависимостях сайта:
//   fontkit и @fontsource/golos-text@5.3.0
// Их можно поставить куда угодно и указать пути переменными окружения:
//   ORNAMENT_FONTKIT   путь к файлу модуля fontkit (dist/module.mjs)
//   ORNAMENT_FONT_DIR  каталог files пакета @fontsource/golos-text
// Без переменных модуль и шрифт ищутся в node_modules сайта.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DEG, V, M, L, C, Q, Z, arc, toD, tfCmds, compose, scale, translate, rotate, num, affine } from './geo.mjs';
import { kuskarMotif } from './motifs.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(HERE, '../../../..');
const PUB = `${WEB}/public/ornament/`;
const SRC = `${WEB}/src/components/ornament/`;
const FONTS = (process.env.ORNAMENT_FONT_DIR ?? `${WEB}/node_modules/@fontsource/golos-text/files`).replace(/\/?$/, '/');
const fontkit = await import(process.env.ORNAMENT_FONTKIT ? pathToFileURL(process.env.ORNAMENT_FONTKIT).href : 'fontkit');
fs.mkdirSync(PUB, { recursive: true });

const HEAD = (name) => `<!-- ${name}: собственная отрисовка для сайта «Афиша культуры Башкортостана». Файл сгенерирован: src/components/ornament/_build/generate.mjs -->\n`;

// ====================== КУРАЙ ======================
const KURAY = {
  hub: [128, 130],
  hubR: 14, // запасной радиус начала крайних лепестков (перекрывается скруглением)
  forkR: 9, // радиус вогнутого скругления между крайними лепестками и стеблем
  angles: [-96, -64, -32, 0, 32, 64, 96],
  rayHalf: 4.5,
  budR: 14,
  budC: 74,
  filletR: 34,
  stemHalf: 5.5,
  stemLen: 86,
  ringC: [128, 128],
  ringR: 112,
  ringW: 16,
};

function frame(hub, phiDeg) {
  const phi = phiDeg * DEG;
  const d = [Math.sin(phi), -Math.cos(phi)];
  const n = [Math.cos(phi), Math.sin(phi)];
  return {
    pt: (q) => [hub[0] + q[0] * d[0] + q[1] * n[0], hub[1] + q[0] * d[1] + q[1] * n[1]],
    rot: phi - Math.PI / 2,
  };
}

// Замкнутый контур: семь лепестков и стебель. Между соседними лепестками острый вырез,
// между крайними лепестками и стеблем дуга радиуса hubR.
function kurayFlower(o = KURAY) {
  const cmds = [];
  const n = o.angles.length;
  const xf = o.budC - Math.sqrt((o.budR + o.filletR) ** 2 - (o.rayHalf + o.filletR) ** 2);
  const aT = Math.atan2(o.rayHalf + o.filletR, o.budC - xf);
  const rhoHub = (half) => Math.sqrt(o.hubR ** 2 - half ** 2);
  o.angles.forEach((phi, i) => {
    const fr = frame(o.hub, phi);
    const half = o.rayHalf;
    const world = (center, r, a0, a1) => arc(fr.pt(center), r, a0 + fr.rot, a1 + fr.rot);
    const notchPrev = i > 0 ? half / Math.tan(((phi - o.angles[i - 1]) / 2) * DEG) : rhoHub(half);
    const notchNext = i < n - 1 ? half / Math.tan(((o.angles[i + 1] - phi) / 2) * DEG) : rhoHub(half);
    const A = fr.pt([notchPrev, -half]);
    if (i === 0) cmds.push(M(A));
    cmds.push(L(fr.pt([xf, -half])));
    cmds.push(...world([xf, -(half + o.filletR)], o.filletR, Math.PI / 2, aT));
    cmds.push(...world([o.budC, 0], o.budR, aT - Math.PI, Math.PI - aT));
    cmds.push(...world([xf, half + o.filletR], o.filletR, -aT, -Math.PI / 2));
    cmds.push(L(fr.pt([notchNext, half])));
  });
  // вогнутые скругления между крайними лепестками и стеблем (как развилка ветки)
  const fs_ = frame(o.hub, 180);
  const dirOf = (phi) => [Math.sin(phi * DEG), -Math.cos(phi * DEG)];
  const cross2 = (a, b) => a[0] * b[1] - a[1] * b[0];
  // пересечение прямых P + s*d1 и Q + t*d2
  const meet = (P, d1, Q, d2) => {
    const s = cross2(V.sub(Q, P), d2) / cross2(d1, d2);
    return V.add(P, V.mul(d1, s));
  };
  // скругление угла: приходим по первой прямой (к углу), уходим по второй (от угла)
  const fillet = (P, d1, Q, d2, rf) => {
    const corner = meet(P, d1, Q, d2);
    const half = Math.acos(d1[0] * d2[0] + d1[1] * d2[1]) / 2;
    const t = rf / Math.tan(half);
    const T1 = V.add(corner, V.mul(d1, t));
    const T2 = V.add(corner, V.mul(d2, t));
    const center = V.add(corner, V.mul(V.unit(V.add(d1, d2)), rf / Math.sin(half)));
    let a0 = Math.atan2(T1[1] - center[1], T1[0] - center[0]);
    let a1 = Math.atan2(T2[1] - center[1], T2[0] - center[0]);
    while (a1 - a0 > Math.PI) a1 -= 2 * Math.PI;
    while (a1 - a0 < -Math.PI) a1 += 2 * Math.PI;
    return { T1, T2, arc: arc(center, rf, a0, a1) };
  };
  const last = o.angles[n - 1];
  const first = o.angles[0];
  const dStemDir = dirOf(180);
  const f1 = fillet(frame(o.hub, last).pt([0, o.rayHalf]), dirOf(last), fs_.pt([0, -o.stemHalf]), dStemDir, o.forkR);
  // последняя команда лепестка вела в точку на ступице: заменяем её на точку касания
  cmds.pop();
  cmds.push(L(f1.T1), ...f1.arc);
  const xe = o.stemLen - o.stemHalf;
  cmds.push(L(fs_.pt([xe, -o.stemHalf])));
  cmds.push(...arc(fs_.pt([xe, 0]), o.stemHalf, -Math.PI / 2 + fs_.rot, Math.PI / 2 + fs_.rot));
  const f2 = fillet(fs_.pt([0, o.stemHalf]), dStemDir, frame(o.hub, first).pt([0, -o.rayHalf]), dirOf(first), o.forkR);
  cmds.push(L(f2.T1), ...f2.arc);
  // первая команда M стояла в точке на ступице: переносим начало контура в точку касания
  cmds[0] = M(f2.T2);
  cmds.push(Z());
  return cmds;
}

const kurayCmds = kurayFlower();
const KURAY_D = toD(kurayCmds);
const kr = KURAY;
// Кольцо как залитая фигура (две окружности, правило evenodd): без обводок, чистый контур.
const circleD = (c, r) => `M${num(c[0] - r)} ${num(c[1])}a${num(r)} ${num(r)} 0 1 0 ${num(2 * r)} 0a${num(r)} ${num(r)} 0 1 0 ${num(-2 * r)} 0Z`;
const KURAY_RING_D = circleD(kr.ringC, kr.ringR + kr.ringW / 2) + circleD(kr.ringC, kr.ringR - kr.ringW / 2);

fs.writeFileSync(
  `${PUB}kuray.svg`,
  HEAD('kuray.svg') +
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><title>Курай</title><path fill-rule="evenodd" d="${KURAY_RING_D}"/><path d="${KURAY_D}"/></svg>\n`,
);
fs.writeFileSync(
  `${PUB}kuray-line.svg`,
  HEAD('kuray-line.svg') +
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><title>Курай, контур</title><circle cx="128" cy="128" r="${kr.ringR + kr.ringW / 2}"/><circle cx="128" cy="128" r="${kr.ringR - kr.ringW / 2}"/><path d="${KURAY_D}"/></svg>\n`,
);

// ====================== КУСКАР ======================
const UNIT = 8; // толщина линии в единицах viewBox
const MOT = { yB: 5.4 }; // короткий ствол
const m1 = kuskarMotif(MOT);
const HALF = m1.ext.right + 0.5;
const TOP = m1.o.dY - m1.o.dH;
const BOT = m1.o.yB + 0.5;

const strokeAttrs = (w) => `fill="none" stroke="currentColor" stroke-width="${num(w)}" stroke-linecap="round" stroke-linejoin="round"`;
const motifSvg = (W, H, w, line, fill, title) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${num(W)} ${num(H)}" ${strokeAttrs(w)}>${title ? `<title>${title}</title>` : ''}<path d="${toD(line)}"/><path d="${toD(fill)}" fill="currentColor" stroke="none"/></svg>\n`;

// --- одиночный мотив и простой бордюр-ряд: общий раппорт 128 x 96
const ROW = { W: 128, H: 96 };
{
  const tf = compose(translate(ROW.W / UNIT / 2, -TOP + (ROW.H / UNIT - (BOT - TOP)) / 2), scale(UNIT));
  ROW.line = tfCmds(m1.line, tf);
  ROW.fill = tfCmds(m1.diamond, tf);
}
fs.writeFileSync(`${PUB}kuskar-single.svg`, HEAD('kuskar-single.svg') + motifSvg(ROW.W, ROW.H, UNIT, ROW.line, ROW.fill, 'Кускар'));
fs.writeFileSync(`${PUB}kuskar-border-row.svg`, HEAD('kuskar-border-row.svg, раппорт 128 x 96, повторять по горизонтали') + motifSvg(ROW.W, ROW.H, UNIT, ROW.line, ROW.fill));

// --- бордюр «замок»: встречные мотивы, раппорт 140 x 128
const LOCK = { W: 140, H: 128 };
{
  const flipY = (p) => [p[0], -p[1]];
  const Wt = LOCK.W / UNIT;
  const Ht = LOCK.H / UNIT;
  const vgap = 1.1;
  const spBottom = m1.ext.bottomSpiral + 0.5;
  const mid = spBottom + vgap / 2;
  const mm = kuskarMotif({ yB: 2 * mid - TOP - 0.5 });
  const contentH = 2 * mid - 2 * TOP;
  const top = TOP - (Ht - contentH) / 2;
  const up = compose(translate(Wt / 2, -top), scale(UNIT));
  const inv = (dx) => compose(flipY, translate(dx, 2 * mid), translate(Wt / 2, -top), scale(UNIT));
  let line = tfCmds(mm.line, up);
  let fill = tfCmds(mm.diamond, up);
  for (const dx of [-Wt / 2, Wt / 2]) {
    line = line.concat(tfCmds(mm.line, inv(dx)));
    fill = fill.concat(tfCmds(mm.diamond, inv(dx)));
  }
  LOCK.line = line;
  LOCK.fill = fill;
  LOCK.hgap = Wt / 2 - HALF - 0.5;
}
fs.writeFileSync(`${PUB}kuskar-border.svg`, HEAD('kuskar-border.svg, раппорт 140 x 128, повторять по горизонтали') + motifSvg(LOCK.W, LOCK.H, UNIT, LOCK.line, LOCK.fill));

// --- кольцо
function ringGeom({ N, c, rOuter, gap = 1.4 }) {
  const w = (2 * Math.PI * rOuter) / (N * (2 * HALF + gap) + 2 * Math.PI * Math.abs(TOP - m1.o.cy));
  const tf = compose(translate(0, -TOP), scale(w), translate(c, c - rOuter));
  const line = tfCmds(m1.line, tf);
  const fill = tfCmds(m1.diamond, tf);
  const rInner = rOuter - w * (BOT - TOP);
  return { N, c, w, line, fill, rInner, rOuter };
}
const rotAll = (cmds, N, c) => {
  let out = [];
  for (let i = 0; i < N; i++) out = out.concat(tfCmds(cmds, rotate((i * 2 * Math.PI) / N, c, c)));
  return out;
};
const RING = ringGeom({ N: 12, c: 256, rOuter: 244 });
{
  const uses = Array.from({ length: RING.N - 1 }, (_, i) => `<use href="#k" transform="rotate(${num(((i + 1) * 360) / RING.N)} 256 256)"/>`).join('');
  fs.writeFileSync(
    `${PUB}kuskar-ring.svg`,
    HEAD('kuskar-ring.svg, 12 мотивов по окружности') +
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" ${strokeAttrs(RING.w)}><title>Кольцо кускара</title><g id="k"><path d="${toD(RING.line)}"/><path d="${toD(RING.fill)}" fill="currentColor" stroke="none"/></g>${uses}</svg>\n`,
  );
}

// ====================== ШРИФТ: буквы в контуры ======================
function glyphRun(file, text) {
  const font = fontkit.openSync(FONTS + file);
  const run = font.layout(text);
  let x = 0;
  const glyphs = run.glyphs.map((g, i) => {
    const adv = run.positions[i].xAdvance;
    const cmds = g.path.commands.map((cm) => {
      const a = cm.args;
      if (cm.command === 'moveTo') return M([a[0], a[1]]);
      if (cm.command === 'lineTo') return L([a[0], a[1]]);
      if (cm.command === 'quadraticCurveTo') return Q([a[0], a[1]], [a[2], a[3]]);
      if (cm.command === 'bezierCurveTo') return C([a[0], a[1]], [a[2], a[3]], [a[4], a[5]]);
      return Z();
    });
    const out = { cmds, adv, x, bbox: g.bbox };
    x += adv;
    return out;
  });
  return { glyphs, width: x, upm: font.unitsPerEm, cap: font.capHeight };
}

// Текст по дуге: буквы стоят вершинами наружу, центр дуги сверху.
function textOnArc(run, { c, rBase, size, trackEm = 0 }) {
  const s = size / run.upm;
  const capPx = run.cap * s;
  const rMid = rBase + capPx / 2;
  const track = trackEm * size;
  const total = run.width * s + track * (run.glyphs.length - 1);
  let pos = -total / 2;
  let out = [];
  for (const g of run.glyphs) {
    const advPx = g.adv * s;
    const theta = (pos + advPx / 2) / rMid;
    const tf = compose(translate(-g.adv / 2, 0), affine(s, 0, 0, -s, 0, 0), translate(c, c - rBase), rotate(theta, c, c));
    out = out.concat(tfCmds(g.cmds, tf));
    pos += advPx + track;
  }
  return { cmds: out, halfAngle: total / 2 / rMid, capPx };
}

function textCentered(run, { cx, cy, size, trackEm = 0 }) {
  const s = size / run.upm;
  const track = trackEm * size;
  const first = run.glyphs[0];
  const lastG = run.glyphs[run.glyphs.length - 1];
  const inkL = first.x * s + first.bbox.minX * s;
  const inkR = lastG.x * s + track * (run.glyphs.length - 1) + lastG.bbox.maxX * s;
  const capPx = run.cap * s;
  const x0 = cx - (inkL + inkR) / 2;
  const y0 = cy + capPx / 2;
  let out = [];
  run.glyphs.forEach((g, i) => {
    const tf = compose(affine(s, 0, 0, -s, 0, 0), translate(x0 + g.x * s + track * i, y0));
    out = out.concat(tfCmds(g.cmds, tf));
  });
  return { cmds: out, inkW: inkR - inkL, capPx };
}

// ====================== КАРТЫ ВЫСОТ ======================
const S = 1024;
const CC = S / 2;
const LV = { rim: '#ffffff', field: '#2e2e2e', relief: '#e6e6e6', groove: '#0a0a0a' };
const RIM_IN = 466; // внутренний радиус бортика
const RING_OUT = 446; // вершины ромбов кольца кускара
const tokenRing = ringGeom({ N: 12, c: CC, rOuter: RING_OUT });
const INNER_LINE = Math.round(tokenRing.rInner - 14); // тонкий поясок под кольцом

const heightDefs = `<defs><filter id="soft-rim" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="5"/></filter><filter id="soft" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="2.6"/></filter><radialGradient id="dome"><stop offset="0" stop-color="#fff" stop-opacity="1"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>`;
const heightBase =
  `<rect width="${S}" height="${S}" fill="${LV.rim}"/>` +
  `<g filter="url(#soft-rim)"><circle cx="${CC}" cy="${CC}" r="${RIM_IN}" fill="${LV.field}"/></g>` +
  `<g filter="url(#soft)"><circle cx="${CC}" cy="${CC}" r="${RIM_IN - 9}" fill="none" stroke="${LV.groove}" stroke-width="3"/></g>`;
const svgHeight = (title, body) =>
  HEAD(title) + `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}">${heightDefs}${heightBase}${body}</svg>\n`;

// --- лицевая сторона: бортик, кольцо кускара, курай
{
  const k = 3; // масштаб курая из поля 256
  const kTf = compose(translate(-128, -128), scale(k), translate(CC, CC - 4));
  const flower = tfCmds(kurayCmds, kTf);
  const buds = KURAY.angles
    .map((phi) => {
      const p = kTf(frame(KURAY.hub, phi).pt([KURAY.budC, 0]));
      return `<circle cx="${num(p[0])}" cy="${num(p[1])}" r="${num(KURAY.budR * k * 0.92)}" fill="url(#dome)"/>`;
    })
    .join('');
  const ringLine = rotAll(tokenRing.line, tokenRing.N, CC);
  const ringFill = rotAll(tokenRing.fill, tokenRing.N, CC);
  const body =
    `<g filter="url(#soft)">` +
    `<circle cx="${CC}" cy="${CC}" r="${INNER_LINE}" fill="none" stroke="${LV.relief}" stroke-width="7"/>` +
    `<path d="${toD(ringLine)}" fill="none" stroke="${LV.relief}" stroke-width="${num(tokenRing.w)}" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="${toD(ringFill)}" fill="${LV.relief}"/>` +
    `<path d="${toD(flower)}" fill="${LV.relief}"/>` +
    `</g>` +
    `<g filter="url(#soft)" opacity="0.75">${buds}</g>`;
  fs.writeFileSync(`${PUB}token-height.svg`, svgHeight('token-height.svg: карта высот лицевой стороны жетона, белое = выпуклое', body));
}

// --- оборот: бортик, «АФИША» по дуге, 102 в центре, кускар по нижней дуге
{
  const cyr = glyphRun('golos-text-cyrillic-700-normal.woff', 'АФИША');
  const lat = glyphRun('golos-text-latin-700-normal.woff', '102');
  const band = RING_OUT - INNER_LINE; // ширина пояса
  const capTarget = 88;
  const size = (capTarget * cyr.upm) / cyr.cap;
  const rBase = INNER_LINE + (band - capTarget) / 2 + 4;
  const word = textOnArc(cyr, { c: CC, rBase, size, trackEm: 0.22 });
  const number = textCentered(lat, { cx: CC, cy: CC + 2, size: 268, trackEm: 0.02 });
  // мотивы кускара по нижней дуге: позиции 3..9 из двенадцати (от «трёх часов» через низ до «девяти»)
  let line = [];
  let fill = [];
  for (let i = 3; i <= 9; i++) {
    const r = rotate((i * 2 * Math.PI) / 12, CC, CC);
    line = line.concat(tfCmds(tokenRing.line, r));
    fill = fill.concat(tfCmds(tokenRing.fill, r));
  }
  // ромбы-разделители между словом и орнаментом
  const sepAngle = (word.halfAngle + 75 * DEG) / 2;
  const rSep = rBase + word.capPx / 2;
  const dmd = (ang) => {
    const base = [M([CC, CC - rSep - 26]), L([CC + 19, CC - rSep]), L([CC, CC - rSep + 26]), L([CC - 19, CC - rSep]), Z()];
    return tfCmds(base, rotate(ang, CC, CC));
  };
  fill = fill.concat(dmd(sepAngle), dmd(-sepAngle));
  const body =
    `<g filter="url(#soft)">` +
    `<circle cx="${CC}" cy="${CC}" r="${INNER_LINE}" fill="none" stroke="${LV.relief}" stroke-width="7"/>` +
    `<path d="${toD(line)}" fill="none" stroke="${LV.relief}" stroke-width="${num(tokenRing.w)}" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="${toD(fill)}" fill="${LV.relief}"/>` +
    `<path d="${toD(word.cmds)}" fill="${LV.relief}"/>` +
    `<path d="${toD(number.cmds)}" fill="${LV.relief}"/>` +
    `</g>`;
  fs.writeFileSync(`${PUB}token-height-back.svg`, svgHeight('token-height-back.svg: карта высот оборота жетона, белое = выпуклое, надпись читается прямо (не зеркально)', body));
  console.log('back: size', num(size), 'rBase', num(rBase), 'half angle', num(word.halfAngle / DEG), 'number ink width', num(number.inkW), 'cap', num(number.capPx));
}

// ====================== paths.ts ======================
const ts = `// Сгенерировано вместе с файлами public/ornament. Руками не править:\n// менять src/components/ornament/_build/generate.mjs и пересобирать.
// Контуры собственной отрисовки: соцветие курая и мотив кускар.

export const KURAY = {
  viewBox: '0 0 256 256',
  /** Кольцо: две окружности, заливать с fillRule="evenodd". */
  ring: '${KURAY_RING_D}',
  ringOuterR: ${kr.ringR + kr.ringW / 2},
  ringInnerR: ${kr.ringR - kr.ringW / 2},
  /** Семь лепестков и стебель одним замкнутым контуром. */
  flower: '${KURAY_D}',
} as const;

export const KUSKAR_SINGLE = {
  width: ${ROW.W},
  height: ${ROW.H},
  strokeWidth: ${UNIT},
  line: '${toD(ROW.line)}',
  diamond: '${toD(ROW.fill)}',
} as const;

export const KUSKAR_BORDER = {
  /** Встречные мотивы, сцепленные в замок. */
  lock: {
    width: ${LOCK.W},
    height: ${LOCK.H},
    strokeWidth: ${UNIT},
    line: '${toD(LOCK.line)}',
    diamond: '${toD(LOCK.fill)}',
  },
  /** Мотивы в ряд. */
  row: KUSKAR_SINGLE,
} as const;

export const KUSKAR_RING = {
  size: 512,
  count: ${RING.N},
  strokeWidth: ${num(RING.w)},
  /** Один мотив в верхней точке кольца, остальные получаются поворотом вокруг центра. */
  line: '${toD(RING.line)}',
  diamond: '${toD(RING.fill)}',
} as const;
`;
fs.writeFileSync(`${SRC}paths.ts`, ts);

console.log('kuskar: half', num(HALF), 'top', num(TOP), 'bot', num(BOT), 'lock hgap', num(LOCK.hgap));
console.log('ring svg: w', num(RING.w), 'rInner', num(RING.rInner));
console.log('token ring: w', num(tokenRing.w), 'rInner', num(tokenRing.rInner), 'inner line', INNER_LINE);
for (const f of fs.readdirSync(PUB)) console.log(f, fs.statSync(PUB + f).size);

// ====================== PNG карт высот ======================
// Снимок исходника SVG в headless Chromium (нужен из-за фильтра размытия), затем перевод в 8-битные градации серого.
if (process.argv.includes('--png')) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch(process.env.CHROME_EXE ? { executablePath: process.env.CHROME_EXE } : {});
  const page = await browser.newPage({ viewport: { width: S, height: S }, deviceScaleFactor: 1 });
  for (const name of ['token-height', 'token-height-back']) {
    const tmp = `${PUB}${name}.rgba.tmp.png`;
    await page.goto(pathToFileURL(`${PUB}${name}.svg`).href);
    await page.screenshot({ path: tmp });
    execFileSync('magick', [tmp, '-alpha', 'off', '-colorspace', 'Gray', '-depth', '8', '-strip', '-define', 'png:color-type=0', '-define', 'png:compression-level=9', `${PUB}${name}.png`]);
    // временный снимок не удаляем командой удаления: переносим в системную корзину
    fs.renameSync(tmp, `${process.env.HOME}/.Trash/${name}.rgba.${Date.now()}.png`);
    console.log('png', name);
  }
  await browser.close();
}
