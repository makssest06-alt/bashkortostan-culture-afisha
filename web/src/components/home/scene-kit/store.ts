/**
 * Общий стор сцен главной: изменяемый объект без состояния React.
 * Прокрутка меняет его десятки раз в секунду, поэтому подписчики получают значения напрямую
 * и сами пишут в DOM или в three.js. Ререндеров React стор не вызывает.
 *
 * Кто пишет:  <Scene> (прогресс сцен и шапка), ScrollProgress (прогресс страницы).
 * Кто читает: useSceneTimeline, useSceneProgress, TokenCanvas, фон со свечением, шапка.
 */

import { clamp01, mixPose } from './math';
import type { HeaderTone, SceneDef, SceneEnv, TokenPose } from './types';

type Listener = () => void;
type ProgressListener = (progress: number) => void;

/** Доля сцены, на которой позы жетона и свечение соседних сцен смешиваются: последние и первые 8 %. */
export const BLEND = 0.08;

export const sceneStore = {
  /** Сцены по порядку. Заполняет registry.ts. */
  scenes: [] as readonly SceneDef[],
  /** Локальный прогресс каждой сцены, 0..1. */
  progressById: {} as Record<string, number>,
  /** Активная сцена: последняя по порядку, которая уже началась. */
  activeId: null as string | null,
  /** Прогресс всей страницы, 0..1. */
  pageProgress: 0,
  /** Сцена, которая сейчас под шапкой. */
  toneSceneId: null as string | null,
  /** Цвет шапки, который сейчас применён. */
  headerTone: 'light' as HeaderTone,
  /**
   * Какие сцены реально отрисованы. null: все (главная). Набор задаёт предпросмотр /dev/scenes?only=...,
   * чтобы стыки и смешение поз считались только между присутствующими сценами.
   */
  present: null as ReadonlySet<string> | null,
};

/**
 * Перерисовать жетон и свечение, не меняя прогресс: когда входные данные позы сцены изменились вне прокрутки
 * (например, сцена заново замерила место под жетон после смены окна или загрузки шрифта).
 */
export function requestTokenRedraw(): void {
  for (const listener of listeners) listener();
}

/** Предпросмотр части сцен: передать их id. Главная: null. */
export function setPresentScenes(ids: readonly string[] | null): void {
  sceneStore.present = ids && ids.length ? new Set(ids) : null;
}

export function isScenePresent(id: string): boolean {
  return sceneStore.present === null || sceneStore.present.has(id);
}

const listeners = new Set<Listener>();
const pageListeners = new Set<ProgressListener>();
const sceneListeners = new Map<string, Set<ProgressListener>>();
const toneReached = new Set<string>();
const toneOverride = new Map<string, HeaderTone>();

// ---------------------------------------------------------------------------
// Регистрация и прогресс
// ---------------------------------------------------------------------------

/** Задаёт порядок сцен. Вызывается один раз из registry.ts. */
export function registerScenes(scenes: readonly SceneDef[]): void {
  sceneStore.scenes = scenes;
  for (const scene of scenes) {
    if (!(scene.id in sceneStore.progressById)) sceneStore.progressById[scene.id] = 0;
  }
  if (sceneStore.activeId === null && scenes.length > 0) sceneStore.activeId = scenes[0].id;
  if (sceneStore.toneSceneId === null && scenes.length > 0) sceneStore.toneSceneId = scenes[0].id;
}

function findActiveIndex(): number {
  const { scenes, progressById } = sceneStore;
  for (let i = scenes.length - 1; i > 0; i -= 1) {
    if ((progressById[scenes[i].id] ?? 0) > 0) return i;
  }
  return 0;
}

export function getSceneProgress(id: string): number {
  return sceneStore.progressById[id] ?? 0;
}

/** Публикует локальный прогресс сцены. Вызывает <Scene>; авторам сцен эта функция не нужна. */
export function setSceneProgress(id: string, progress: number): void {
  const value = clamp01(progress);
  if (sceneStore.progressById[id] === value) return;
  sceneStore.progressById[id] = value;
  const active = sceneStore.scenes[findActiveIndex()];
  if (active) sceneStore.activeId = active.id;
  const own = sceneListeners.get(id);
  if (own) for (const listener of own) listener(value);
  for (const listener of listeners) listener();
}

export function setPageProgress(progress: number): void {
  const value = clamp01(progress);
  if (sceneStore.pageProgress === value) return;
  sceneStore.pageProgress = value;
  for (const listener of pageListeners) listener(value);
}

/** Подписка на любое изменение прогресса сцен. Возвращает функцию отписки. */
export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Подписка на прогресс одной сцены. Слушатель сразу получает текущее значение. */
export function subscribeScene(id: string, listener: ProgressListener): () => void {
  let own = sceneListeners.get(id);
  if (!own) {
    own = new Set();
    sceneListeners.set(id, own);
  }
  own.add(listener);
  listener(getSceneProgress(id));
  return () => {
    own.delete(listener);
  };
}

/** Подписка на прогресс всей страницы. Слушатель сразу получает текущее значение. */
export function subscribePage(listener: ProgressListener): () => void {
  pageListeners.add(listener);
  listener(sceneStore.pageProgress);
  return () => {
    pageListeners.delete(listener);
  };
}

// ---------------------------------------------------------------------------
// Смешение значений на стыке сцен
// ---------------------------------------------------------------------------

function ramp(value: number, from: number, to: number): number {
  return clamp01((value - from) / (to - from));
}

