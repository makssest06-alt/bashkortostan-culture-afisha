'use client';

/**
 * Кнопка «Скопировать»: кладёт текст в буфер и на две секунды меняет подпись на «Скопировано».
 * Если буфер недоступен (старый браузер, страница без HTTPS), пробует запасной способ,
 * а при неудаче говорит об этом словами.
 */

import { Check, Copy } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/cn';
import { pick, useT } from '@/lib/i18n';

import styles from './docs.module.css';
import { DOCS_UI } from './ui-copy';

type CopyState = 'idle' | 'copied' | 'failed';

const RESET_MS = 2000;

/** Запасной способ для страниц без доступа к navigator.clipboard. */
function legacyCopy(text: string): boolean {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
  document.body.appendChild(area);
  area.select();
  let done = false;
  try {
    done = document.execCommand('copy');
  } catch {
    done = false;
  }
  area.remove();
  return done;
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Доступ к буферу запрещён: остаётся запасной способ.
  }
  return legacyCopy(text);
}

export type CopyButtonProps = {
  /** Что попадёт в буфер. */
  text?: string;
  /**
   * Либо id элемента с текстом (блок <pre>): в буфер уйдёт его textContent.
   * Так длинный пример ответа не передаётся в браузер второй раз, отдельной строкой для кнопки.
   */
  targetId?: string;
  /** Подпись для чтения с экрана, когда рядом несколько кнопок: «Скопировать код: curl». */
  ariaLabel?: string;
  /** primary: главное действие страницы (код вставки). quiet: кнопка в шапке блока кода. */
  variant?: 'primary' | 'quiet';
  className?: string;
};

export function CopyButton({ text, targetId, ariaLabel, variant = 'quiet', className }: CopyButtonProps) {
  const { t, lang } = useT();
  const [state, setState] = useState<CopyState>('idle');
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const onClick = async () => {
    const source = text ?? (targetId ? document.getElementById(targetId)?.textContent : null) ?? '';
    const done = source ? await copyText(source) : false;
    setState(done ? 'copied' : 'failed');
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState('idle'), done ? RESET_MS : RESET_MS * 3);
  };

  const copied = state === 'copied';

  return (
    <span className={cn(styles.copyWrap, className)}>
      <button
        type="button"
        onClick={onClick}
        aria-label={ariaLabel}
        data-variant={variant}
        data-copied={copied ? '' : undefined}
        className={styles.copy}
      >
        <span className={styles.copyIcon} aria-hidden="true">
          <Copy size={16} weight="bold" data-icon="copy" />
          <Check size={16} weight="bold" data-icon="check" />
        </span>
        <span className={styles.copyLabel} aria-hidden={ariaLabel ? true : undefined}>
          <span data-label="copy">{t('common.copy')}</span>
          <span data-label="copied" aria-hidden="true">
            {t('common.copied')}
          </span>
        </span>
      </button>
      <span role="status" className="visually-hidden">
        {copied ? t('common.copied') : state === 'failed' ? pick(DOCS_UI.copyFailed, lang) : ''}
      </span>
      {state === 'failed' ? <span className={styles.copyError}>{pick(DOCS_UI.copyFailed, lang)}</span> : null}
    </span>
  );
}
