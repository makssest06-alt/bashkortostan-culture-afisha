import { gsap } from '@/lib/gsap';

/**
 * Перебор случайных символов в мелкой подписи: строка «набирается» слева направо и так же рассыпается.
 * Идёт по времени, запускается порогом прокрутки (в референсе так ведут себя все мелкие прописные).
 *
 * Узел должен быть помечен aria-hidden, а настоящий текст лежать рядом для чтения с экрана:
 * во время перебора в узле временно стоит мусор.
 */

const GLYPHS = 'АБВГДЕЖИКЛМНОПРСТУФХЦЧШЭЮЯ0123456789#%*+=/<>';
/** Сколько случайных знаков бежит перед набранной частью строки. */
const TAIL = 3;

function noise(length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) out += GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
  return out;
}

export type Scramble = {
  /** Показать строку. instant: без перебора (первый кадр, «меньше движения»). */
  show: (instant?: boolean) => void;
  /** Спрятать строку. */
  hide: (instant?: boolean) => void;
  kill: () => void;
};

export type ScrambleOptions = {
  /** Секунд на всю строку. По умолчанию зависит от длины: 0.16-0.32 с. */
  duration?: number;
  /** Задержка перед показом, секунд: для строк, которые идут одна за другой. */
  delay?: number;
};

export function createScramble(node: HTMLElement, text: string, options: ScrambleOptions = {}): Scramble {
  const state = { t: 1 };
  let shown = true;
  let tween: gsap.core.Tween | null = null;
  const duration = options.duration ?? gsap.utils.clamp(0.16, 0.32, text.length * 0.012);

  const render = () => {
    const done = Math.round(state.t * text.length);
    // Спрятанная строка держит свой текст (невидимо): блок не схлопывается и не двигает соседей,
    // а замеры вёрстки (зазор под жетон в сцене ai) не меняются от показа подписи.
    if (done >= text.length || state.t <= 0) {
      node.textContent = text;
    } else {
      const tail = Math.min(TAIL, text.length - done);
      node.textContent = text.slice(0, done) + noise(tail);
    }
    node.style.opacity = state.t <= 0 ? '0' : '1';
  };

  const run = (target: 0 | 1, instant: boolean, delay: number) => {
    tween?.kill();
    tween = null;
    if (instant) {
      state.t = target;
      render();
      return;
    }
    tween = gsap.to(state, {
      t: target,
      duration: duration * Math.abs(target - state.t),
      delay,
      ease: 'none',
      onUpdate: render,
      onComplete: render,
    });
  };

  return {
    // Сцена зовёт show и hide на каждом шаге прокрутки: повторный вызов не должен перезапускать перебор.
    show(instant = false) {
      if (shown) return;
      shown = true;
      run(1, instant, options.delay ?? 0);
    },
    hide(instant = false) {
      if (!shown) return;
      shown = false;
      run(0, instant, 0);
    },
    kill() {
      tween?.kill();
      tween = null;
      node.textContent = text;
      node.style.opacity = '';
    },
  };
}