/**
 * Значение активной сцены, смешанное с соседями на стыках.
 * Вес перехода A -> B: половину даёт конец A (0.92..1), половину начало B (0..0.08).
 * На самой границе выходит 50 на 50, скачков нет ни при склейке, ни при обычной прокрутке.
 */
function blendAcrossScenes<T>(
  sample: (def: SceneDef, progress: number) => T | null,
  mix: (a: T | null, b: T | null, weight: number) => T | null,
): T | null {
  const { scenes } = sceneStore;
  if (scenes.length === 0) return null;
  const index = findActiveIndex();
  const current = scenes[index];
  const progress = getSceneProgress(current.id);
  let result = sample(current, progress);

  const previous = scenes[index - 1];
  if (previous && isScenePresent(previous.id)) {
    const previousProgress = getSceneProgress(previous.id);
    const weight = 0.5 * ramp(previousProgress, 1 - BLEND, 1) + 0.5 * ramp(progress, 0, BLEND);
    if (weight < 1) result = mix(sample(previous, previousProgress), result, weight);
  }

  const next = scenes[index + 1];
  if (next && isScenePresent(next.id)) {
    const nextProgress = getSceneProgress(next.id);
    const weight = 0.5 * ramp(progress, 1 - BLEND, 1) + 0.5 * ramp(nextProgress, 0, BLEND);
    if (weight > 0) result = mix(result, sample(next, nextProgress), weight);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Жетон
// ---------------------------------------------------------------------------

function mixNullablePose(a: TokenPose | null, b: TokenPose | null, weight: number): TokenPose | null {
  if (a && b) return mixPose(a, b, weight);
  // У одной из сцен жетона нет: он гаснет на месте, а не улетает.
  if (a) return { ...a, opacity: a.opacity * (1 - weight) };
  if (b) return { ...b, opacity: b.opacity * weight };
  return null;
}

let lastPose: TokenPose = { x: 0, y: 0, scale: 0.24, rx: 0, ry: 0, rz: 0, opacity: 0, mode: 'solid' };

/**
 * Поза жетона прямо сейчас: поза активной сцены, смешанная с соседями на стыках.
 * Если у сцены нет token или он вернул null, возвращается последняя поза с opacity 0.
 */
export function getTokenPose(env: SceneEnv): TokenPose {
  const pose = blendAcrossScenes<TokenPose>((def, progress) => def.token?.(progress, env) ?? null, mixNullablePose);
  lastPose = pose ? { ...pose, mode: pose.mode ?? 'solid' } : { ...lastPose, opacity: 0 };
  return lastPose;
}

// ---------------------------------------------------------------------------
// Свечение фона
// ---------------------------------------------------------------------------

/** Яркость фонового свечения 0..1 для текущего положения прокрутки. */
export function getGlow(env: SceneEnv): number {
  const value = blendAcrossScenes<number>(
    (def, progress) => {
      if (typeof def.glow === 'function') return clamp01(def.glow(progress, env));
      return typeof def.glow === 'number' ? clamp01(def.glow) : 1;
    },
    (a, b, weight) => (a ?? 1) + ((b ?? 1) - (a ?? 1)) * weight,
  );
  return value ?? 1;
}

// ---------------------------------------------------------------------------
// Цвет шапки
// ---------------------------------------------------------------------------

function applyHeaderTone(): void {
  const { scenes } = sceneStore;
  let toneScene: SceneDef | undefined = scenes[0];
  for (const scene of scenes) {
    if (toneReached.has(scene.id)) toneScene = scene;
  }
  if (!toneScene) return;
  const tone = toneOverride.get(toneScene.id) ?? toneScene.headerTone ?? 'light';
  sceneStore.toneSceneId = toneScene.id;
  sceneStore.headerTone = tone;
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.headerTone = tone;
    // Сцены обычной прокрутки (flow) проезжают под шапкой: ей нужна подложка, иначе текст налезает на меню.
    document.documentElement.dataset.headerScrim = toneScene.flow ? 'on' : 'off';
  }
}

/** Сцена дошла до шапки или ушла ниже неё. Вызывает <Scene>. */
export function setToneReached(id: string, reached: boolean): void {
  if (toneReached.has(id) === reached) return;
  if (reached) toneReached.add(id);
  else toneReached.delete(id);
  applyHeaderTone();
}

/**
 * Меняет цвет шапки по ходу сцены (например, на пороге инверсии в светлый блок).
 * Действует, пока сцена `id` под шапкой. null возвращает значение из def.headerTone.
 *
 *   useSceneProgress((p) => setHeaderTone('trust', p >= 0.74 ? 'dark' : 'light'));
 */
export function setHeaderTone(id: string, tone: HeaderTone | null): void {
  const previous = toneOverride.get(id) ?? null;
  if (previous === tone) return;
  if (tone === null) toneOverride.delete(id);
  else toneOverride.set(id, tone);
  applyHeaderTone();
}

/** Сброс при уходе с главной: шапка снова светлая, прогресс сцен обнулён. */
export function resetHomeState(): void {
  toneReached.clear();
  toneOverride.clear();
  for (const scene of sceneStore.scenes) sceneStore.progressById[scene.id] = 0;
  sceneStore.activeId = sceneStore.scenes[0]?.id ?? null;
  sceneStore.toneSceneId = sceneStore.activeId;
  sceneStore.headerTone = 'light';
  sceneStore.present = null;
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.headerTone = 'light';
    document.documentElement.dataset.headerScrim = 'off';
  }
}
