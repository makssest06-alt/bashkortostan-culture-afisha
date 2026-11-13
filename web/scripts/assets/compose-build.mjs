// Временные замены сцен, которые должен был нарисовать fal.ai (ключ отвечает 403: баланс исчерпан).
// Собираются из фотографий Pexels средствами ImageMagick: тонирование, кадр, коллаж.
//
//   NODE_USE_ENV_PROXY=1 node --env-file=.env.assets scripts/assets/compose-build.mjs [desk|desk-angle|hand|macro|texture ...]
//
// Сведения об исходниках пишутся в compose-meta.json (по ним собирается манифест).
// Когда fal заработает, эти файлы заменяются командой fal-generate.mjs promote.

import { join } from 'node:path';
import { HERE, WORK_DIR, averageColor, ensureDir, fail, http, imageSize, log, magick, publicPathToFile, readJson, warnProxy, writeJson } from './lib.mjs';
import { fetchOriginal } from './pexels-build.mjs';

const META_FILE = join(HERE, 'compose-meta.json');
const TMP = ensureDir(join(WORK_DIR, 'compose'));
const W = 2000;
const H = 1125;

const SOURCES = {
  wood: 37225886,
  felt: 15429341,
  darkFelt: 16659340,
  copper: 19226249,
  bokeh: 19969569,
  hand: 12506706,
  cymbal: 4232245,
};

const TARGETS = {
  desk: {
    path: '/images/scenes/desk.webp',
    uses: ['wood', 'felt'],
    alt_ru: 'Стол зрителя, вид сверху: тёмно-зелёное сукно на тёплой деревянной столешнице, программки, билеты и карандаш',
    note: 'коллаж: дерево и сукно из фотографий, бумага и карандаш нарисованы; бинокля нет',
  },
  'desk-angle': {
    path: '/images/scenes/desk-angle.webp',
    uses: ['wood', 'felt', 'bokeh'],
    alt_ru: 'Стол зрителя под углом: зелёное сукно на дереве, тёплые огни в расфокусе на заднем плане',
    note: 'коллаж: тот же стол в перспективе, фон из фотографии с боке',
  },
  hand: {
    path: '/images/scenes/hand.webp',
    uses: ['hand'],
    alt_ru: 'Тёмная рука, поднятая снизу, с пальцами, готовыми держать жетон, в оранжевом свете на чёрном фоне',
    note: 'фотография руки, переведённая в тёмно-медную гамму',
  },
  macro: {
    path: '/images/scenes/macro.webp',
    uses: ['cymbal'],
    alt_ru: 'Крупный план кромки чеканного диска медного оттенка, малая глубина резкости',
    note: 'кадр из фотографии чеканного диска, затемнён; зелёного сукна в кадре нет',
  },
  texture: {
    path: '/images/scenes/texture.webp',
    uses: ['darkFelt', 'cymbal'],
    alt_ru: 'Фактура крупным планом: тёмный войлок поверх тёплой чеканной меди',
    note: 'коллаж из двух фотографий фактур',
  },
};

const cacheFile = (name) => join(TMP, name);

/** Кэш кандидатов из поиска плюс запрос к Pexels, если фотографии там нет. */
function loadSearchCache() {
  const known = {};
  for (const group of ['wood', 'mat', 'texture', 'bokeh', 'hand', 'macro', 'desk', 'deskangle']) {
    Object.assign(known, readJson(join(WORK_DIR, 'pexels', group, 'candidates.json'), {}));
  }
  return known;
}

async function entryFor(id, cache) {
  if (cache[id]) return cache[id];
  const key = process.env.PEXELS_KEY;
  if (!key) throw new Error(`фото ${id} нет в кэше поиска, а PEXELS_KEY не задан`);
  const response = await http(`https://api.pexels.com/v1/photos/${id}`, { headers: { Authorization: key } });
  if (!response.ok || !response.json) throw new Error(`Pexels HTTP ${response.status}: ${response.text}`);
  const p = response.json;
  return { id: p.id, width: p.width, height: p.height, author: p.photographer, author_url: p.photographer_url, source_url: p.url, original: p.src?.original };
}

function webp(src, dest, quality = 80) {
  ensureDir(join(dest, '..'));
  magick([src, '-colorspace', 'sRGB', '-strip', '-quality', String(quality), '-define', 'webp:method=6', dest]);
}

