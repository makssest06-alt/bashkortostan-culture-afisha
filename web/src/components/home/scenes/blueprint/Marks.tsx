import { cn } from '@/lib/cn';

/**
 * Пометки «от руки» у чертежа: собственная отрисовка неровным штрихом.
 * Сверху стопка из трёх дисков с выносками, слева снизу пересекающиеся окружности.
 */

/** Детерминированный генератор: один и тот же рисунок на сервере и в браузере. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round = (value: number) => Math.round(value * 10) / 10;

/** Эллипс, обведённый рукой: дрожащий радиус и перехлёст в конце штриха. */
function sketchEllipse(cx: number, cy: number, rx: number, ry: number, seed: number): string {
  const random = mulberry32(seed);
  const steps = 14;
  const turns = 1.12;
  const points: [number, number][] = [];
  for (let i = 0; i <= steps; i += 1) {
    const angle = -Math.PI * 0.6 + (i / steps) * Math.PI * 2 * turns;
    const wobble = 1 + (random() - 0.5) * 0.09 + (i / steps) * 0.03;
    points.push([cx + Math.cos(angle) * rx * wobble, cy + Math.sin(angle) * ry * wobble]);
  }
  // Сглаживание через точки (Катмулл-Ром в кубические кривые).
  let d = `M${round(points[0][0])} ${round(points[0][1])}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[Math.max(i - 1, 0)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(i + 2, points.length - 1)];
    const c1: [number, number] = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: [number, number] = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${round(c1[0])} ${round(c1[1])} ${round(c2[0])} ${round(c2[1])} ${round(p2[0])} ${round(p2[1])}`;
  }
  return d;
}

const STACK = [
  { d: sketchEllipse(70, 34, 58, 15, 11), leader: 'M132 32C150 27 166 30 184 26' },
  { d: sketchEllipse(72, 82, 60, 16, 23), leader: 'M136 82C152 86 168 80 186 83' },
  { d: sketchEllipse(69, 130, 59, 15, 37), leader: 'M132 132C150 139 166 133 184 138' },
];
const STACK_SIDES = 'M12 36C10 68 13 100 11 130M128 34C131 66 127 98 129 130';
const VENN = [sketchEllipse(60, 64, 44, 44, 51), sketchEllipse(104, 58, 40, 40, 67), sketchEllipse(84, 96, 38, 38, 83)];
const UNDERLINE = 'M2 6C30 2 60 9 96 4C120 1 150 8 178 3';

const INK = 'text-[oklch(0.64_0.16_25)]';
const HAND = 'text-[oklch(0.8_0.1_30)]';

/**
 * Телефон: места пометок. Верхняя пара по углам под «пилюлей». Нижняя пара по бокам от чертежа на высоте
 * его центра (40 % экрана, радиус 20 % ширины: BLUEPRINT_SPOT.mobile), ширина ограничена полем до кромки.
 * Раньше нижняя пара стояла на 60 % высоты и на низком экране (390x664, 375x667) уходила под матовую
 * панель и просвечивала сквозь стекло; над панелью она легла бы на окружность чертежа.
 */
const MOBILE_SPOTS = [
  'left-(--gutter) top-[21%] max-w-[40vw]',
  'right-(--gutter) top-[21%] max-w-[40vw] text-right',
  'left-(--gutter) top-[40%] max-w-[calc(30vw-var(--gutter)-0.5rem)] -translate-y-1/2',
  'right-(--gutter) top-[40%] max-w-[calc(30vw-var(--gutter)-0.5rem)] -translate-y-1/2 text-right',
];

export function Marks({ marks, mobile }: { marks: readonly string[]; mobile: boolean }) {
  const stackLabels = marks.slice(0, 3);
  const restLabels = marks.slice(3);

  if (mobile) {
    // На телефоне эскизам нет места: пометки встают подписями вокруг чертежа.
    return (
      <ul className={cn('pointer-events-none absolute inset-0', HAND)}>
        {marks.slice(0, 4).map((mark, index) => (
          <li key={mark} className={cn('bp-mark absolute text-[0.8125rem] leading-tight font-medium', MOBILE_SPOTS[index])}>
            <span className={cn('inline-block', index % 2 === 0 ? '-rotate-3' : 'rotate-2')}>{mark}</span>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="pointer-events-none absolute inset-0">
      <div className="bp-mark absolute top-[7%] left-[45.5%] w-[19vw]">
        <svg viewBox="0 0 190 150" className={cn('block w-[11.4vw] overflow-visible', INK)} fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" aria-hidden="true" focusable={false}>
          {STACK.map((item) => (
            <g key={item.d}>
              <path d={item.d} />
              <path d={item.leader} strokeWidth={1} />
            </g>
          ))}
          <path d={STACK_SIDES} strokeWidth={1} strokeOpacity={0.7} />
        </svg>
        <ul className={cn('absolute top-0 left-[11.8vw] flex h-full flex-col justify-between py-[0.2vw] text-[clamp(12px,0.95vw,17px)] leading-none font-medium whitespace-nowrap', HAND)}>
          {stackLabels.map((mark, index) => (
            <li key={mark}>
              <span className={cn('inline-block', index === 1 ? 'rotate-1' : '-rotate-2')}>{mark}</span>
            </li>
          ))}
        </ul>
      </div>

      {restLabels.length > 0 ? (
        <div className="bp-mark absolute top-[63%] left-[34.5%] flex items-end gap-[1vw]">
          <svg viewBox="0 0 150 140" className={cn('block w-[9.6vw] overflow-visible', INK)} fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" aria-hidden="true" focusable={false}>
            {VENN.map((d) => (
              <path key={d} d={d} />
            ))}
          </svg>
          <ul className={cn('mb-[1.2vw] text-[clamp(12px,0.95vw,17px)] leading-tight font-medium', HAND)}>
            {restLabels.map((mark) => (
              <li key={mark} className="-rotate-2">
                <span className="block whitespace-nowrap">{mark}</span>
                <svg viewBox="0 0 180 10" className={cn('mt-1 block w-full overflow-visible', INK)} fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" preserveAspectRatio="none" aria-hidden="true" focusable={false}>
                  <path d={UNDERLINE} />
                </svg>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
