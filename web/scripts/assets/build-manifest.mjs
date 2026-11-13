// Сборка public/images/manifest.json из того, что реально лежит на диске.
//
//   node scripts/assets/build-manifest.mjs
//
// Источники сведений: pexels-selection.json + pexels-meta.json (фотографии),
// compose-meta.json (временные коллажи вместо fal), fal-ledger.json + fal-prompts.json (генерации).
// Файл в public/images без записи или запись без файла считаются ошибкой.

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { HERE, PUBLIC_DIR, averageColor, imageSize, log, publicPathToFile, readJson, writeJson } from './lib.mjs';

const selection = readJson(join(HERE, 'pexels-selection.json'), { items: [] });
const pexelsMeta = readJson(join(HERE, 'pexels-meta.json'), {});
const composeMeta = readJson(join(HERE, 'compose-meta.json'), {});
const falConfig = readJson(join(HERE, 'fal-prompts.json'), { items: {} });
const ledger = readJson(join(HERE, 'fal-ledger.json'), { generations: [] });

const records = new Map();

for (const item of selection.items) {
  const meta = pexelsMeta[item.path];
  if (!meta) continue;
  records.set(item.path, { source: 'pexels', author: meta.author, source_url: meta.source_url, alt_ru: item.alt_ru });
}
for (const [path, meta] of Object.entries(composeMeta)) {
  records.set(path, {
    source: 'pexels-composite',
    author: [...new Set(meta.sources.map((s) => s.author))].join(', '),
    source_url: meta.sources[0].source_url,
    sources: meta.sources.map((s) => ({ author: s.author, source_url: s.source_url })),
    placeholder_for: 'fal',
    note: meta.note,
    alt_ru: meta.alt_ru,
  });
}
for (const generation of ledger.generations.filter((g) => g.chosen)) {
  const item = falConfig.items[generation.key];
  if (item) records.set(item.target, { source: 'fal', model: generation.model, alt_ru: item.alt_ru });
}

const onDisk = [];
const walk = (dir, prefix) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) walk(join(dir, entry.name), `${prefix}/${entry.name}`);
    else if (entry.name.endsWith('.webp')) onDisk.push(`${prefix}/${entry.name}`);
  }
};
walk(join(PUBLIC_DIR, 'images'), '/images');
onDisk.sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));

const problems = [];
const images = [];
for (const path of onDisk) {
  const record = records.get(path);
  if (!record) {
    problems.push(`файл без сведений об источнике: ${path}`);
    continue;
  }
  const file = publicPathToFile(path);
  const { width, height } = imageSize(file);
  const { alt_ru, ...rest } = record;
  images.push({ path, width, height, ...rest, avg_color: averageColor(file), alt_ru });
}
for (const path of records.keys()) if (!existsSync(publicPathToFile(path))) problems.push(`запись без файла: ${path}`);
for (const image of images) if (/[–—]/.test(image.alt_ru)) problems.push(`тире в подписи: ${image.path}`);

writeJson(join(PUBLIC_DIR, 'images', 'manifest.json'), {
  fal: {
    model: falConfig.model,
    budget: falConfig.budget,
    generations_spent: ledger.generations.length,
    key_status: 'HTTP 403 на пробном запросе 12.11.2026: баланс исчерпан, генерация не выполнялась',
  },
  licenses: { pexels: 'Pexels License: свободное использование и изменение, указание автора не обязательно' },
  images,
});
log(`Манифест: ${images.length} файлов, генераций fal: ${ledger.generations.length}.`);
if (problems.length > 0) {
  for (const problem of problems) log(`ПРОБЛЕМА: ${problem}`);
  process.exit(1);
}