/** Плоский стол без виньетки: дерево, сукно, бумага, карандаш. Размер size x size*9/16. */
function buildDeskBase(raw, out, { w = W, h = H } = {}) {
  const s = w / 2000;
  const px = (v) => Math.round(v * s);
  const wood = cacheFile('wood.png');
  magick([raw.wood, '-auto-orient', '-resize', `${w}x${h}^`, '-gravity', 'center', '-extent', `${w}x${h}`, '-modulate', '84,86,97', '-sigmoidal-contrast', '3x50%', wood]);

  // Сукно: бирюзовый войлок уводим в тёмный лесной зелёный.
  const mw = px(1420);
  const mh = px(1010);
  const felt = cacheFile('felt.png');
  magick([raw.felt, '-auto-orient', '-resize', `${mw}x${mh}^`, '-gravity', 'center', '-extent', `${mw}x${mh}`, '-modulate', '48,72,84', '-sigmoidal-contrast', '3x45%', felt]);
  const mat = cacheFile('mat.png');
  magick([
    felt,
    '(', '-size', `${mw}x${mh}`, 'xc:black', '-fill', 'white', '-draw', `roundrectangle 0,0 ${mw - 1},${mh - 1} ${px(34)},${px(34)}`, ')',
    '-alpha', 'off', '-compose', 'CopyOpacity', '-composite',
    '-background', 'none', '-rotate', '-1.6',
    mat,
  ]);
  const matShadow = cacheFile('mat-shadow.png');
  magick([mat, '(', '+clone', '-background', 'black', '-shadow', `55x${px(14)}+${px(10)}+${px(16)}`, ')', '+swap', '-background', 'none', '-layers', 'merge', '+repage', matShadow]);

  // Бумага без единой буквы: две программки и три билета с линией отрыва.
  const paper = (name, pw, ph, color, rotate, extra = []) => {
    const file = cacheFile(`${name}.png`);
    magick([
      '-size', `${px(pw)}x${px(ph)}`, `xc:${color}`,
      '-attenuate', '0.12', '+noise', 'Gaussian',
      ...extra,
      '-background', 'none', '-rotate', String(rotate),
      '(', '+clone', '-background', 'black', '-shadow', `50x${px(7)}+${px(5)}+${px(8)}`, ')', '+swap', '-background', 'none', '-layers', 'merge', '+repage',
      file,
    ]);
    return file;
  };
  const stub = (pw, ph) => ['-stroke', '#00000030', '-strokewidth', String(Math.max(1, px(2))), '-fill', 'none', '-draw', `stroke-dasharray ${px(5)} ${px(7)} line ${px(pw * 0.74)},0 ${px(pw * 0.74)},${px(ph)}`];
  const booklet1 = paper('booklet1', 330, 460, '#EFE5D0', -7);
  const booklet2 = paper('booklet2', 330, 460, '#E6D9BF', 4, ['-fill', '#B8623A', '-draw', `rectangle 0,0 ${px(330)},${px(18)}`]);
  const ticket1 = paper('ticket1', 300, 122, '#A8442E', -14, stub(300, 122));
  const ticket2 = paper('ticket2', 300, 122, '#EADFC8', 9, stub(300, 122));
  const ticket3 = paper('ticket3', 300, 122, '#D9C59A', -3, stub(300, 122));

  // Карандаш: кедровый корпус, заточенный конус, графит.
  const pl = px(560);
  const pt = px(30);
  const pencil = cacheFile('pencil.png');
  const tip = pl - px(80);
  magick([
    '-size', `${pl}x${pt}`, 'xc:none',
    '-fill', '#C99A5B', '-draw', `rectangle 0,0 ${tip},${pt}`,
    '-fill', '#E2BC84', '-draw', `rectangle 0,0 ${tip},${Math.round(pt * 0.34)}`,
    '-fill', '#A9773F', '-draw', `rectangle 0,${Math.round(pt * 0.68)} ${tip},${pt}`,
    '-fill', '#E9D2AE', '-draw', `polygon ${tip},0 ${pl - px(18)},${Math.round(pt * 0.38)} ${pl - px(18)},${Math.round(pt * 0.62)} ${tip},${pt}`,
    '-fill', '#2B2622', '-draw', `polygon ${pl - px(20)},${Math.round(pt * 0.36)} ${pl - 1},${Math.round(pt * 0.5)} ${pl - px(20)},${Math.round(pt * 0.64)}`,
    '-background', 'none', '-rotate', '62',
    '(', '+clone', '-background', 'black', '-shadow', `55x${px(6)}+${px(8)}+${px(10)}`, ')', '+swap', '-background', 'none', '-layers', 'merge', '+repage',
    pencil,
  ]);

  const at = (file, x, y) => [file, '-gravity', 'NorthWest', '-geometry', `+${px(x)}+${px(y)}`, '-compose', 'Over', '-composite'];
  magick([
    wood,
    ...at(matShadow, 640, 28),
    ...at(booklet2, 150, 560),
    ...at(booklet1, 60, 500),
    ...at(ticket3, 300, 250),
    ...at(ticket2, 250, 300),
    ...at(ticket1, 130, 330),
    ...at(pencil, 1560, 20),
    out,
  ]);
}

