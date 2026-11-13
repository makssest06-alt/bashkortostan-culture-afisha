/**
 * Перебор случайных символов в мелкой подписи: по времени, запуск по порогу прокрутки.
 * Буквы открываются слева направо за duration мс, неоткрытые места мигают знаками из самой строки.
 * Пишет прямо в textContent, без состояния React. Возвращает функцию остановки.
 */

const FRAME_MS = 1000 / 14;

export function scrambleText(node: HTMLElement, text: string, duration = 380): () => void {
  const letters = Array.from(new Set(text.replace(/[\s,.:]/g, '')));
  if (letters.length === 0 || typeof window === 'undefined') {
    node.textContent = text;
    return () => {};
  }

  const chars = Array.from(text);
  const started = performance.now();
  let raf = 0;
  let lastDraw = -Infinity;

  const draw = (now: number) => {
    const progress = Math.min(1, (now - started) / duration);
    if (progress >= 1) {
      node.textContent = text;
      return;
    }
    // Знаки меняются около 14 раз в секунду, как в референсе, а не на каждом кадре.
    if (now - lastDraw >= FRAME_MS) {
      lastDraw = now;
      const open = Math.floor(progress * chars.length);
      node.textContent = chars
        .map((char, index) => {
          if (index < open || /[\s,.:]/.test(char)) return char;
          return letters[Math.floor(Math.random() * letters.length)];
        })
        .join('');
    }
    raf = window.requestAnimationFrame(draw);
  };

  raf = window.requestAnimationFrame(draw);
  return () => {
    window.cancelAnimationFrame(raf);
    node.textContent = text;
  };
}
