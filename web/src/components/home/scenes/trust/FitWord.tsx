'use client';

import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

import styles from './trust.module.css';

export type FitWordProps = {
  /** Слово одной строкой. */
  text: string;
  /** Ширина окна: при её смене кегль подгоняется заново. */
  width: number;
  className?: string;
  wordClassName?: string;
  /** Содержимое, которое живёт в единицах кегля слова (подпись над буквами). */
  children?: ReactNode;
};

/**
 * Гигантское слово во всю ширину своего блока: кегль подгоняется под ширину блока.
 * В референсе слово занимает 92,4 % ширины окна; у «достоверность» другие ширины букв,
 * поэтому кегль не задан числом, а считается из замера (video-part-3, раздел 3.4).
 * До замера работает оценка из CSS (--fit-guess), так что на сервере слово уже близко к месту.
 */
export function FitWord({ text, width, className, wordClassName, children }: FitWordProps) {
  const box = useRef<HTMLDivElement>(null);
  const word = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const boxNode = box.current;
    const wordNode = word.current;
    if (!boxNode || !wordNode) return;

    const fit = () => {
      const target = boxNode.clientWidth;
      const natural = wordNode.getBoundingClientRect().width;
      const size = Number.parseFloat(getComputedStyle(wordNode).fontSize);
      if (target > 0 && natural > 0 && size > 0) {
        boxNode.style.setProperty('--fit', `${((size * target) / natural).toFixed(2)}px`);
      }
    };

    fit();
    let cancelled = false;
    // Шрифт подгружается позже вёрстки: после него ширина слова другая.
    void document.fonts?.ready.then(() => {
      if (!cancelled) fit();
    });
    return () => {
      cancelled = true;
    };
  }, [text, width]);

  return (
    <div ref={box} className={cn(styles.fit, className)}>
      {children}
      <h2 className={cn(styles.fitHeading, wordClassName)}>
        <span ref={word} className="inline-block">
          {text}
        </span>
      </h2>
    </div>
  );
}
