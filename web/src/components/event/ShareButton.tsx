'use client';

/**
 * «Поделиться»: системное окно через Web Share API, а где его нет, копирование ссылки.
 * Делится всегда чистым адресом события: без ?from=... и прочих хвостов из адресной строки.
 */

import { Check, ShareNetwork } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui';
import { useT } from '@/lib/i18n';

import { copy } from './copy';

const FEEDBACK_MS = 2600;

type ShareState = 'idle' | 'copied' | 'failed';

/** Копирование для старых браузеров и страниц без доступа к буферу обмена. */
function legacyCopy(text: string): boolean {
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.appendChild(field);
  field.select();
  let done = false;
  try {
    done = document.execCommand('copy');
  } catch {
    done = false;
  }
  field.remove();
  return done;
}

async function copyLink(url: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    return legacyCopy(url);
  }
}

export type ShareButtonProps = {
  /** Название события: заголовок в системном окне «Поделиться». */
  title: string;
  /** Путь страницы события: /events/<id>. */
  path: string;
  className?: string;
};

export function ShareButton({ title, path, className }: ShareButtonProps) {
  const { t, lang } = useT();
  const [state, setState] = useState<ShareState>('idle');
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const show = (next: ShareState) => {
    setState(next);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState('idle'), next === 'failed' ? FEEDBACK_MS * 2 : FEEDBACK_MS);
  };

  const share = async () => {
    const url = new URL(path, window.location.origin).toString();

    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, url });
        return;
      } catch (error) {
        // Пользователь сам закрыл окно: это не ошибка, копировать ссылку не нужно.
        if (error instanceof DOMException && error.name === 'AbortError') return;
      }
    }
    show((await copyLink(url)) ? 'copied' : 'failed');
  };

  const copied = state === 'copied';

  return (
    <div className={className}>
      <Button variant="ghost" fullWidth onClick={share} data-share={state}>
        {copied ? (
          <Check size={18} weight="bold" aria-hidden="true" className="text-status-ok" />
        ) : (
          <ShareNetwork size={18} weight="bold" aria-hidden="true" />
        )}
        {copied ? t('event.linkCopied') : t('event.share')}
      </Button>
      <p role="status" className={state === 'failed' ? 'mt-2 text-[0.875rem] leading-[1.4] text-fg-soft' : 'visually-hidden'}>
        {state === 'copied' ? t('event.linkCopied') : state === 'failed' ? copy('copyFailed', lang) : ''}
      </p>
    </div>
  );
}
