'use client';

/**
 * Экран загрузки главной: держит страницу, пока не загрузятся шрифты, все картинки сцен и 3D-жетон.
 * Тогда прокрутке нечего догружать, и сцены идут без рывков. Прокрутка на это время заперта.
 *
 * Картинки next/image по умолчанию ленивые (грузятся у края экрана, то есть посреди прокрутки):
 * экран загрузки переводит их в eager и ждёт. Картинки, которые сцены ставят позже (после ответа API),
 * ловит MutationObserver. Если сеть медленная, через MAX_MS экран всё равно уходит.
 */

import { useEffect, useRef, useState } from 'react';

import { getLenis, lockScroll, unlockScroll } from '@/components/shell/scroll';
import { ScrollTrigger } from '@/lib/gsap';
import { useT } from '@/lib/i18n';

import { ASSET_TOKEN, isAssetReady, subscribeAssets } from './preload';
import styles from './Preloader.module.css';

/** Картинки, которые сцены подключают через CSS: браузер не знает о них, пока слой не отрисован. */
const CSS_IMAGES = ['/images/scenes/texture.webp', '/images/scenes/hand.webp'];

/** Экран не мелькает: показываем хотя бы столько. */
const MIN_MS = 900;
/** Сцены с данными ставят картинки после ответа API: столько ждём, прежде чем считать набор полным. */
const SETTLE_MS = 1500;
/** Медленная сеть: дольше не держим. */
const MAX_MS = 15000;

type Phase = 'loading' | 'done' | 'gone';

export function Preloader() {
  const { t } = useT();
  const [phase, setPhase] = useState<Phase>('loading');
  const fill = useRef<HTMLDivElement>(null);
  const percent = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    lockScroll();
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    window.scrollTo(0, 0);
    getLenis()?.scrollTo(0, { immediate: true, force: true });

    const started = performance.now();
    const images = new Set<HTMLImageElement>();
    const loaded = new Set<HTMLImageElement>();
    let finished = false;
    let raf = 0;

    const markLoaded = (img: HTMLImageElement) => loaded.add(img);
    const track = (img: HTMLImageElement) => {
      if (images.has(img)) return;
      images.add(img);
      if (img.loading === 'lazy') img.loading = 'eager';
      if (img.complete) {
        markLoaded(img);
        return;
      }
      const done = () => markLoaded(img);
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', done, { once: true });
    };

    const scan = () => document.querySelectorAll('img').forEach(track);
    scan();
    const observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true });

    for (const src of CSS_IMAGES) {
      const img = new Image();
      img.decoding = 'async';
      img.src = src;
      track(img);
    }

    let fontsReady = false;
    void document.fonts.ready.then(() => {
      fontsReady = true;
    });
    let tokenReady = isAssetReady(ASSET_TOKEN);
    const offAssets = subscribeAssets(() => {
      tokenReady = isAssetReady(ASSET_TOKEN);
    });

    let shown = 0;
    const finish = () => {
      finished = true;
      observer.disconnect();
      offAssets();
      setPhase('done');
      unlockScroll();
      // Пока страница была заперта, полоса прокрутки и размеры могли измениться: закрепления пересчитываются.
      requestAnimationFrame(() => ScrollTrigger.refresh());
      window.setTimeout(() => setPhase('gone'), 700);
    };

    const tick = () => {
      const elapsed = performance.now() - started;
      const imagesPart = images.size ? loaded.size / images.size : 1;
      const complete = (fontsReady && tokenReady && imagesPart >= 1 && elapsed >= SETTLE_MS) || elapsed >= MAX_MS;
      // Доли: шрифты 10 %, жетон 30 %, картинки 60 %. До полной готовности полоса не доходит до конца.
      const target = complete ? 1 : Math.min(0.97, 0.1 * Number(fontsReady) + 0.3 * Number(tokenReady) + 0.6 * imagesPart);
      shown += (target - shown) * (complete ? 0.2 : 0.08);
      fill.current?.style.setProperty('--p', shown.toFixed(4));
      if (percent.current) percent.current.textContent = `${Math.round(shown * 100)} %`;
      if (complete && shown > 0.995 && elapsed >= MIN_MS) {
        finish();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      if (!finished) {
        observer.disconnect();
        offAssets();
        unlockScroll();
      }
    };
  }, []);

  if (phase === 'gone') return null;

  return (
    <div className={styles.root} data-preloader="" data-state={phase} role="status" aria-live="polite" aria-busy={phase === 'loading'}>
      <div className={styles.inner}>
        <span className={`t-wordmark ${styles.wordmark}`}>АФИША</span>
        <span className={styles.caption}>{t('preload.caption')}</span>
        <div className={styles.bar} aria-hidden="true">
          <div ref={fill} className={styles.fill} />
        </div>
        <div className={styles.meta}>
          <span>{t('preload.loading')}</span>
          <span ref={percent} className={styles.percent}>
            0 %
          </span>
        </div>
      </div>
    </div>
  );
}
