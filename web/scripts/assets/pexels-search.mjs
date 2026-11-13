// Поиск кандидатов на Pexels и сборка контактного листа для отбора глазами.
//
//   NODE_USE_ENV_PROXY=1 node --env-file=.env.assets scripts/assets/pexels-search.mjs \
//     <группа> <portrait|landscape> "<запрос>" [страница]
//
// В запрос идут только общие слова (ничего о заказчике и проекте).
// Результат: <WORK_DIR>/pexels/<группа>/candidates.json, превью и лист sheet-*.jpg.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { WORK_DIR, download, ensureDir, fail, http, log, magick, readJson, requireKey, warnProxy, writeJson } from './lib.mjs';

const [group, orientation, query, pageArg] = process.argv.slice(2);
if (!group || !['portrait', 'landscape'].includes(orientation) || !query) {
  fail('аргументы: <группа> <portrait|landscape> "<запрос>" [страница]');
}
const page = Number(pageArg || 1);
const PER_PAGE = 20;

warnProxy();
const key = requireKey('PEXELS_KEY');
const dir = ensureDir(join(WORK_DIR, 'pexels', group));
const previewDir = ensureDir(join(dir, 'preview'));
const candidatesFile = join(dir, 'candidates.json');

const url = new URL('https://api.pexels.com/v1/search');
url.searchParams.set('query', query);
url.searchParams.set('orientation', orientation);
url.searchParams.set('per_page', String(PER_PAGE));
url.searchParams.set('page', String(page));

const response = await http(url, { headers: { Authorization: key } });
if (!response.ok || !response.json) fail(`Pexels HTTP ${response.status}: ${response.text}`);

const known = readJson(candidatesFile, {});
const batch = [];
for (const photo of response.json.photos || []) {
  const entry = {
    id: photo.id,
    width: photo.width,
    height: photo.height,
    author: photo.photographer,
    author_url: photo.photographer_url,
    source_url: photo.url,
    alt: photo.alt || '',
    original: photo.src?.original,
    large: photo.src?.large,
    medium: photo.src?.medium,
    query,
  };
  known[photo.id] = known[photo.id] || entry;
  batch.push(entry);
}
writeJson(candidatesFile, known);

const tiles = [];
for (const [index, entry] of batch.entries()) {
  const file = join(previewDir, `${entry.id}.jpg`);
  if (!existsSync(file)) {
    try {
      await download(entry.medium, file);
    } catch (error) {
      log(`  превью ${entry.id} не скачалось: ${error.message}`);
      continue;
    }
  }
  tiles.push({ index: index + 1, entry, file });
}

const slug = query.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const sheet = join(dir, `sheet-${slug}-p${page}.jpg`);
if (tiles.length > 0) {
  const cell = orientation === 'portrait' ? '250x340' : '380x250';
  const columns = orientation === 'portrait' ? 5 : 4;
  // ImageMagick из Homebrew не знает шрифта по умолчанию: подписи рисуем явным файлом шрифта.
  const fonts = ['/System/Library/Fonts/Supplemental/Arial.ttf', '/System/Library/Fonts/Helvetica.ttc', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'];
  const font = fonts.find((candidate) => existsSync(candidate));
  const args = ['montage'];
  if (font) args.push('-font', font);
  for (const tile of tiles) args.push(...(font ? ['-label', `${tile.index}: ${tile.entry.id}`] : []), tile.file);
  args.push('-tile', `${columns}x`, '-geometry', `${cell}+6+6`, '-background', '#141210', '-fill', '#f2e9dc', '-pointsize', '18', '-quality', '82', sheet);
  magick(args);
}

log(`Запрос "${query}" (${orientation}, стр. ${page}): всего по запросу ${response.json.total_results}, получено ${batch.length}`);
for (const tile of tiles) {
  log(`${String(tile.index).padStart(2)}  ${tile.entry.id}  ${tile.entry.width}x${tile.entry.height}  ${tile.entry.author}  |  ${tile.entry.alt.slice(0, 110)}`);
}
log(`ЛИСТ: ${sheet}`);
