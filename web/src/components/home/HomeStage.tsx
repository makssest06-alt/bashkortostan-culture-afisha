'use client';

/**
 * Главная: фиксированный фон со свечением, слой подложек, жетон и сцены по порядку из реестра.
 * Слои снизу вверх: фон (.glow-bg) -> подложки сцен -> жетон (TokenCanvas) -> содержимое сцен (main).
 */

import Link from 'next/link';
import { useEffect, useRef } from 'react';

import { GlowBackground } from '@/components/shell/GlowBackground';
import { ROUTES } from '@/content/links';
import { useT } from '@/lib/i18n';

import {
  SCENES,
  SERVER_ENV,
  SceneRoot,
  TokenCanvas,
  getGlow,
  getSceneEnv,
  resetHomeState,
  setPresentScenes,
  subscribe,
} from './scene-kit';
import type { SceneId } from './scene-kit';
import { Preloader } from './Preloader';
import { SCENE_COMPONENTS } from './scenes';

/** Фон главной: яркость свечения ведут сцены (поле glow в def), значение берётся из стора. */
function HomeGlow() {
  const lit = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const apply = () => {
      if (lit.current) lit.current.style.opacity = getGlow(getSceneEnv()).toFixed(3);
    };
    apply();
    return subscribe(apply);
  }, []);

  return <GlowBackground litRef={lit} intensity={getGlow(SERVER_ENV)} />;
}

/**
 * only: показать только перечисленные сцены (маршрут /dev/scenes для проверки сцены отдельно от соседей).
 * На главной не задаётся.
 */
export function HomeStage({ only }: { only?: readonly string[] } = {}) {
  const { t } = useT();
  const scenes = only?.length ? SCENES.filter((scene) => only.includes(scene.id)) : SCENES;
  // До рендера сцен: раскладка стыков (sceneLayout) читает этот набор синхронно. Повторный вызов безвреден.
  setPresentScenes(only?.length ? scenes.map((scene) => scene.id) : null);

  // Уходим с главной: шапка снова светлая, прогресс сцен обнулён.
  useEffect(() => resetHomeState, []);

  return (
    <SceneRoot>
      {/* Предпросмотр отдельных сцен (/dev/scenes) открывается сразу, без экрана загрузки */}
      {only?.length ? null : <Preloader />}
      <HomeGlow />
      <TokenCanvas />
      {/* Длинная история на прокрутке: с клавиатуры можно сразу уйти в каталог */}
      <Link
        href={ROUTES.events}
        className="t-ui fixed top-3 left-1/2 z-(--z-skip) -translate-x-1/2 -translate-y-[200%] rounded-sm bg-fg px-4 py-3 text-bg focus-visible:translate-y-0"
      >
        {t('home.skipStory')}
      </Link>
      <main id="content" className="relative z-(--z-content)">
        {scenes.map((scene) => {
          const SceneComponent = SCENE_COMPONENTS[scene.id as SceneId];
          return SceneComponent ? <SceneComponent key={scene.id} /> : null;
        })}
      </main>
    </SceneRoot>
  );
}
