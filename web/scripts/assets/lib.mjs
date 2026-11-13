// Общие помощники для скриптов подготовки изображений.
// Ключи читаются ТОЛЬКО из окружения (node --env-file=.env.assets ...),
// нигде не печатаются: всё, что уходит в консоль, проходит через redact().
//
// Запуск любого скрипта из каталога web:
//   NODE_USE_ENV_PROXY=1 node --env-file=.env.assets scripts/assets/<скрипт>.mjs ...
// Рабочие (сырые) файлы кладутся в ASSETS_WORK_DIR (по умолчанию системный tmp),
// в репозиторий попадают только готовые webp в public/images и манифест.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const WEB_ROOT = resolve(HERE, '..', '..');
export const PUBLIC_DIR = join(WEB_ROOT, 'public');
export const WORK_DIR = process.env.ASSETS_WORK_DIR || join(os.tmpdir(), 'afisha-assets');

const SECRET_NAMES = ['FAL_KEY', 'PEXELS_KEY'];

/** Затирает значения ключей в любой строке перед печатью. */
export function redact(text) {
  let out = String(text);
  for (const name of SECRET_NAMES) {
    const value = process.env[name];
    if (value && value.length >= 6) out = out.split(value).join(`<${name}>`);
  }
  return out;
}

export function log(...parts) {
  console.log(redact(parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ')));
}

export function fail(message) {
  console.error(redact(`ОШИБКА: ${message}`));
  process.exit(1);
}

export function requireKey(name) {
  const value = process.env[name];
  if (!value) fail(`нет переменной ${name}. Запускай: node --env-file=.env.assets ...`);
  return value;
}

export function warnProxy() {
  const hasProxy = Boolean(process.env.https_proxy || process.env.HTTPS_PROXY);
  if (hasProxy && process.env.NODE_USE_ENV_PROXY !== '1') {
    log('ВНИМАНИЕ: задан https_proxy, но NODE_USE_ENV_PROXY != 1: fetch пойдёт мимо прокси.');
  }
}

export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function readJson(file, fallback) {
  if (!existsSync(file)) return fallback;
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function writeJson(file, data) {
  ensureDir(dirname(file));
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

/** HTTP-запрос с таймаутом. Тело ошибки возвращается уже затёртым. */
export async function http(url, { method = 'GET', headers = {}, body, timeoutMs = 120000 } = {}) {
  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const cause = error?.cause?.code || error?.cause?.message || '';
    throw new Error(redact(`сеть: ${error.name} ${error.message} ${cause} (${new URL(url).host})`));
  }
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: response.status, ok: response.ok, json, text: redact(text).slice(0, 600) };
}

export async function download(url, dest, { headers = {}, timeoutMs = 180000 } = {}) {
  let response;
  try {
    response = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw new Error(redact(`загрузка: ${error.name} ${error.message} (${new URL(url).host})`));
  }
  if (!response.ok) throw new Error(`загрузка: HTTP ${response.status} (${new URL(url).host})`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length < 1024) throw new Error(`загрузка: подозрительно малый файл, ${buffer.length} байт`);
  ensureDir(dirname(dest));
  writeFileSync(dest, buffer);
  return buffer.length;
}

export function magick(args) {
  return execFileSync('magick', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
}

export function imageSize(file) {
  const [width, height] = magick(['identify', '-format', '%w %h', `${file}[0]`]).split(' ').map(Number);
  if (!width || !height) throw new Error(`не удалось прочитать размер: ${file}`);
  return { width, height };
}

/** Средний цвет картинки в виде #RRGGBB. */
export function averageColor(file) {
  const hex = magick([file, '-alpha', 'off', '-colorspace', 'sRGB', '-resize', '1x1!', '-depth', '8', '-format', '%[hex:u.p{0,0}]', 'info:']);
  const clean = hex.replace(/[^0-9a-fA-F]/g, '').slice(0, 6).toUpperCase();
  if (clean.length !== 6) throw new Error(`не удалось посчитать средний цвет: ${file} -> ${hex}`);
  return `#${clean}`;
}

export function parseAspect(aspect) {
  const [a, b] = String(aspect).split(':').map(Number);
  if (!a || !b) throw new Error(`неверное соотношение сторон: ${aspect}`);
  return a / b;
}

/**
 * Кадрирует исходник под соотношение сторон и сохраняет webp.
 * Вверх не растягивает: если исходник меньше цели, берётся его размер.
 * gravity: center | north | south | east | west | northeast ...
 */
export function toWebp({ src, dest, aspect, longSide, gravity = 'center', quality = 80 }) {
  const source = imageSize(src);
  const ratio = parseAspect(aspect);
  let cropW = source.width;
  let cropH = Math.round(cropW / ratio);
  if (cropH > source.height) {
    cropH = source.height;
    cropW = Math.round(cropH * ratio);
  }
  const cropLong = Math.max(cropW, cropH);
  const scale = Math.min(1, longSide / cropLong);
  const outW = Math.round(cropW * scale);
  const outH = Math.round(cropH * scale);
  ensureDir(dirname(dest));
  magick([
    src,
    '-auto-orient',
    '-gravity', gravity,
    '-crop', `${cropW}x${cropH}+0+0`,
    '+repage',
    '-resize', `${outW}x${outH}!`,
    '-colorspace', 'sRGB',
    '-strip',
    '-quality', String(quality),
    '-define', 'webp:method=6',
    dest,
  ]);
  const result = imageSize(dest);
  return { ...result, upscaled: false, sourceWidth: source.width, sourceHeight: source.height };
}

export function publicPathToFile(publicPath) {
  if (!publicPath.startsWith('/images/')) throw new Error(`путь вне /images: ${publicPath}`);
  return join(PUBLIC_DIR, publicPath);
}
