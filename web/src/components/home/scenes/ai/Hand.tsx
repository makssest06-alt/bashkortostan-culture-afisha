'use client';

import { useId } from 'react';
import type { CSSProperties } from 'react';

import { useSceneEnv } from '../../scene-kit';
import { aiRest } from './slot';

/**
 * Рука под жетоном: подложка сцены ai (лежит ПОД холстом жетона).
 *
 * Фотография руки снята на чёрном. Наложение screen здесь не сработает: слой подложек это свой
 * контекст наложения, смешиваться в нём не с чем. Поэтому чёрное убирает маска по яркости,
 * а цвет даёт медная заливка под маской.
 *
 * Маска сделана элементом SVG <mask>, а не CSS mask-mode: luminance. В WebKit (Safari и все браузеры
 * на iOS) CSS-маска по яркости с картинкой молча становится маской по прозрачности, как только её
 * рисуют узором крупнее предела плитки: 512x512 px на iOS, 2048x2048 на macOS (WebKit bug 282530).
 * Фотография непрозрачна, поэтому вместо руки на весь экран вставала медная заливка. SVG <mask>
 * считает яркость в своём буфере и одинаково работает в Chrome, Safari и Firefox.
 *
 * Картинка временная. Рука нарочно приглушена и растворяется книзу, за строкой запроса её почти не видно.
 *
 * Размер и место привязаны к жетону: кисть чуть шире жетона, пальцы уходят за его нижний край,
 * большой палец остаётся слева снизу. --d диаметр жетона, --cy высота его центра.
 * Кисть на фотографии: кончики пальцев на 39,7 % высоты кадра, ложбина между большим пальцем
 * и остальными на 46,7 % ширины (она встаёт под центр жетона).
 *
 * Слоёв заливки два: маска по яркости даёт прозрачность не выше яркости кожи на снимке, один слой слишком бледен.
 */
const HAND_SRC = '/images/scenes/hand.webp';

/**
 * Медная заливка: те же цвета, что у прежнего CSS-градиента oklch(0.86 0.11 55) 34 %,
 * oklch(0.7 0.15 46) 52 %, oklch(0.5 0.13 39) 78 %. Браузер вёл его в Oklab, SVG ведёт градиент в sRGB,
 * поэтому промежуточные точки посчитаны в Oklab заранее.
 */
const COPPER_STOPS: readonly (readonly [number, string])[] = [
  [0.34, '#ffbe8a'],
  [0.385, '#ffae79'],
  [0.43, '#f99d69'],
  [0.475, '#f18d58'],
  [0.52, '#e97d46'],
  [0.585, '#d66e3d'],
  [0.65, '#c36034'],
  [0.715, '#b1512c'],
  [0.78, '#9f4323'],
];

const LUMINANCE: CSSProperties = { maskType: 'luminance' };

export function Hand() {
  const env = useSceneEnv();
  const rest = aiRest(env);
  const vars = {
    '--d': `${(rest.scale * 100).toFixed(2)}vw`,
    '--cy': `${((0.5 + rest.y) * 100).toFixed(2)}%`,
  } as CSSProperties;
  // Идентификатор идёт в url(#...): только латиница, цифры и дефис.
  const uid = `ai-hand-${useId().replace(/[^a-zA-Z0-9-]/g, '')}`;

  return (
    <div
      className="absolute inset-0 min-h-[100lvh] [mask-image:linear-gradient(to_bottom,#000_52%,rgb(0_0_0/0.28)_84%)]"
      style={vars}
      data-ai-hand=""
    >
      <div className="ai-hand invisible absolute top-[calc(var(--cy)_-_var(--d)_*_2.315)] left-[calc(50%_-_var(--d)_*_2.111)] aspect-[3/4] w-[calc(var(--d)_*_4.524)] will-change-transform">
        <svg
          className="absolute inset-0 block size-full"
          viewBox="0 0 3 4"
          preserveAspectRatio="none"
          aria-hidden="true"
          focusable="false"
        >
          <defs>
            <linearGradient id={`${uid}-copper`} x1="0" y1="0" x2="0" y2="1">
              {COPPER_STOPS.map(([offset, color]) => (
                <stop key={offset} offset={offset} stopColor={color} />
              ))}
            </linearGradient>
            <mask id={`${uid}-mask`} maskUnits="userSpaceOnUse" x="0" y="0" width="3" height="4" style={LUMINANCE}>
              <image href={HAND_SRC} x="0" y="0" width="3" height="4" preserveAspectRatio="none" />
            </mask>
          </defs>
          <rect width="3" height="4" fill={`url(#${uid}-copper)`} mask={`url(#${uid}-mask)`} />
          <rect width="3" height="4" fill={`url(#${uid}-copper)`} mask={`url(#${uid}-mask)`} />
        </svg>
      </div>
    </div>
  );
}
