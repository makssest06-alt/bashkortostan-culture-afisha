import type { CSSProperties } from 'react';
import { KURAY } from './paths';

export type KurayIconProps = {
  /** Сторона квадрата: число в пикселях или любая CSS-длина. По умолчанию 24. */
  size?: number | string;
  /** solid: залитый знак. line: контур для чертежа. */
  variant?: 'solid' | 'line';
  /** Толщина линии контура в единицах поля 256. Работает только для variant="line". */
  strokeWidth?: number;
  /** Цвет. По умолчанию наследуется от текста (currentColor). */
  color?: string;
  /** Показывать кольцо вокруг соцветия. */
  ring?: boolean;
  /** Подпись для скринридера. Без неё знак считается декоративным. */
  title?: string;
  className?: string;
  style?: CSSProperties;
};

/** Соцветие курая из семи лепестков в круге: собственная отрисовка проекта. */
export function KurayIcon({
  size = 24,
  variant = 'solid',
  strokeWidth = 1.5,
  color,
  ring = true,
  title,
  className,
  style,
}: KurayIconProps) {
  const a11y = title ? ({ role: 'img', 'aria-label': title } as const) : ({ 'aria-hidden': true } as const);
  const common = {
    xmlns: 'http://www.w3.org/2000/svg',
    viewBox: KURAY.viewBox,
    width: size,
    height: size,
    className,
    style: color ? { color, ...style } : style,
    focusable: false,
    ...a11y,
  };

  if (variant === 'line') {
    return (
      <svg {...common} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinejoin="round">
        {ring ? (
          <>
            <circle cx={128} cy={128} r={KURAY.ringOuterR} />
            <circle cx={128} cy={128} r={KURAY.ringInnerR} />
          </>
        ) : null}
        <path d={KURAY.flower} />
      </svg>
    );
  }

  return (
    <svg {...common} fill="currentColor">
      {ring ? <path fillRule="evenodd" d={KURAY.ring} /> : null}
      <path d={KURAY.flower} />
    </svg>
  );
}

export default KurayIcon;
