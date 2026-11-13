'use client';

import { useEffect, useImperativeHandle, useRef } from 'react';
import type { Ref } from 'react';

import { createScramble } from './scramble';
import type { Scramble } from './scramble';

export type ScrambleHandle = {
  /** Показать или спрятать строку. instant: без перебора символов. */
  set: (visible: boolean, instant?: boolean) => void;
};

export type ScrambleTextProps = {
  text: string;
  ref?: Ref<ScrambleHandle>;
  /** Задержка показа, секунд: строки одной подписи идут друг за другом. */
  delay?: number;
  className?: string;
};

/**
 * Мелкая подпись с перебором символов. Сцена управляет ею без состояния React: через ref.set().
 * Настоящий текст всегда лежит рядом для чтения с экрана, видимая копия помечена aria-hidden.
 */
export function ScrambleText({ text, ref, delay = 0, className }: ScrambleTextProps) {
  const node = useRef<HTMLSpanElement>(null);
  const scramble = useRef<Scramble | null>(null);
  const visible = useRef(true);

  useEffect(() => {
    if (!node.current) return;
    const controller = createScramble(node.current, text, { delay });
    scramble.current = controller;
    // Строку сменили (другой язык): новая копия сразу встаёт в то состояние, которое просила сцена.
    if (!visible.current) controller.hide(true);
    return () => {
      controller.kill();
      scramble.current = null;
    };
  }, [text, delay]);

  useImperativeHandle(
    ref,
    () => ({
      set(next, instant = false) {
        visible.current = next;
        if (next) scramble.current?.show(instant);
        else scramble.current?.hide(instant);
      },
    }),
    [],
  );

  return (
    <span className={className}>
      <span className="visually-hidden">{text}</span>
      {/* key: при смене текста React ставит свежий узел, а не правит тот, в котором хозяйничал перебор */}
      <span key={text} ref={node} aria-hidden="true">
        {text}
      </span>
    </span>
  );
}
