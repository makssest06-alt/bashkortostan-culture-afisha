/**
 * Сведения о картинке события из манифеста public/images/manifest.json: описание для alt
 * и автор снимка. Только для сервера: манифест не попадает в код браузера.
 */

import manifest from '../../../../public/images/manifest.json';

import type { ImageMeta } from '@/components/event/model';

type ManifestImage = {
  path: string;
  width: number;
  height: number;
  author?: string;
  alt_ru?: string;
};

const IMAGES = new Map<string, ManifestImage>(
  (manifest.images as ManifestImage[]).map((image) => [image.path, image]),
);

/** null, если картинки нет или её нет в манифесте: тогда alt пустой и подписи под снимком нет. */
export function imageMetaOf(path: string | null): ImageMeta | null {
  if (!path) return null;
  const entry = IMAGES.get(path);
  if (!entry) return null;
  return {
    alt: entry.alt_ru ?? '',
    author: entry.author ?? null,
    width: entry.width,
    height: entry.height,
  };
}
