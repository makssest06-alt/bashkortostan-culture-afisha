import type { Ref } from 'react';

export type GlowBackgroundProps = {
  /** Яркость свечения 0..1. На внутренних страницах свечение спокойнее, чем на главной. */
  intensity?: number;
  /** Узел слоя свечения: главная меняет его opacity по ходу сцен. */
  litRef?: Ref<HTMLDivElement>;
};

/**
 * Фиксированный фон: тёплый почти чёрный и оранжевая полоса свечения вдоль левого края.
 * Стили лежат в globals.css (.glow-bg). Компонент без хуков: годится и для серверных страниц.
 */
export function GlowBackground({ intensity = 1, litRef }: GlowBackgroundProps) {
  return (
    <div className="glow-bg" aria-hidden="true">
      <div ref={litRef} className="glow-bg__lit" style={{ opacity: intensity }} />
    </div>
  );
}
