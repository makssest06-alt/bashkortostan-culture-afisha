'use client';

/**
 * Окружение сцен: размер окна, признак телефона и «меньше движения».
 * Одно значение на всю страницу. Меняется на ресайзе (с задержкой 180 мс) и при смене системной настройки.
 * На телефоне смена одной только высоты (панель адреса) окружение не трогает.
 */

import { useSyncExternalStore } from 'react';

import { REDUCED_MOTION_QUERY } from '@/lib/motion';

import type { SceneEnv } from './types';

/** Ширина, с которой начинается компьютерная раскладка. Совпадает с md в Tailwind и с CSS сцен. */
export const MOBILE_BREAKPOINT = 768;

/** Окружение для сервера и первого кадра после гидратации. Пока оно в силе, сцены не запускают движение. */
export const SERVER_ENV: SceneEnv = Object.freeze({ w: 1440, h: 810, mobile: false, reduced: false });

const RESIZE_DELAY_MS = 180;

let current: SceneEnv = SERVER_ENV;
let started = false;
const listeners = new Set<() => void>();

function read(): SceneEnv {
  const w = window.innerWidth;
  const h = window.innerHeight;
  return {
    w,
    h,
    mobile: w < MOBILE_BREAKPOINT,
    reduced: window.matchMedia(REDUCED_MOTION_QUERY).matches,
  };
}

function update(force: boolean): void {
  const next = read();
  if (!force && next.w === current.w && next.mobile === current.mobile && next.reduced === current.reduced) {
    if (next.h === current.h) return;
    // Панель адреса на телефоне меняет только высоту: это не повод пересобирать сцены.
    if (window.matchMedia('(pointer: coarse)').matches) return;
  }
  current = next;
  for (const listener of listeners) listener();
}

function start(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  current = read();
  let timer: number | undefined;
  window.addEventListener(
    'resize',
    () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => update(false), RESIZE_DELAY_MS);
    },
    { passive: true },
  );
  window.addEventListener('orientationchange', () => update(true), { passive: true });
  window.matchMedia(REDUCED_MOTION_QUERY).addEventListener('change', () => update(true));
}

/** Подписка на смену окружения вне React. Возвращает функцию отписки. */
export function subscribeEnv(listener: () => void): () => void {
  start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Текущее окружение. На сервере отдаёт SERVER_ENV. */
export function getSceneEnv(): SceneEnv {
  start();
  return current;
}

/** Окружение как состояние React. В первом кадре после гидратации равно SERVER_ENV. */
export function useSceneEnv(): SceneEnv {
  return useSyncExternalStore(subscribeEnv, getSceneEnv, () => SERVER_ENV);
}
