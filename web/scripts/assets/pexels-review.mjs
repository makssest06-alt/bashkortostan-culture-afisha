// Крупный лист для второго просмотра отобранных кандидатов (ключ не нужен: берём уже найденные адреса).
//
//   NODE_USE_ENV_PROXY=1 node scripts/assets/pexels-review.mjs <имя листа> <колонок> <id> [<id> ...]
//
// Результат: <WORK_DIR>/pexels/_review/<имя>.jpg

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { WORK_DIR, download, ensureDir, fail, log, magick, readJson, warnProxy } from './lib.mjs';

const [name, columnsArg, ...ids] = process.argv.slice(2);
const columns = Number(columnsArg);
if (!name || !columns || ids.length === 0) fail('аргументы: <имя листа> <колонок> <id> [<id> ...]');

warnProxy();
const root = join(WORK_DIR, 'pexels');
const known = {};
for (const group of readdirSync(root)) {
  const file = join(root, group, 'candidates.json');
  if (existsSync(file)) Object.assign(known, readJson(file, {}));
}

const dir = ensureDir(join(root, '_review'));
const tiles = [];
for (const id of ids) {
  const entry = known[id];
  if (!entry) {
    log(`нет кандидата ${id}`);
    continue;
  }
  const file = join(dir, `${id}.jpg`);
  if (!existsSync(file)) await download(entry.large, file);
  tiles.push({ id, file, entry });
}

const cell = Math.floor(1800 / columns);
const fonts = ['/System/Library/Fonts/Supplemental/Arial.ttf', '/System/Library/Fonts/Helvetica.ttc', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'];
const font = fonts.find((candidate) => existsSync(candidate));
const args = ['montage'];
if (font) args.push('-font', font);
for (const tile of tiles) args.push(...(font ? ['-label', `${tile.id} ${tile.entry.width}x${tile.entry.height}`] : []), tile.file);
const sheet = join(dir, `${name}.jpg`);
args.push('-tile', `${columns}x`, '-geometry', `${cell}x${cell}+8+8`, '-background', '#141210', '-fill', '#f2e9dc', '-pointsize', '22', '-quality', '86', sheet);
magick(args);
log(`ЛИСТ: ${sheet}`);