/** Мягкий дневной свет слева сверху и лёгкая виньетка. */
function daylight(src, out) {
  const { width, height } = imageSize(src);
  magick([
    src,
    '(', '-size', `${width}x${height}`, 'radial-gradient:#C9BFB0-#5F574F', '-distort', 'SRT', `${width / 2},${height / 2} 1.6 0 ${width * 0.22},${height * 0.18}`, ')',
    '-compose', 'SoftLight', '-composite',
    '(', '-size', `${width}x${height}`, 'radial-gradient:white-#A0A0A0', ')', '-compose', 'Multiply', '-composite',
    out,
  ]);
}

const builders = {
  desk(raw, dest) {
    const base = cacheFile('desk-base.png');
    buildDeskBase(raw, base);
    const lit = cacheFile('desk-lit.png');
    daylight(base, lit);
    webp(lit, dest);
  },

  'desk-angle'(raw, dest) {
    // Тот же стол, но крупнее кадра, чтобы после перспективы края не оголялись.
    const bw = 3000;
    const bh = Math.round((bw * 9) / 16);
    const base = cacheFile('desk-base-wide.png');
    buildDeskBase(raw, base, { w: bw, h: bh });
    const persp = cacheFile('desk-persp.png');
    const horizon = Math.round(H * 0.36);
    magick([
      base, '-alpha', 'set', '-virtual-pixel', 'transparent',
      '-distort', 'Perspective',
      `0,0 ${W * 0.16},${horizon}  ${bw},0 ${W * 0.84},${horizon}  ${bw},${bh} ${W * 1.42},${H * 1.16}  0,${bh} ${-W * 0.42},${H * 1.16}`,
      '-crop', `${W}x${H}+0+0`, '+repage', persp,
    ]);
    const back = cacheFile('bokeh.png');
    magick([raw.bokeh, '-auto-orient', '-resize', `${W}x${H}^`, '-gravity', 'north', '-extent', `${W}x${H}`, '-blur', '0x14', '-modulate', '70,105,100', back]);
    const flat = cacheFile('desk-angle-flat.png');
    magick([back, persp, '-compose', 'Over', '-composite', flat]);
    // Малая глубина резкости: резкая полоса в центре, размытие к дальнему и ближнему краю.
    const mask = cacheFile('dof-mask.png');
    magick(['-size', `${W}x${H}`, 'gradient:', '-function', 'Polynomial', '9,-11.5,3.75', '-evaluate', 'max', '0', '-evaluate', 'min', '1', '-blur', '0x30', mask]);
    const out = cacheFile('desk-angle.png');
    magick([flat, '(', flat, '-blur', '0x11', ')', mask, '-compose', 'Over', '-composite', out]);
    const lit = cacheFile('desk-angle-lit.png');
    daylight(out, lit);
    webp(lit, dest);
  },

  hand(raw, dest) {
    // Цветные гели исходника сводим в яркость и раскладываем на «тёмный материал + оранжевый контур».
    const clut = cacheFile('hand-clut.png');
    magick(['-size', '1x1', 'xc:#000000', 'xc:#150A05', 'xc:#3D1B0C', 'xc:#9C4416', 'xc:#F58432', 'xc:#FFCF9E', '+append', '-filter', 'Triangle', '-resize', '256x1!', clut]);
    magick([
      raw.hand, '-auto-orient', '-gravity', 'south', '-crop', '3:4', '+repage', '-resize', '1500x2000^', '-gravity', 'south', '-extent', '1500x2000',
      // Яркость берём как максимум каналов: по обычной яркости красный и синий гель почти чёрные.
      '-colorspace', 'HSB', '-channel', 'B', '-separate', '+channel', '-level', '6%,96%', '-gamma', '1.1', '-colorspace', 'sRGB', '-type', 'TrueColor',
      clut, '-clut',
      '-strip', '-quality', '82', '-define', 'webp:method=6', dest,
    ]);
  },

  macro(raw, dest) {
    magick([
      raw.cymbal, '-auto-orient', '-crop', '1600x900+0+560', '+repage', '-resize', `${W}x${H}`,
      '-modulate', '82,105,100', '-sigmoidal-contrast', '4x50%',
      '(', '-size', `${W}x${H}`, 'gradient:#2A2420-#F2F2F2', ')', '-compose', 'Multiply', '-composite',
      '-colorspace', 'sRGB', '-strip', '-quality', '82', '-define', 'webp:method=6', dest,
    ]);
  },

  texture(raw, dest) {
    const tw = 2000;
    const th = 857;
    const felt = cacheFile('tex-felt.png');
    magick([raw.darkFelt, '-auto-orient', '-resize', `${tw}x${th}^`, '-gravity', 'center', '-extent', `${tw}x${th}`, '-modulate', '70,90,100', '-sigmoidal-contrast', '5x40%', felt]);
    // Медь: нижняя часть чеканного диска, где видны следы молотка.
    const copper = cacheFile('tex-copper.png');
    magick([raw.cymbal, '-auto-orient', '-crop', '1900x814+0+1052', '+repage', '-resize', `${tw}x${th}!`, '-modulate', '92,112,100', '-sigmoidal-contrast', '4x45%', copper]);
    // Войлок лежит поверх меди: кромка идёт наискось и слегка ворсится.
    const mask = cacheFile('tex-mask.png');
    magick([
      '-size', `${tw}x${th}`, 'xc:white', '-fill', 'black', '-draw', `polygon 0,0 ${tw},0 ${tw},${th * 0.34} 0,${th * 0.56}`,
      '(', felt, '-colorspace', 'Gray', '-blur', '0x3', '-normalize', ')',
      '-compose', 'Displace', '-define', 'compose:args=0x14', '-composite',
      '-blur', '0x1.2', '-level', '30%,70%', mask,
    ]);
    const shadow = cacheFile('tex-shadow.png');
    magick([mask, '-blur', '0x22', '-level', '0%,60%', '-roll', '+0+26', shadow]);
    magick([
      felt, '(', copper, shadow, '-compose', 'Multiply', '-composite', ')', mask, '-compose', 'Over', '-composite',
      '-colorspace', 'sRGB', '-strip', '-quality', '82', '-define', 'webp:method=6', dest,
    ]);
  },
};

