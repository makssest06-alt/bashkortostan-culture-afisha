'use client';

/**
 * Поле ввода фразы. На телефоне закреплено у нижнего края окна и поднимается над экранной
 * клавиатурой: смещение считается из visualViewport и пишется прямо в стиль формы,
 * React-состояние на каждый кадр не трогается.
 */

import { ArrowUp } from '@phosphor-icons/react';
import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent, RefObject } from 'react';

import { useT } from '@/lib/i18n';

import styles from './ask.module.css';
import { askText } from './copy';
import { MAX_MESSAGE_LENGTH } from './useAskDialog';

/** С какого остатка показывать счётчик знаков. */
const COUNTER_FROM = 60;

export type ComposerProps = {
  /** Возвращает false, если фраза не ушла: тогда текст остаётся в поле. */
  onSend: (text: string) => boolean;
  busy: boolean;
  placeholder: string;
  inputRef: RefObject<HTMLTextAreaElement | null>;
};

export function Composer({ onSend, busy, placeholder, inputRef }: ComposerProps) {
  const { t, lang } = useT();
  const [value, setValue] = useState('');
  const formRef = useRef<HTMLFormElement>(null);
  const inputId = useId();
  const hintId = useId();

  useEffect(() => {
    const viewport = window.visualViewport;
    const form = formRef.current;
    if (!viewport || !form) return;

    const wide = window.matchMedia('(min-width: 1024px)');
    let frame = 0;
    const update = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // При увеличении страницы пальцами видимое окно тоже меньше: это не клавиатура.
        const zoomed = viewport.scale > 1.01;
        const hidden = wide.matches || zoomed ? 0 : window.innerHeight - viewport.height - viewport.offsetTop;
        form.style.setProperty('--keyboard-offset', `${Math.max(0, Math.round(hidden))}px`);
      });
    };

    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    wide.addEventListener('change', update);
    update();
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
      wide.removeEventListener('change', update);
    };
  }, []);

  const submit = (): void => {
    if (onSend(value)) setValue('');
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    submit();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit();
  };

  const left = MAX_MESSAGE_LENGTH - value.length;
  const canSend = value.trim().length > 0 && !busy;

  return (
    <form ref={formRef} className={styles.composer} onSubmit={onSubmit} data-ask-composer="">
      <label htmlFor={inputId} className="visually-hidden">
        {t('ask.inputLabel')}
      </label>
      <div className={styles.composerBox}>
        <textarea
          ref={inputRef}
          id={inputId}
          name="message"
          rows={1}
          value={value}
          maxLength={MAX_MESSAGE_LENGTH}
          placeholder={placeholder}
          enterKeyHint="send"
          autoComplete="off"
          aria-describedby={hintId}
          className={styles.composerInput}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <button type="submit" disabled={!canSend} className={styles.sendButton} aria-label={t('ask.send')}>
          <span className={styles.sendLabel} aria-hidden="true">
            {t('ask.send')}
          </span>
          <ArrowUp size={18} weight="bold" aria-hidden="true" />
        </button>
      </div>
      <p id={hintId} className={styles.composerHint}>
        <span className={styles.enterHint}>{askText('enterHint', lang)}</span>
        {left <= COUNTER_FROM ? (
          <span data-num aria-live="polite">
            {askText('charsLeft', lang, { count: left })}
          </span>
        ) : null}
      </p>
    </form>
  );
}
