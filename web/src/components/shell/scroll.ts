/**
 * Доступ к плавной прокрутке вне React: блокировка прокрутки под оверлеем и переход к якорю.
 * Экземпляр Lenis создаёт SmoothScroll. При «меньше движения» его нет: функции работают и без него.
 */

import type Lenis from 'lenis';

let lenis: Lenis | null = null;
let locks = 0;

export function setLenis(instance: Lenis | null): void {
  lenis = instance;
  if (instance && locks > 0) instance.stop();
}

export function getLenis(): Lenis | null {
  return lenis;
}

/** Запретить прокрутку страницы (открыт оверлей). Вызовы считаются: сколько раз заперли, столько и отпереть. */
export function lockScroll(): void {
  locks += 1;
  if (locks > 1) return;
  lenis?.stop();
  document.documentElement.style.overflow = 'hidden';
}

export function unlockScroll(): void {
  if (locks === 0) return;
  locks -= 1;
  if (locks > 0) return;
  document.documentElement.style.overflow = '';
  lenis?.start();
}

/** Прокрутить к элементу или к позиции: плавно через Lenis, без него сразу. */
export function scrollToTarget(target: number | string | HTMLElement, options: { immediate?: boolean } = {}): void {
  if (lenis) {
    lenis.scrollTo(target, { immediate: options.immediate });
    return;
  }
  if (typeof target === 'number') {
    window.scrollTo({ top: target });
    return;
  }
  const node = typeof target === 'string' ? document.querySelector(target) : target;
  node?.scrollIntoView();
}