const requested = process.argv.slice(2);
const names = requested.length > 0 ? requested : Object.keys(TARGETS);
for (const name of names) if (!TARGETS[name]) fail(`неизвестная цель "${name}". Есть: ${Object.keys(TARGETS).join(', ')}`);

warnProxy();
const cache = loadSearchCache();
const meta = readJson(META_FILE, {});
const problems = [];

for (const name of names) {
  const target = TARGETS[name];
  try {
    const raw = {};
    const sources = [];
    for (const use of target.uses) {
      const entry = await entryFor(SOURCES[use], cache);
      raw[use] = await fetchOriginal(entry);
      sources.push({ id: entry.id, author: entry.author, author_url: entry.author_url, source_url: entry.source_url });
    }
    const dest = publicPathToFile(target.path);
    builders[name](raw, dest);
    const size = imageSize(dest);
    meta[target.path] = { sources, alt_ru: target.alt_ru, note: target.note };
    log(`${target.path}  ${size.width}x${size.height}  ${averageColor(dest)}`);
  } catch (error) {
    problems.push(`${target.path}: ${error.message.slice(0, 900)}`);
  }
}

writeJson(META_FILE, meta);
if (problems.length > 0) {
  for (const problem of problems) log(`ПРОБЛЕМА: ${problem}`);
  process.exit(1);
}
