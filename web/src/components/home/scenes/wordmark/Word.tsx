import { useId } from 'react';

import { cn } from '@/lib/cn';

import { BLUEPRINT_SPOT, WORD_WIDTH, spotFor } from '../blueprint/lib/layout';
import { A_POINTS, BOWL, CAP, FONT_SIZE, INK_WIDTH, LETTERS, VIEW } from './glyphs';

const LINE = '[vector-effect:non-scaling-stroke]';
const DOTTED = { strokeWidth: 1.25, strokeDasharray: '1 4', strokeLinecap: 'round' } as const;
const VIEW_BOX = `${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`;

/** Ширина поля SVG в vw, при которой чернильная ширина слова равна нужной доле окна. */
export function wordBoxWidthVw(mobile: boolean): number {
  return (spotFor(WORD_WIDTH, mobile) * 100 * VIEW.w) / INK_WIDTH;
}

/**
 * Кольцо чертежа в единицах слова на стыке со сценой blueprint: радиус жетона и вылет направляющих.
 * Числа те же, что у чертежа в blueprint/Drawing.tsx (поле в 4 диаметра на компьютере и 2,3 на телефоне).
 */
export function handoff(mobile: boolean): { r0: number; guideHalf: number } {
  const spot = spotFor(BLUEPRINT_SPOT, mobile);
  const r0 = ((spot.d / spotFor(WORD_WIDTH, mobile)) * INK_WIDTH) / 2;
  return { r0, guideHalf: r0 * (mobile ? 2.3 : 4) };
}

/** Только буквы: для эхо-копий и для гравировки на жетоне в сцене filters. */
export function WordLetters({ className }: { className?: string }) {
  return (
    <svg viewBox={VIEW_BOX} className={cn('block w-full overflow-visible', className)} aria-hidden="true" focusable={false}>
      <g fill="currentColor" fontSize={FONT_SIZE} fontWeight={600}>
        {LETTERS.map((letter, index) => (
          <text key={index} x={letter.x} y={CAP}>
            {letter.char}
          </text>
        ))}
      </g>
    </svg>
  );
}

function Node({ x, y, tangent, handle, r = 11.5, className }: { x: number; y: number; tangent: 'h' | 'v'; handle: number; r?: number; className?: string }) {
  const dx = tangent === 'h' ? handle : 0;
  const dy = tangent === 'v' ? handle : 0;
  return (
    <g className={className}>
      <g className="wm-handle text-fg-soft" stroke="currentColor" strokeWidth={1} strokeOpacity={0.7}>
        <line className={LINE} x1={x - dx} y1={y - dy} x2={x + dx} y2={y + dy} />
        <circle cx={x - dx} cy={y - dy} r={r * 0.8} fill="currentColor" stroke="none" />
        <circle cx={x + dx} cy={y + dy} r={r * 0.8} fill="currentColor" stroke="none" />
      </g>
      <circle cx={x} cy={y} r={r} fill="currentColor" />
    </g>
  );
}

/**
 * Слово «АФИША» с построением. Буквы это живой текст шрифтом сайта, построение лежит поверх
 * по замерам глифов (./glyphs.ts): овалы чаши «Ф», узлы с ручками, рамки букв, направляющие.
 */
