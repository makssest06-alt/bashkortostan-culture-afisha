/**
 * Реестр сцен главной: порядок, длины закрепления и раскладка стыков.
 * Здесь только def-файлы сцен. Компоненты сцен собраны отдельно, в scenes/index.ts.
 */

import { def as ai } from '../scenes/ai/def';
import { def as blueprint } from '../scenes/blueprint/def';
import { def as choose } from '../scenes/choose/def';
import { def as cities } from '../scenes/cities/def';
import { def as dedup } from '../scenes/dedup/def';
import { def as filters } from '../scenes/filters/def';
import { def as footer } from '../scenes/footer/def';
import { def as fullscreen } from '../scenes/fullscreen/def';
import { def as gallery } from '../scenes/gallery/def';
import { def as hero } from '../scenes/hero/def';
import { def as intro } from '../scenes/intro/def';
import { def as popular } from '../scenes/popular/def';
import { def as thermal } from '../scenes/thermal/def';
import { def as trust } from '../scenes/trust/def';
import { def as wordmark } from '../scenes/wordmark/def';
import { isScenePresent, registerScenes } from './store';
import type { SceneDef, SceneLayout } from './types';

/** Сцены главной сверху вниз. */
export const SCENES: readonly SceneDef[] = [
  intro,
  hero,
  ai,
  gallery,
  fullscreen,
  thermal,
  blueprint,
  wordmark,
  filters,
  dedup,
  trust,
  cities,
  popular,
  choose,
  footer,
];

registerScenes(SCENES);

export function sceneIndex(id: string): number {
  return SCENES.findIndex((scene) => scene.id === id);
}

/** Длина закрепления в экранах для телефона или компьютера. 0: сцена идёт потоком. */
export function scenePinVh(def: SceneDef, mobile: boolean): number {
  if (def.flow) return 0;
  const value = mobile ? (def.pinVhMobile ?? def.pinVh) : def.pinVh;
  return value > 0 ? value : 0;
}

export function isScenePinned(def: SceneDef, mobile: boolean): boolean {
  return scenePinVh(def, mobile) > 0;
}

/** Стык двух соседних сцен это склейка на месте, если обе закреплены и ни одна не просит обычную прокрутку. */
function isCut(from: SceneDef | undefined, to: SceneDef | undefined, mobile: boolean): boolean {
  if (!from || !to) return false;
  if (!isScenePinned(from, mobile) || !isScenePinned(to, mobile)) return false;
  return from.exit !== 'scroll' && to.enter !== 'scroll';
}

/** Раскладка сцены: закреплена ли она и как стыкуется с соседями. */
export function sceneLayout(id: string, mobile: boolean): SceneLayout {
  const index = sceneIndex(id);
  const def = SCENES[index];
  if (!def) return { index: -1, pinned: false, pinVh: 0, cutIn: false, cutOut: false };
  // В предпросмотре /dev/scenes соседа может не быть на странице: тогда это не склейка.
  const previous = SCENES[index - 1];
  const next = SCENES[index + 1];
  return {
    index,
    pinned: isScenePinned(def, mobile),
    pinVh: scenePinVh(def, mobile),
    cutIn: previous && isScenePresent(previous.id) ? isCut(previous, def, mobile) : false,
    cutOut: next && isScenePresent(next.id) ? isCut(def, next, mobile) : false,
  };
}
