'use client';

/**
 * ВРЕМЕННАЯ заглушка сцены: показывает id, режим, локальный прогресс и одну надпись,
 * которая ездит через useSceneTimeline. Нужна, чтобы цепочка закрепления и скраба
 * работала от начала до конца. Автор сцены заменяет её своим содержимым.
 */

import { useRef } from 'react';

import { useScene, useSceneProgress, useSceneTimeline } from '../../scene-kit';

export type SceneStubProps = {
  /** Рабочая надпись сцены. */
  title: string;
};

export function SceneStub({ title }: SceneStubProps) {
  const { def, layout } = useScene();
  const percent = useRef<HTMLSpanElement>(null);
  const bar = useRef<HTMLSpanElement>(null);

  useSceneProgress((progress) => {
    if (percent.current) percent.current.textContent = `${Math.round(progress * 100)} %`;
    if (bar.current) bar.current.style.transform = `scaleX(${progress.toFixed(4)})`;
  });

  useSceneTimeline(
    (tl, { q, env }) => {
      const shift = env.reduced ? 0 : 36;
      const heading = q('[data-stub-title]');
      if (!layout.pinned) {
        // Сцена-поток: надпись проявляется, пока секция въезжает в окно.
        tl.fromTo(heading, { autoAlpha: 0, y: shift }, { autoAlpha: 1, y: 0, duration: 0.2 }, 0.12);
        return;
      }
      // Первая сцена видна сразу, остальные проявляют надпись после склейки.
      if (layout.index > 0) {
        tl.fromTo(heading, { autoAlpha: 0, y: shift }, { autoAlpha: 1, y: 0, duration: 0.12 }, 0.03);
      }
      tl.to(heading, { autoAlpha: 0, y: -shift, duration: 0.1 }, 0.9);
    },
    [layout.pinned, layout.index],
  );

  const mode = layout.pinned ? `закреплена, ${layout.pinVh} экр.` : 'поток';

  return (
    <div
      className={
        layout.pinned
          ? 'flex h-full flex-col justify-end px-(--gutter) pb-[12vh] md:justify-center md:pb-0 md:pl-[9vw]'
          : 'flex min-h-[80dvh] flex-col justify-center px-(--gutter) py-24 md:pl-[9vw]'
      }
    >
      <p className="t-caps text-fg-muted">
        {def.id} <span className="text-fg-muted/70">/ {mode}</span>
      </p>
      <h2 data-stub-title className="t-title mt-4 max-w-[16ch] text-fg md:max-w-[24vw]">
        {title}
      </h2>
      <p className="mt-8 flex items-center gap-4">
        <span ref={percent} data-num className="t-ui w-[5ch] text-fg-soft">
          0 %
        </span>
        <span className="block h-px w-[min(40vw,220px)] bg-line">
          <span ref={bar} className="block h-px origin-left bg-fg" style={{ transform: 'scaleX(0)' }} />
        </span>
      </p>
    </div>
  );
}
