'use client';

/**
 * Плавная прокрутка: Lenis на тикере GSAP, ScrollTrigger обновляется на каждом её шаге.
 * При prefers-reduced-motion не включается: остаётся обычная прокрутка браузера.
 */

import Lenis from 'lenis';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

import { gsap, ScrollTrigger } from '@/lib/gsap';
import { usePrefersReducedMotion } from '@/lib/motion';

import { getLenis, setLenis } from './scroll';

export function SmoothScroll() {
  const reduced = usePrefersReducedMotion();
  const pathname = usePathname();

  useEffect(() => {
    if (reduced) return;

    const lenis = new Lenis({ autoRaf: false, lerp: 0.1, anchors: true });
    setLenis(lenis);
    lenis.on('scroll', ScrollTrigger.update);

    const tick = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);

    return () => {
      gsap.ticker.remove(tick);
      gsap.ticker.lagSmoothing(500, 33);
      lenis.destroy();
      setLenis(null);
    };
  }, [reduced]);

  // Шрифт подключён через swap: после его загрузки ширины строк меняются, закрепления надо пересчитать.
  useEffect(() => {
    let cancelled = false;
    void document.fonts.ready.then(() => {
      if (!cancelled) ScrollTrigger.refresh();
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Новая страница: Next уже поставил прокрутку куда нужно, Lenis должен принять это положение.
  useEffect(() => {
    const lenis = getLenis();
    if (!lenis) return;
    lenis.resize();
    lenis.scrollTo(window.scrollY, { immediate: true, force: true });
  }, [pathname]);

  return null;
}
