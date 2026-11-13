// Сборка отобранных фотографий Pexels в готовые webp.
//
//   NODE_USE_ENV_PROXY=1 node --env-file=.env.assets scripts/assets/pexels-build.mjs [--force] [путь ...]
//
// Источник правды: pexels-selection.json (что, откуда, куда, с каким кадрированием).
// Сведения об авторах пишутся в pexels-meta.json: по нему собирается манифест
// даже без рабочего каталога. Ключ нужен только если фотографии нет в кэше поиска.

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { HERE, WORK_DIR, averageColor, download, ensureDir, fail, http, imageSize, log, publicPathToFile, readJson, toWebp, warnProxy, writeJson } from './lib.mjs';

const SELECTION_FILE = join(HERE, 'pexels-selection.json');
const META_FILE = join(HERE, 'pexels-meta.json');
const args = process.argv.slice(2);
const force = args.includes('--force');
const only = args.filter((arg) => arg.startsWith('/images/'));

const selection = readJson(SELECTION_FILE, null);
if (!selection) fail('нет pexels-selection.json');
warnProxy();

/** Кэш кандидатов, собранный pexels-search.mjs. */
function loadSearchCache() {
  const root = join(WORK_DIR, 'pexels');
  const known = {};
  if (!existsSync(root)) return known;
  for (const group of readdirSync(root)) {
    const file = join(root, group, 'candidates.json');
    if (existsSync(file)) Object.assign(known, readJson(file, {}));
  }
  return known;
}

async function fetchPhoto(id) {
  const key = process.env.PEXELS_KEY;
  if (!key) throw new Error(`фото ${id} нет в кэше поиска, а PEXELS_KEY не задан`);
  const response = await http(`https://api.pexels.com/v1/photos/${id}`, { headers: { Authorization: key } });
  if (!response.ok || !response.json) throw new Error(`Pexels HTTP ${response.status}: ${response.text}`);
  const photo = response.json;
  return {
    id: photo.id,
    width: photo.width,
    height: photo.height,
    author: photo.photographer,
    author_url: photo.photographer_url,
    source_url: photo.url,
    alt: photo.alt || '',
    original: photo.src?.original,
  };
}

/** Исходник берём не больше нужного: сервер Pexels умеет отдавать уменьшенную копию. */
export function sourceUrl(original, maxSide = 2800) {
  const url = new URL(original);
  url.searchParams.set('auto', 'compress');
  url.searchParams.set('cs', 'tinysrgb');
  url.searchParams.set('fit', 'max');
  url.searchParams.set('w', String(maxSide));
  url.searchParams.set('h', String(maxSide));
  return url.toString();
}

export async function fetchOriginal(entry) {
  const dir = ensureDir(join(WORK_DIR, 'pexels', '_original'));
  const file = join(dir, `${entry.id}.jpg`);
  if (!existsSync(file)) await download(sourceUrl(entry.original), file);
  return file;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cache = loadSearchCache();
  const meta = readJson(META_FILE, {});
  let built = 0;
  const problems = [];

  for (const item of selection.items) {
    if (only.length > 0 && !only.includes(item.path)) continue;
    const preset = selection.defaults[item.kind];
    if (!preset) fail(`${item.path}: неизвестный вид "${item.kind}"`);
    const aspect = item.aspect || preset.aspect;
    const longSide = item.long_side || preset.long_side;
    const dest = publicPathToFile(item.path);

    try {
      const entry = cache[item.id] || (await fetchPhoto(item.id));
      if (force || !existsSync(dest) || meta[item.path]?.id !== item.id || meta[item.path]?.gravity !== (item.gravity || 'center')) {
        const raw = await fetchOriginal(entry);
        toWebp({ src: raw, dest, aspect, longSide, gravity: item.gravity || 'center' });
        built += 1;
      }
      const size = imageSize(dest);
      if (Math.max(size.width, size.height) < longSide) problems.push(`${item.path}: исходник мал, вышло ${size.width}x${size.height} вместо длинной стороны ${longSide}`);
      meta[item.path] = {
        id: item.id,
        author: entry.author,
        author_url: entry.author_url,
        source_url: entry.source_url,
        source_width: entry.width,
        source_height: entry.height,
        gravity: item.gravity || 'center',
      };
      log(`${item.path}  ${size.width}x${size.height}  ${averageColor(dest)}  ${entry.author}`);
    } catch (error) {
      problems.push(`${item.path}: ${error.message}`);
    }
  }

  writeJson(META_FILE, meta);
  log(`Пересобрано: ${built}. Записей в pexels-meta.json: ${Object.keys(meta).length}.`);
  if (problems.length > 0) {
    for (const problem of problems) log(`ПРОБЛЕМА: ${problem}`);
    process.exit(1);
  }
}
