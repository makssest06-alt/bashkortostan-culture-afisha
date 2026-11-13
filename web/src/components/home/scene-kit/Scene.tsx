'use client';

/**
 * <Scene> и хуки сцен главной. Полное описание и пример: ./README.md
 *
 * Закреплённая сцена: экран высотой 100dvh закрепляется на pinVh экранов, локальный прогресс 0..1
 * уходит в общий стор. Сцена-поток не закрепляется: прогресс идёт от входа секции в окно до выхода.
 */

import { createContext, useCallback, useContext, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';

import { cn } from '@/lib/cn';
import { gsap, ScrollTrigger, useGSAP } from '@/lib/gsap';

import { SERVER_ENV, useSceneEnv } from './env';
import { isScenePinned, sceneLayout, SCENES } from './registry';
import { setSceneProgress, setToneReached, subscribeScene } from './store';
import type { SceneDef, SceneEnv, SceneLayout } from './types';

/** Высота линии под шапкой: когда верх сцены-потока доходит до неё, шапка берёт цвет этой сцены. */
const HEADER_LINE_PX = 32;

type SceneContextValue = {
  def: SceneDef;
  env: SceneEnv;
  layout: SceneLayout;
  rootRef: RefObject<HTMLElement | null>;
  backdrop: HTMLDivElement | null;
};

const SceneContext = createContext<SceneContextValue | null>(null);
const BackdropHostContext = createContext<HTMLElement | null>(null);

function useSceneContext(hook: string): SceneContextValue {
  const value = useContext(SceneContext);
  if (!value) throw new Error(`${hook} можно вызывать только внутри <Scene>`);
  return value;
}

/**
 * Сверка сцен с прокруткой. Колбэки своего ScrollTrigger сцена получает только внутри отрезка
 * закрепления: за его пределами ей некому сказать, что страница уехала дальше. Поэтому каждая сцена
 * кладёт сюда функцию сверки, а общий ScrollTrigger на всю страницу (в SceneRoot) зовёт их на каждом шаге.
 */
const sceneSyncers = new Set<() => void>();

function runSceneSyncers(): void {
  for (const sync of sceneSyncers) sync();
}

/**
 * Корень сцен главной. Ставится один раз вокруг всех сцен (в HomeStage):
 *   - создаёт фиксированный слой подложек (между фоном и жетоном), куда <Scene backdrop={...}>
 *     выносит свою подложку;
 *   - на каждом шаге прокрутки сверяет видимость экранов сцен и цвет шапки.
 */
export function SceneRoot({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);

  useGSAP(() => {
    ScrollTrigger.create({ start: 0, end: 'max', onUpdate: runSceneSyncers });
    // После пересчёта закреплений (ресайз, загрузка шрифта) границы сцен другие: сверяемся заново.
    ScrollTrigger.addEventListener('refresh', runSceneSyncers);
    return () => ScrollTrigger.removeEventListener('refresh', runSceneSyncers);
  });

  return (
    <BackdropHostContext value={host}>
      <div ref={setHost} className="scene-backdrops" aria-hidden="true" />
      {children}
    </BackdropHostContext>
  );
}

export type SceneProps = {
  def: SceneDef;
  /** Классы экрана сцены (.scene-stage): блока высотой 100dvh, внутри которого лежит содержимое. */
  className?: string;
  children?: ReactNode;
  /** Содержимое в обычном потоке сразу после закреплённого экрана, внутри той же секции. */
  after?: ReactNode;
  /** Подложка ПОД жетоном: фиксированный слой на весь экран. Видна, пока сцена на экране. */
  backdrop?: ReactNode;
  /** Подпись секции для чтения с экрана. */
  label?: string;
};

/**
 * Сцена далеко от текущей прокрутки: больше чем на FAR_SCREENS экрана до начала или после конца закрепления.
 * Такую сцену можно выгрузить (display: none у содержимого и подложки): до неё не меньше экрана прокрутки,
 * браузер успеет отрисовать её заново, а память всех остальных сцен не держится одновременно.
 */
const FAR_SCREENS = 1.25;

function isFar(y: number, start: number, end: number): boolean {
  const margin = window.innerHeight * FAR_SCREENS;
  return y < start - margin || y > end + margin;
}

export function Scene({ def, className, children, after, backdrop, label }: SceneProps) {
  const env = useSceneEnv();
  const ready = env !== SERVER_ENV;
  const rootRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<ScrollTrigger | null>(null);
  const host = useContext(BackdropHostContext);
  const [backdropEl, setBackdropEl] = useState<HTMLDivElement | null>(null);
  const layout = useMemo(() => sceneLayout(def.id, env.mobile), [def.id, env.mobile]);

  useGSAP(
    () => {
      const section = rootRef.current;
      const stage = stageRef.current;
      if (!ready || !section || !stage || layout.index < 0) return;

      const id = def.id;
      // Чем выше сцена на странице, тем раньше пересчитывается её закрепление: порядок создания не важен.
      const refreshPriority = SCENES.length - layout.index;

      // Склейка: секция поднимается на высоту экрана и начинается ровно там, где кончилась прошлая сцена.
      if (layout.pinned && layout.cutIn) section.style.marginTop = '-100dvh';

      const trigger = ScrollTrigger.create(
        layout.pinned
          ? {
              trigger: stage,
              pin: true,
              start: 'top top',
              end: () => `+=${layout.pinVh * 100}%`,
              // Прогресс уходит в стор напрямую, без сглаживания: это то же, что scrub: true.
              scrub: true,
              anticipatePin: 1,
              invalidateOnRefresh: true,
              refreshPriority,
            }
          : {
              trigger: section,
              start: 'top bottom',
              end: 'bottom top',
              scrub: true,
              invalidateOnRefresh: true,
              refreshPriority,
            },
      );
      triggerRef.current = trigger;

      // Линия шапки: с неё сцена отвечает за цвет шапки. У склейки это начало закрепления.
      const toneTrigger = ScrollTrigger.create({
        trigger: section,
        start: layout.cutIn ? 'top top' : `top ${HEADER_LINE_PX}px`,
        end: 'max',
        refreshPriority,
      });

      const sync = () => {
        const y = trigger.scroll();
        const { start, end } = trigger;
        const before = y < start;
        const after = y >= end;
        // Прогресс считаем сами из положения прокрутки: он не зависит от порядка обновления триггеров.
        setSceneProgress(id, end > start ? (y - start) / (end - start) : after ? 1 : 0);
        // При склейке на месте соседние экраны наложены друг на друга: виден только активный.
        const hidden = (layout.cutIn && before) || (layout.cutOut && after);
        stage.style.visibility = hidden ? 'hidden' : '';
        section.toggleAttribute('data-active', !before && !after);
        const backdropNode = backdropRef.current;
        if (backdropNode) backdropNode.style.visibility = before || after ? 'hidden' : '';
        // Дальняя закреплённая сцена выгружается: её слои и картинки уходят из памяти (iPhone иначе убивает вкладку).
        const far = isFar(y, start, end);
        if (layout.pinned) section.toggleAttribute('data-far', far);
        backdropNode?.toggleAttribute('data-far', far);
        setToneReached(id, y >= toneTrigger.start);
      };

      sceneSyncers.add(sync);
      sync();

      return () => {
        sceneSyncers.delete(sync);
        triggerRef.current = null;
        section.style.marginTop = '';
        section.removeAttribute('data-active');
        section.removeAttribute('data-far');
        backdropRef.current?.removeAttribute('data-far');
        stage.style.visibility = '';
        setToneReached(id, false);
      };
    },
    {
      dependencies: [ready, def.id, layout.index, layout.pinned, layout.pinVh, layout.cutIn, layout.cutOut],
      revertOnUpdate: true,
    },
  );

  // Подложка появляется на второй рендер (ей нужен узел слоя): сразу ставим ей верную видимость.
  const attachBackdrop = useCallback((node: HTMLDivElement | null) => {
    backdropRef.current = node;
    if (node) {
      const trigger = triggerRef.current;
      const y = trigger ? trigger.scroll() : 0;
      const offscreen = !trigger || y < trigger.start || y >= trigger.end;
      node.style.visibility = offscreen ? 'hidden' : '';
      node.toggleAttribute('data-far', trigger ? isFar(y, trigger.start, trigger.end) : false);
    }
    setBackdropEl(node);
  }, []);

  const context = useMemo<SceneContextValue>(
    () => ({ def, env, layout, rootRef, backdrop: backdropEl }),
    [def, env, layout, backdropEl],
  );

  return (
    <SceneContext value={context}>
      <section
        ref={rootRef}
        className="scene"
        data-scene={def.id}
        data-pin-d={isScenePinned(def, false) ? '' : undefined}
        data-pin-m={isScenePinned(def, true) ? '' : undefined}
        aria-label={label}
      >
        <div ref={stageRef} className={cn('scene-stage', className)}>
          {children}
        </div>
        {after}
      </section>
      {backdrop && host
        ? createPortal(
            <div ref={attachBackdrop} className="scene-backdrop" data-scene-backdrop={def.id}>
              {backdrop}
            </div>,
            host,
          )
        : null}
    </SceneContext>
  );
}

// ---------------------------------------------------------------------------
// Хуки
// ---------------------------------------------------------------------------

export type SceneTimelineCtx = {
  /** Секция сцены (<section data-scene>). */
  root: HTMLElement;
  env: SceneEnv;
  /** Поиск по селектору только внутри секции: q('.title'). */
  q: gsap.utils.SelectorFunc;
  /** Узел подложки (слот backdrop) или null, если подложки нет. Он лежит вне секции, q его не видит. */
  backdrop: HTMLElement | null;
};

/**
 * Таймлайн сцены длиной 1: позиции и длительности пишутся в долях прогресса сцены.
 *
 *   useSceneTimeline((tl, { q }) => {
 *     tl.fromTo(q('.title'), { autoAlpha: 0, y: 40 }, { autoAlpha: 1, y: 0, duration: 0.2 }, 0.1);
 *     tl.to(q('.title'), { autoAlpha: 0, duration: 0.12 }, 0.88);
 *   });
 *
 * Время таймлайна равно прогрессу сцены (как scrub: true). Кривая по умолчанию 'none'.
 * Пересобирается при смене окружения (ресайз, телефон, меньше движения) и при смене deps.
 */
export function useSceneTimeline(
  build: (tl: gsap.core.Timeline, ctx: SceneTimelineCtx) => void,
  deps: readonly unknown[] = [],
): void {
  const { def, env, rootRef, backdrop } = useSceneContext('useSceneTimeline');

  useGSAP(
    () => {
      const root = rootRef.current;
      if (!root || env === SERVER_ENV) return;

      const tl = gsap.timeline({ paused: true, defaults: { ease: 'none' } });
      // Пустой отрезок держит длину таймлайна равной 1, даже если движения занимают меньше.
      tl.to({}, { duration: 1 }, 0);
      build(tl, { root, env, q: gsap.utils.selector(root), backdrop });

      if (process.env.NODE_ENV !== 'production' && tl.duration() > 1.0005) {
        console.warn(
          `[scene:${def.id}] таймлайн длиннее 1 (${tl.duration().toFixed(3)}): всё, что позже 1, не проиграется`,
        );
      }

      return subscribeScene(def.id, (progress) => {
        tl.time(progress);
      });
    },
    { scope: rootRef, dependencies: [def.id, env, backdrop, ...deps], revertOnUpdate: true },
  );
}

/**
 * Подписка на локальный прогресс сцены без ререндеров. Для порогов и значений, которые удобнее
 * писать в DOM руками (счётчик, класс, цвет шапки).
 *
 *   useSceneProgress((p) => setHeaderTone('trust', p >= 0.74 ? 'dark' : 'light'));
 */
export function useSceneProgress(callback: (progress: number, env: SceneEnv) => void): void {
  const { def, env } = useSceneContext('useSceneProgress');
  const onProgress = useEffectEvent(callback);

  useEffect(() => {
    if (env === SERVER_ENV) return;
    return subscribeScene(def.id, (progress) => onProgress(progress, env));
  }, [def.id, env]);
}

/** Данные текущей сцены: описание, окружение, раскладка, узлы секции и подложки. */
export function useScene(): SceneContextValue {
  return useSceneContext('useScene');
}
