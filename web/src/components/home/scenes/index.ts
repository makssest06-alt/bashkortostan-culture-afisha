/**
 * Компоненты сцен главной по идентификатору. Порядок задаёт scene-kit/registry.ts.
 * Экспорт по умолчанию каждого scenes/<id>/index.tsx рендерит <Scene def={def}>.
 */

import type { ComponentType } from 'react';

import type { SceneId } from '../scene-kit/types';
import AiScene from './ai';
import BlueprintScene from './blueprint';
import ChooseScene from './choose';
import CitiesScene from './cities';
import DedupScene from './dedup';
import FiltersScene from './filters';
import FooterScene from './footer';
import FullscreenScene from './fullscreen';
import GalleryScene from './gallery';
import HeroScene from './hero';
import IntroScene from './intro';
import PopularScene from './popular';
import ThermalScene from './thermal';
import TrustScene from './trust';
import WordmarkScene from './wordmark';

export const SCENE_COMPONENTS: Record<SceneId, ComponentType> = {
  intro: IntroScene,
  hero: HeroScene,
  ai: AiScene,
  gallery: GalleryScene,
  fullscreen: FullscreenScene,
  thermal: ThermalScene,
  blueprint: BlueprintScene,
  wordmark: WordmarkScene,
  filters: FiltersScene,
  dedup: DedupScene,
  trust: TrustScene,
  cities: CitiesScene,
  popular: PopularScene,
  choose: ChooseScene,
  footer: FooterScene,
};
