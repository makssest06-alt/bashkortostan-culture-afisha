/**
 * Авторы фотографий для раздела /about#credits. Источник один: public/images/manifest.json.
 * Файл читается при каждой сборке страницы, поэтому заменённые картинки сразу попадают в список.
 * Только для серверных компонентов: модуль использует файловую систему.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

export type CreditAuthor = {
  name: string;
  /** Страница фотографии на Pexels. Есть только у ссылок на https://www.pexels.com. */
  url: string | null;
};

export type CreditImage = {
  /** Путь картинки на сайте: /images/events/theatre-1.webp. */
  src: string;
  width: number;
  height: number;
  /** Подпись из манифеста. Есть только на русском. */
  altRu: string;
  authors: CreditAuthor[];
  /** Картинка собрана из нескольких фотографий и временная. */
  collage: boolean;
};

export type CreditGroupId = 'events' | 'scenes' | 'other';

export type CreditGroup = { id: CreditGroupId; images: CreditImage[] };

export type CreditsResult = { ok: true; groups: CreditGroup[] } | { ok: false };

const MANIFEST_PATH = path.join(process.cwd(), 'public', 'images', 'manifest.json');
const GROUP_ORDER: readonly CreditGroupId[] = ['events', 'scenes', 'other'];

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** На страницу попадают только ссылки на Pexels: манифест правится руками, адрес проверяем. */
function pexelsUrl(value: unknown): string | null {
  const url = str(value);
  return /^https:\/\/www\.pexels\.com\/[^\s"<>]*$/.test(url) ? url : null;
}

function authorsOf(entry: UnknownRecord): CreditAuthor[] {
  if (Array.isArray(entry.sources) && entry.sources.length > 0) {
    return entry.sources
      .filter(isRecord)
      .map((source) => ({ name: str(source.author), url: pexelsUrl(source.source_url) }))
      .filter((author) => author.name.length > 0);
  }
  const name = str(entry.author);
  return name ? [{ name, url: pexelsUrl(entry.source_url) }] : [];
}

function groupOf(src: string): CreditGroupId {
  if (src.startsWith('/images/events/')) return 'events';
  if (src.startsWith('/images/scenes/')) return 'scenes';
  return 'other';
}

/** Картинка из манифеста, если она с Pexels. Собственные рендеры в список авторов не входят. */
function toImage(entry: unknown): CreditImage | null {
  if (!isRecord(entry)) return null;
  const source = str(entry.source);
  if (!source.startsWith('pexels')) return null;
  const src = str(entry.path);
  if (!/^\/images\/[\w./-]+\.(webp|jpe?g|png|avif)$/.test(src)) return null;
  const authors = authorsOf(entry);
  if (authors.length === 0) return null;
  const width = typeof entry.width === 'number' && entry.width > 0 ? entry.width : 1;
  const height = typeof entry.height === 'number' && entry.height > 0 ? entry.height : 1;
  return { src, width, height, altRu: str(entry.alt_ru), authors, collage: source === 'pexels-composite' };
}

export async function loadCredits(): Promise<CreditsResult> {
  try {
    const raw: unknown = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
    if (!isRecord(raw) || !Array.isArray(raw.images)) throw new Error('В манифесте нет списка images');
    const images = raw.images.map(toImage).filter((image): image is CreditImage => image !== null);
    const groups = GROUP_ORDER.map((id) => ({
      id,
      images: images.filter((image) => groupOf(image.src) === id).sort((a, b) => a.src.localeCompare(b.src)),
    })).filter((group) => group.images.length > 0);
    return { ok: true, groups };
  } catch (error) {
    console.error('[about] манифест картинок не прочитан', error);
    return { ok: false };
  }
}
