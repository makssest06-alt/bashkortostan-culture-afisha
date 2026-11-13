'use client';

import { useEffect, useRef } from 'react';

import { cn } from '@/lib/cn';

import styles from './trust.module.css';

export type LinesProps = {
  text: string;
  className?: string;
  /** Пересчитать строки при смене ширины окна. */
  width: number;
};

/** Задержка строки и время, за которое строка проявляется слева направо, мс (референс: 0,07 с на строку). */
const LINE_STEP_MS = 75;
const LINE_SWEEP_MS = 70;

/**
 * Абзац, который проявляется построчно слева направо, когда предок получает data-texts.
 * Текст разбит на слова; после вёрстки каждое слово узнаёт свою строку и место в ней
 * и получает задержку перехода. Для чтения с экрана абзац остаётся обычным текстом.
 */
export function Lines({ text, className, width }: LinesProps) {
  const ref = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const assign = () => {
      const words = Array.from(node.querySelectorAll<HTMLElement>('[data-word]'));
      const total = node.clientWidth || 1;
      const origin = node.getBoundingClientRect().left;
      let line = -1;
      let lastTop = Number.NaN;
      for (const word of words) {
        const rect = word.getBoundingClientRect();
        if (Number.isNaN(lastTop) || Math.abs(rect.top - lastTop) > rect.height * 0.5) {
          line += 1;
          lastTop = rect.top;
        }
        const along = Math.min(1, Math.max(0, (rect.left - origin) / total));
        word.style.setProperty('--delay', `${Math.round(line * LINE_STEP_MS + along * LINE_SWEEP_MS)}ms`);
      }
    };

    assign();
    let cancelled = false;
    void document.fonts?.ready.then(() => {
      if (!cancelled) assign();
    });
    return () => {
      cancelled = true;
    };
  }, [text, width]);

  const words = text.split(/\s+/).filter(Boolean);

  return (
    <p ref={ref} className={cn(styles.lines, className)}>
      {words.map((word, index) => (
        <span key={`${index}-${word}`} data-word className={styles.word}>
          {word}
          {index < words.length - 1 ? ' ' : ''}
        </span>
      ))}
    </p>
  );
}