export function Word({ mobile }: { mobile: boolean }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const { guideHalf } = handoff(mobile);
  const fadeH = `wm-fade-h-${uid}`;
  const fadeV = `wm-fade-v-${uid}`;
  const stops = (
    <>
      <stop offset="0" stopColor="currentColor" stopOpacity="0" />
      <stop offset="0.28" stopColor="currentColor" stopOpacity="0.7" />
      <stop offset="0.72" stopColor="currentColor" stopOpacity="0.7" />
      <stop offset="1" stopColor="currentColor" stopOpacity="0" />
    </>
  );

  return (
    <svg viewBox={VIEW_BOX} className="block w-full overflow-visible text-fg-soft" fill="none" aria-hidden="true" focusable={false}>
      <defs>
        <linearGradient id={fadeH} gradientUnits="userSpaceOnUse" x1={VIEW.x} y1={0} x2={VIEW.x + VIEW.w} y2={0}>
          {stops}
        </linearGradient>
        <linearGradient id={fadeV} gradientUnits="userSpaceOnUse" x1={0} y1={BOWL.cy - guideHalf} x2={0} y2={BOWL.cy + guideHalf}>
          {stops}
        </linearGradient>
      </defs>

      {/* Горизонтали: верх прописных, верх и низ чаши, базовая линия. */}
      <g className="wm-build" {...DOTTED}>
        {[0, BOWL.cy - BOWL.ry, BOWL.cy + BOWL.ry, CAP].map((y) => (
          <line key={y} className={`wm-guide-h ${LINE}`} x1={VIEW.x} x2={VIEW.x + VIEW.w} y1={y} y2={y} stroke={`url(#${fadeH})`} />
        ))}
      </g>

      <g className="wm-letters text-fg" fill="currentColor" fontSize={FONT_SIZE} fontWeight={600}>
        {LETTERS.map((letter, index) => (
          <g key={index} className="wm-cell">
            <text className="wm-fill" x={letter.x} y={CAP}>
              {letter.char}
            </text>
          </g>
        ))}
      </g>

      {/* Рамки букв: видны только в момент сборки. */}
      <g className="wm-build" stroke="currentColor" {...DOTTED}>
        {LETTERS.map((letter, index) => (
          <rect
            key={index}
            className={`wm-frame ${LINE}`}
            x={letter.x + letter.left}
            y={letter.top}
            width={letter.right - letter.left}
            height={letter.bottom - letter.top}
          />
        ))}
      </g>

      {/* Эхо кольца, пока оно едет на место «Ф». */}
      <g stroke="currentColor" strokeOpacity={0.6} {...DOTTED}>
        {[0, 1, 2].map((index) => (
          <ellipse key={index} className={`wm-ghost ${LINE}`} cx={BOWL.cx} cy={BOWL.cy} rx={BOWL.rx} ry={BOWL.ry} />
        ))}
      </g>

      {/* Кольцо чертежа: к концу первой трети сцены это чаша буквы «Ф». */}
      <g className="wm-ring wm-build">
        <g {...DOTTED}>
          {[BOWL.cx - BOWL.rx, BOWL.stem[0], BOWL.stem[1], BOWL.cx + BOWL.rx].map((x) => (
            <line key={x} className={`wm-guide-v ${LINE}`} x1={x} x2={x} y1={BOWL.cy - guideHalf} y2={BOWL.cy + guideHalf} stroke={`url(#${fadeV})`} />
          ))}
        </g>
        <g stroke="currentColor" {...DOTTED}>
          <ellipse className={`wm-ring-outer ${LINE}`} cx={BOWL.cx} cy={BOWL.cy} rx={BOWL.rx} ry={BOWL.ry} />
          <ellipse className={`wm-ring-inner ${LINE}`} cx={BOWL.cx} cy={BOWL.cy} rx={BOWL.innerRx} ry={BOWL.innerRy} />
        </g>
        <g className="text-copper-hi">
          <Node className="wm-node" x={BOWL.cx + BOWL.rx} y={BOWL.cy} tangent="v" handle={120} />
          <Node className="wm-node" x={BOWL.cx} y={BOWL.cy + BOWL.ry} tangent="h" handle={120} />
          <Node className="wm-node" x={BOWL.cx - BOWL.rx} y={BOWL.cy} tangent="v" handle={120} />
          <Node className="wm-node" x={BOWL.cx} y={BOWL.cy - BOWL.ry} tangent="h" handle={120} />
          <Node className="wm-node-late" x={BOWL.cx + BOWL.innerRx} y={BOWL.cy} tangent="v" handle={70} r={8} />
          <Node className="wm-node-late" x={BOWL.cx} y={BOWL.cy + BOWL.innerRy} tangent="h" handle={70} r={8} />
          <Node className="wm-node-late" x={BOWL.cx - BOWL.innerRx} y={BOWL.cy} tangent="v" handle={70} r={8} />
          <Node className="wm-node-late" x={BOWL.cx} y={BOWL.cy - BOWL.innerRy} tangent="h" handle={70} r={8} />
        </g>
      </g>

      {/* Узлы на вершинах и опорах двух «А». */}
      <g className="wm-build text-copper-hi">
        {[LETTERS[0], LETTERS[4]].map((letter) =>
          A_POINTS.map(([x, y], index) => (
            <Node key={`${letter.x}-${index}`} className="wm-node-late" x={letter.x + x} y={y} tangent="h" handle={index === 0 ? 110 : 80} r={9} />
          )),
        )}
      </g>
    </svg>
  );
}
