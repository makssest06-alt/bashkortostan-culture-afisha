'use client';

/**
 * Жетон главной: фиксированный слой на весь экран между фоном и текстом сцен.
 * Позу каждый кадр берёт из стора (getTokenPose) и плавно ведёт к ней объект.
 *
 * Режимы:
 *   webgl  холст R3F (подгружается динамически, без SSR);
 *   css    плоский медный диск на CSS: при «меньше движения», без WebGL, на слабом устройстве
 *          и если холст упал. Диск ведёт та же поза (место, размер, прозрачность), вращения нет.
 *
 * Для отладки режим можно задать в адресе: /?token=css или /?token=webgl.
 */

import dynamic from 'next/dynamic';
import { Component, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';

import { ASSET_TOKEN, markAssetReady } from '@/components/home/preload';
import { usePrefersReducedMotion } from '@/lib/motion';

import { getSceneEnv, subscribeEnv } from './env';
import { getTokenPose, subscribe } from './store';

const TokenCanvasGL = dynamic(() => import('./TokenCanvasGL'), { ssr: false, loading: () => null });

type RenderMode = 'pending' | 'webgl' | 'css';

/** Диаметр заглушки в CSS: 20vw. Масштаб считается от него. */
const FALLBACK_BASE = 0.2;

function detectMode(): Exclude<RenderMode, 'pending'> {
  const forced = new URLSearchParams(window.location.search).get('token');
  if (forced === 'css' || forced === 'webgl') return forced;

  const nav = navigator as Navigator & { deviceMemory?: number };
  // Слабое устройство: мало ядер или памяти. 3D ему не по силам, хватит плоского диска.
  if ((nav.hardwareConcurrency ?? 8) <= 2 || (nav.deviceMemory ?? 8) <= 2) return 'css';

  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!context) return 'css';
    context.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    return 'css';
  }
  return 'webgl';
}

const noopSubscribe = () => () => {};
let detected: Exclude<RenderMode, 'pending'> | null = null;

function useDetectedMode(): RenderMode {
  return useSyncExternalStore<RenderMode>(
    noopSubscribe,
    () => (detected ??= detectMode()),
    () => 'pending',
  );
}

class CanvasBoundary extends Component<{ onFail: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    if (process.env.NODE_ENV !== 'production') console.warn('[token] холст WebGL не запустился', error);
    this.props.onFail();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function TokenFallback() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const apply = () => {
      const env = getSceneEnv();
      const pose = getTokenPose(env);
      const scale = Math.max(pose.scale, 0.0001) / FALLBACK_BASE;
      node.style.transform = `translate3d(${(pose.x * env.w).toFixed(1)}px, ${(pose.y * env.h).toFixed(1)}px, 0) scale(${scale.toFixed(4)})`;
      node.style.opacity = pose.opacity.toFixed(3);
      node.dataset.mode = pose.mode ?? 'solid';
    };
    apply();
    const offStore = subscribe(apply);
    const offEnv = subscribeEnv(apply);
    return () => {
      offStore();
      offEnv();
    };
  }, []);

  useEffect(() => markAssetReady(ASSET_TOKEN), []);

  return <div ref={ref} className="token-fallback" />;
}

export function TokenCanvas() {
  const detectedMode = useDetectedMode();
  const reduced = usePrefersReducedMotion();
  const [failed, setFailed] = useState(false);

  const mode: RenderMode = detectedMode === 'pending' ? 'pending' : failed || reduced ? 'css' : detectedMode;

  return (
    <div className="token-layer" aria-hidden="true" data-token-mode={mode}>
      {mode === 'webgl' ? (
        <CanvasBoundary onFail={() => setFailed(true)}>
          <TokenCanvasGL onFail={() => setFailed(true)} />
        </CanvasBoundary>
      ) : null}
      {mode === 'css' ? <TokenFallback /> : null}
    </div>
  );
}
