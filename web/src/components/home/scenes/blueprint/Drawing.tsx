'use client';

import { useId } from 'react';

import { KURAY, KUSKAR_RING } from '@/components/ornament';

import { useScene } from '../../scene-kit';
import { BLUEPRINT_SPOT, RIM_RATIO, spotFor } from './lib/layout';

/** Радиус жетона в единицах чертежа. */
const R = 125;
const R2 = R * RIM_RATIO;
/** Углы восьми узлов: четыре по сторонам света и четыре диагональных. */
const NODE_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];
const KUSKAR_TURNS = Array.from({ length: KUSKAR_RING.count }, (_, i) => (i * 360) / KUSKAR_RING.count);

const LINE = '[vector-effect:non-scaling-stroke]';
const DOTTED = { strokeWidth: 1.25, strokeDasharray: '1 4', strokeLinecap: 'round' } as const;

function polar(angle: number, radius: number): [number, number] {
  const rad = (angle * Math.PI) / 180;
  return [Math.round(Math.cos(rad) * radius * 100) / 100, Math.round(Math.sin(rad) * radius * 100) / 100];
}

/**
 * Чертёж жетона: кромка и ободок пунктиром, рельеф курая и кольцо кускара тонкой линией,
 * узлы с ручками и направляющие по габаритам. Лежит точно поверх медного жетона (те же доли окна).
 * Внешняя обёртка ставит чертёж на место, внутреннюю (.bp-draw) двигает таймлайн сцены.
 */
export function Drawing() {
  const { env } = useScene();
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const spot = spotFor(BLUEPRINT_SPOT, env.mobile);
  // Сторона квадрата чертежа в диаметрах жетона: на телефоне поле уже.
  const k = env.mobile ? 2.3 : 4;
  const half = R * k;
  const fadeH = `bp-fade-h-${uid}`;
  const fadeV = `bp-fade-v-${uid}`;
  const trace = `bp-trace-${uid}`;

  return (
    <div
      className="pointer-events-none absolute aspect-square -translate-x-1/2 -translate-y-1/2"
      style={{ left: `${(0.5 + spot.x) * 100}%`, top: `${(0.5 + spot.y) * 100}%`, width: `${spot.d * k * 100}vw` }}
      aria-hidden="true"
    >
      <div className="bp-draw size-full will-change-transform">
        <svg
          viewBox={`${-half} ${-half} ${half * 2} ${half * 2}`}
          className="block size-full overflow-visible text-fg-soft"
          fill="none"
          stroke="currentColor"
          focusable={false}
        >
          <defs>
            <linearGradient id={fadeH} gradientUnits="userSpaceOnUse" x1={-half} y1={0} x2={half} y2={0}>
              <stop offset="0" stopColor="currentColor" stopOpacity="0" />
              <stop offset="0.28" stopColor="currentColor" stopOpacity="0.7" />
              <stop offset="0.72" stopColor="currentColor" stopOpacity="0.7" />
              <stop offset="1" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
            <linearGradient id={fadeV} gradientUnits="userSpaceOnUse" x1={0} y1={-half} x2={0} y2={half}>
              <stop offset="0" stopColor="currentColor" stopOpacity="0" />
              <stop offset="0.28" stopColor="currentColor" stopOpacity="0.7" />
              <stop offset="0.72" stopColor="currentColor" stopOpacity="0.7" />
              <stop offset="1" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
            <mask id={trace} maskUnits="userSpaceOnUse" x={-half} y={-half} width={half * 2} height={half * 2}>
              <circle
                className="bp-trace"
                r={R}
                stroke="#fff"
                strokeWidth={12}
                pathLength={1}
                strokeDasharray="1 1"
                strokeDashoffset={1}
                transform="rotate(-90)"
              />
            </mask>
          </defs>

          <g {...DOTTED}>
            {[-R, -R2, R2, R].map((y) => (
              <line key={`h${y}`} className={`bp-guide bp-guide-h ${LINE}`} x1={-half} x2={half} y1={y} y2={y} stroke={`url(#${fadeH})`} />
            ))}
            {[-R, -R2, R2, R].map((x) => (
              <line key={`v${x}`} className={`bp-guide bp-guide-v ${LINE}`} x1={x} x2={x} y1={-half} y2={half} stroke={`url(#${fadeV})`} />
            ))}
          </g>

          <g {...DOTTED} strokeOpacity={0.55}>
            {[-24, -12, 12, 24].map((dx) => (
              <circle key={dx} className={`bp-copy ${LINE}`} cx={dx} r={R} />
            ))}
          </g>

          <g mask={`url(#${trace})`} {...DOTTED}>
            <circle className={`bp-rim ${LINE}`} r={R} />
          </g>
          <circle className={`bp-rim2 ${LINE}`} r={R2} {...DOTTED} />

          <g className="bp-relief" strokeWidth={1} strokeOpacity={0.5} strokeLinejoin="round" strokeLinecap="round">
            <g transform={`scale(0.4) translate(${-KUSKAR_RING.size / 2} ${-KUSKAR_RING.size / 2})`}>
              {KUSKAR_TURNS.map((deg) => (
                <g key={deg} transform={`rotate(${deg} ${KUSKAR_RING.size / 2} ${KUSKAR_RING.size / 2})`}>
                  <path className={LINE} d={KUSKAR_RING.line} />
                  <path className={LINE} d={KUSKAR_RING.diamond} />
                </g>
              ))}
            </g>
            <path className={LINE} transform="scale(0.5) translate(-128 -128)" d={KURAY.flower} />
          </g>

          <g className="text-copper-hi">
            {NODE_ANGLES.map((angle) => {
              const [x, y] = polar(angle, R);
              const cardinal = angle % 90 === 0;
              const [tx, ty] = polar(angle + 90, 30);
              return (
                <g key={angle} className={cardinal ? 'bp-node' : 'bp-node bp-node-diag'}>
                  {cardinal ? (
                    <g className="text-fg-soft" stroke="currentColor" strokeWidth={1} strokeOpacity={0.7}>
                      <line className={LINE} x1={x - tx} y1={y - ty} x2={x + tx} y2={y + ty} />
                      <circle cx={x - tx} cy={y - ty} r={2.4} fill="currentColor" stroke="none" />
                      <circle cx={x + tx} cy={y + ty} r={2.4} fill="currentColor" stroke="none" />
                    </g>
                  ) : null}
                  <circle cx={x} cy={y} r={cardinal ? 6 : 4.5} fill="currentColor" stroke="none" />
                </g>
              );
            })}
          </g>
        </svg>
      </div>
    </div>
  );
}
