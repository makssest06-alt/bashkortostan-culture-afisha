import { Fragment } from 'react';

import { cn } from '@/lib/cn';

/**
 * Разбивка текста для появления по символам и по словам.
 * Читалка получает цельную строку (visually-hidden), побуквенные обёртки от неё скрыты.
 *
 *   <h2><Chars text="ПЯТЬ УСЛОВИЙ." /></h2>      // .ch внутри маски .ch-mask
 *   <p><Words text="Абзац по словам" /></p>      // .w внутри маски .w-mask
 */

/** Маска символа и слова: запас сверху и снизу под хвосты букв (ҙ, ҫ, ң, р, у, ф, щ). */
const MASK = 'inline-block overflow-clip pt-[0.08em] pb-[0.16em] -mt-[0.08em] -mb-[0.16em] align-baseline';

export function Chars({ text, className, mask = true }: { text: string; className?: string; mask?: boolean }) {
  const words = text.split(' ');
  return (
    <>
      <span className="visually-hidden">{text}</span>
      <span aria-hidden="true" className={className}>
        {words.map((word, wordIndex) => (
          <Fragment key={`${word}-${wordIndex}`}>
            <span className="inline-block whitespace-nowrap">
              {Array.from(word).map((char, charIndex) =>
                mask ? (
                  <span key={charIndex} className={cn('ch-mask', MASK)}>
                    <span className="ch inline-block will-change-transform">{char}</span>
                  </span>
                ) : (
                  <span key={charIndex} className="ch inline-block will-change-[filter,opacity]">
                    {char}
                  </span>
                ),
              )}
            </span>
            {wordIndex < words.length - 1 ? ' ' : null}
          </Fragment>
        ))}
      </span>
    </>
  );
}

export function Words({ text, className }: { text: string; className?: string }) {
  const words = text.split(' ');
  return (
    <span className={className}>
      {words.map((word, index) => (
        <Fragment key={`${word}-${index}`}>
          <span className={cn('w-mask', MASK)}>
            <span className="w inline-block">{word}</span>
          </span>
          {index < words.length - 1 ? ' ' : null}
        </Fragment>
      ))}
    </span>
  );
}
