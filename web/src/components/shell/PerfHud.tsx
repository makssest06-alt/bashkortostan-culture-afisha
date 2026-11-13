'use client';

/**
 * Отладочный счётчик кадров для поиска лагов: в левом верхнем углу «FPS 58 · 34 мс · Блок 4 (62%) Галерея».
 *   FPS      кадров за последнюю секунду (на экранах 120 Гц норма 120, на 60 Гц норма 60);
 *   мс       самый долгий кадр за последнюю секунду (норма 8-17 мс, больше 33 мс заметно глазу);
 *   Блок N   номер сцены главной по порядку и процент прокрутки внутри неё.
 *
 * Включается адресом с ?fps=1 и дальше остаётся включённым в этом браузере (localStorage); ?fps=0 выключает.
 * Без флага ничего не рисует и не запускает: жюри его не увидит.
 */

import { useEffect, useRef, useSyncExternalStore } from 'react';

import { getSceneProgress, sceneStore } from '@/components/home/scene-kit/store';

const STORAGE_KEY = 'afisha_fps_hud';

/** Названия блоков главной по id сцены: те же номера, что в списке для заказчика. */
const BLOCK_NAMES: Record<string, string> = {
  intro: 'Заставка',
  hero: 'Не просто афиша',
  ai: 'Подберёт ИИ',
  gallery: 'Галерея',
  fullscreen: 'Ближайшие (зал)',
  thermal: 'Горячо сегодня',
  blueprint: 'Чертёж',
  wordmark: 'Знак АФИША',
  filters: 'Пять условий',
  dedup: 'Одно событие',
  trust: 'Достоверность',
  cities: 'Города',
  popular: 'Популярное',
  choose: 'Выберите афишу',
  footer: 'Подвал',
};

function readFlag(): boolean {
  try {
    const param = new URLSearchParams(window.location.search).get('fps');
    if (param === '1') window.localStorage.setItem(STORAGE_KEY, '1');
    if (param === '0') window.localStorage.removeItem(STORAGE_KEY);
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return new URLSearchParams(window.location.search).get('fps') === '1';
  }
}

/** Флаг читается один раз на загрузку страницы: на сервере счётчика нет. */
let cachedFlag: boolean | null = null;
const noopSubscribe = () => () => {};
const clientFlag = () => (cachedFlag ??= readFlag());
const serverFlag = () => false;

function blockLabel(): string {
  const { scenes, activeId } = sceneStore;
  if (!scenes.length || !document.querySelector('section[data-scene]')) return '';
  const index = scenes.findIndex((scene) => scene.id === activeId);
  if (index < 0 || !activeId) return '';
  const percent = Math.round(getSceneProgress(activeId) * 100);
  return `Блок ${index + 1} (${percent}%) ${BLOCK_NAMES[activeId] ?? activeId}`;
}

export function PerfHud() {
  const enabled = useSyncExternalStore(noopSubscribe, clientFlag, serverFlag);
  const fpsRef = useRef<HTMLSpanElement>(null);
  const worstRef = useRef<HTMLSpanElement>(null);
  const blockRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!enabled) return;
    const frames: number[] = [];
    let last = performance.now();
    let lastPaint = 0;
    let raf = 0;
    const loop = (now: number) => {
      frames.push(now - last);
      last = now;
      // Окно в одну секунду: сколько кадров уложилось и какой был самым долгим.
      let total = 0;
      let count = 0;
      let worst = 0;
      for (let i = frames.length - 1; i >= 0 && total < 1000; i -= 1) {
        total += frames[i];
        count += 1;
        worst = Math.max(worst, frames[i]);
      }
      if (frames.length > 400) frames.splice(0, frames.length - 400);
      // Текст обновляется 4 раза в секунду: сам счётчик не должен нагружать страницу.
      if (now - lastPaint > 250) {
        lastPaint = now;
        if (fpsRef.current) fpsRef.current.textContent = `FPS ${Math.round((count * 1000) / Math.max(total, 1))}`;
        if (worstRef.current) {
          worstRef.current.textContent = `${Math.round(worst)} мс`;
          worstRef.current.dataset.bad = worst > 33 ? 'true' : 'false';
        }
        if (blockRef.current) blockRef.current.textContent = blockLabel();
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [enabled]);

  if (!enabled) return null;

  return (
    <div className="perf-hud" aria-hidden="true">
      <span ref={fpsRef}>FPS —</span>
      <span ref={worstRef} className="perf-hud__worst">
        — мс
      </span>
      <span ref={blockRef} className="perf-hud__block" />
    </div>
  );
}
