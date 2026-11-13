import type { CSSProperties } from 'react';
import { KUSKAR_BORDER } from './paths';

export type KuskarBorderProps = {
  /** Высота полосы в пикселях. По умолчанию 24. Вариант lock читается от 24, row от 16. */
  height?: number;
  /** Цвет узора. По умолчанию наследуется от текста (currentColor). */
  color?: string;
  /** lock: встречные мотивы в замок (плотная кайма). row: мотивы в ряд (лёгкий разделитель). */
  variant?: keyof typeof KUSKAR_BORDER;
  className?: string;
  style?: CSSProperties;
};

type Tile = (typeof KUSKAR_BORDER)[keyof typeof KUSKAR_BORDER];

// Раппорт как маска: узор красится через background-color, поэтому работает currentColor.
// Картинка вшита в data URI, запросов к серверу нет.
function tileMask(tile: Tile): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${tile.width} ${tile.height}" fill="none" stroke="#000" ` +
    `stroke-width="${tile.strokeWidth}" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="${tile.line}"/><path d="${tile.diamond}" fill="#000" stroke="none"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

const MASKS = {
  lock: tileMask(KUSKAR_BORDER.lock),
  row: tileMask(KUSKAR_BORDER.row),
} as const;

/** Бесшовный горизонтальный бордюр из мотива кускар: разделитель секций. Декоративный, скрыт от скринридеров. */
export function KuskarBorder({ height = 24, color = 'currentColor', variant = 'lock', className, style }: KuskarBorderProps) {
  const tile = KUSKAR_BORDER[variant];
  // Ширина раппорта округляется до целого пикселя: так стыки плиток не дают волосяных швов.
  const tileWidth = Math.max(1, Math.round((height * tile.width) / tile.height));
  const mask = MASKS[variant];
  const maskSize = `${tileWidth}px ${height}px`;
  return (
    <div
      aria-hidden="true"
      className={className}
      style={{
        width: '100%',
        height,
        backgroundColor: color,
        maskImage: mask,
        WebkitMaskImage: mask,
        maskRepeat: 'repeat-x',
        WebkitMaskRepeat: 'repeat-x',
        maskPosition: 'center',
        WebkitMaskPosition: 'center',
        maskSize,
        WebkitMaskSize: maskSize,
        ...style,
      }}
    />
  );
}

export default KuskarBorder;
