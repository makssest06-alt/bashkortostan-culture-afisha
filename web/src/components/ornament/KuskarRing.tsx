import type { CSSProperties } from 'react';
import { KUSKAR_RING } from './paths';

export type KuskarRingProps = {
  /** Сторона квадрата: число в пикселях или любая CSS-длина. По умолчанию 160. */
  size?: number | string;
  /** Цвет. По умолчанию наследуется от текста (currentColor). */
  color?: string;
  /** Подпись для скринридера. Без неё кольцо считается декоративным. */
  title?: string;
  className?: string;
  style?: CSSProperties;
};

const CENTER = KUSKAR_RING.size / 2;
const TURNS = Array.from({ length: KUSKAR_RING.count }, (_, i) => (i * 360) / KUSKAR_RING.count);

/** Двенадцать мотивов кускар по окружности: ободок жетона, рамка круглых плашек. */
export function KuskarRing({ size = 160, color, title, className, style }: KuskarRingProps) {
  const a11y = title ? ({ role: 'img', 'aria-label': title } as const) : ({ 'aria-hidden': true } as const);
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${KUSKAR_RING.size} ${KUSKAR_RING.size}`}
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={KUSKAR_RING.strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={color ? { color, ...style } : style}
      focusable={false}
      {...a11y}
    >
      {TURNS.map((deg) => (
        <g key={deg} transform={`rotate(${deg} ${CENTER} ${CENTER})`}>
          <path d={KUSKAR_RING.line} />
          <path d={KUSKAR_RING.diamond} fill="currentColor" stroke="none" />
        </g>
      ))}
    </svg>
  );
}

export default KuskarRing;
