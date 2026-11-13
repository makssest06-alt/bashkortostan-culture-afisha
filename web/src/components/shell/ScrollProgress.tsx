'use client';

/**
 * Полоса прогресса у правого края: светлая вертикальная планка длиной около 28 % высоты окна,
 * едет сверху вниз по общему прогрессу страницы. Заменяет системную полосу прокрутки.
 * Тот же прогресс уходит в стор сцен (sceneStore.pageProgress, subscribePage).
 */

import { usePathname } from 'next/navigation';
import { useRef } from 'react';

import { setPageProgress } from '@/components/home/scene-kit/store';
import { ScrollTrigger, useGSAP } from '@/lib/gsap';

/** Ход планки в процентах её собственной высоты: дорожка 100 %, планка 28,7 % дорожки. */
const TRAVEL_PERCENT = ((100 - 28.7) / 28.7) * 100;

export function ScrollProgress() {
  const track = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  useGSAP(
    () => {
      const trackNode = track.current;
      const barNode = bar.current;
      if (!trackNode || !barNode) return;

      const apply = (self: ScrollTrigger) => {
        barNode.style.transform = `translate3d(0, ${(self.progress * TRAVEL_PERCENT).toFixed(2)}%, 0)`;
        setPageProgress(self.progress);
      };

      ScrollTrigger.create({
        start: 0,
        end: 'max',
        onUpdate: apply,
        onRefresh: (self) => {
          // Страница короче окна: прокручивать нечего, планка не нужна.
          trackNode.toggleAttribute('data-idle', ScrollTrigger.maxScroll(window) <= 1);
          apply(self);
        },
      });

      return () => setPageProgress(0);
    },
    { dependencies: [pathname], revertOnUpdate: true },
  );

  return (
    <div ref={track} className="scroll-progress" aria-hidden="true">
      <div ref={bar} className="scroll-progress__bar" />
    </div>
  );
}
