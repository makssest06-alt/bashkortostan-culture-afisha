/**
 * scene-kit: контракт сцен главной. Описание и пример: ./README.md
 *
 * ВАЖНО: def.ts сцен импортируют только из './types' и './math' (не из этого файла),
 * иначе получится цикл: index -> registry -> def -> index.
 */

export { Scene, SceneRoot, useScene, useSceneProgress, useSceneTimeline } from './Scene';
export type { SceneProps, SceneTimelineCtx } from './Scene';
export { TokenCanvas } from './TokenCanvas';
export { MOBILE_BREAKPOINT, SERVER_ENV, getSceneEnv, subscribeEnv, useSceneEnv } from './env';
export { POSE, clamp01, lerp, mixPose, smooth, span } from './math';
export { SCENES, isScenePinned, sceneIndex, sceneLayout, scenePinVh } from './registry';
export {
  BLEND,
  getGlow,
  getSceneProgress,
  getTokenPose,
  requestTokenRedraw,
  resetHomeState,
  sceneStore,
  setHeaderTone,
  setPageProgress,
  setPresentScenes,
  setSceneProgress,
  subscribe,
  subscribePage,
  subscribeScene,
} from './store';
export { SCENE_IDS } from './types';
export type { HeaderTone, SceneDef, SceneEnv, SceneId, SceneLayout, TokenPose } from './types';
