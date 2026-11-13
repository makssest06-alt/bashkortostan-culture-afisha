import { Fragment } from 'react';

import { cn } from '@/lib/cn';

/**
 * Текст, разбитый для движения. Разметку целиком держит React: при смене языка строки
 * перерисовываются обычным образом, GSAP получает уже готовые узлы.
 */

export type SplitCharsProps = {
  text: string;
  /** Класс каждой буквы: по нему сцена находит буквы для таймлайна. */
  charClassName?: string;
};

/**
 * Строка по буквам. Буквы одного слова не разрываются переносом.
 * Для чтения с экрана рядом лежит целая строка, буквы помечены aria-hidden.
 */
export function SplitChars({ text, charClassName = 'char' }: SplitCharsProps) {
  const words = text.split(' ');
  return (
    <>
      <span className="visually-hidden">{text}</span>
      <span aria-hidden="true">
        {words.map((word, wordIndex) => (
          <Fragment key={`${wordIndex}-${word}`}>
            {wordIndex > 0 ? ' ' : null}
            <span className="inline-block whitespace-nowrap">
              {Array.from(word).map((char, charIndex) => (
                <span key={charIndex} className={cn('inline-block', charClassName)}>
                  {char}
                </span>
              ))}
            </span>
          </Fragment>
        ))}
      </span>
    </>
  );
}

export type SplitWordsProps = {
  text: string;
  /** Класс каждого слова: по нему сцена собирает строки вёрстки (см. groupLines). */
  wordClassName?: string;
};

/** Абзац по словам. Текст остаётся обычным текстом: пробелы между словами настоящие. */
export function SplitWords({ text, wordClassName = 'word' }: SplitWordsProps) {
  const words = text.split(' ');
  return (
    <>
      {words.map((word, index) => (
        <Fragment key={`${index}-${word}`}>
          {index > 0 ? ' ' : null}
          <span className={cn('inline-block', wordClassName)}>{word}</span>
        </Fragment>
      ))}
    </>
  );
}

/**
 * Собирает слова в строки так, как они легли в вёрстке (по верхнему краю слова).
 * Вызывать при сборке таймлайна: после ресайза и смены языка строки другие.
 */
export function groupLines(words: readonly HTMLElement[]): HTMLElement[][] {
  const lines: HTMLElement[][] = [];
  let lastTop: number | null = null;
  for (const word of words) {
    const top = word.offsetTop;
    if (lastTop === null || Math.abs(top - lastTop) > 2) {
      lines.push([word]);
      lastTop = top;
    } else {
      lines[lines.length - 1].push(word);
    }
  }
  return lines;
}
