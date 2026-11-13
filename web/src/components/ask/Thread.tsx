'use client';

/**
 * Лента диалога. Область помечена как журнал (role="log"): новые реплики скринридер
 * читает сам, не отбирая фокус у поля ввода. Весь текст выводится как текст.
 */

import { HandPalm, WarningCircle } from '@phosphor-icons/react';
import type { RefObject } from 'react';

import { Button, Chip } from '@/components/ui';
import type { AssistantClarify, UnsupportedAction } from '@/lib/api/types';
import { cn } from '@/lib/cn';
import { useT } from '@/lib/i18n';
import type { Lang } from '@/lib/i18n';

import styles from './ask.module.css';
import { askText } from './copy';
import type { Phase, Turn } from './useAskDialog';

export type ThreadProps = {
  turns: Turn[];
  phase: Phase;
  /** Вопрос, на который ассистент ждёт ответа: под последней репликой стоят быстрые ответы. */
  clarify: AssistantClarify | null;
  onReply: (text: string) => void;
  onRetry: () => void;
  threadRef: RefObject<HTMLDivElement | null>;
};

/** Метка честного отказа над репликой ассистента. null: обычный ответ. */
function refusalTag(turn: Extract<Turn, { role: 'assistant' }>, lang: Lang): string | null {
  const actions: readonly UnsupportedAction[] = turn.unsupported;
  if (actions.includes('purchase')) return askText('tagPurchase', lang);
  if (actions.includes('booking')) return askText('tagBooking', lang);
  if (actions.length > 0) return askText('tagRefused', lang);
  if (turn.action === 'out_of_scope') return askText('tagOutOfScope', lang);
  return null;
}

export function Thread({ turns, phase, clarify, onReply, onRetry, threadRef }: ThreadProps) {
  const { t, lang } = useT();
  const busy = phase === 'thinking' || phase === 'updating';
  const lastId = turns.length > 0 ? turns[turns.length - 1].id : -1;

  return (
    <div
      ref={threadRef}
      className={styles.thread}
      role="log"
      aria-live="polite"
      aria-relevant="additions text"
      aria-label={askText('dialogLabel', lang)}
      tabIndex={0}
      data-lenis-prevent=""
      data-ask-thread=""
    >
      {turns.map((turn) => {
        if (turn.role === 'user') {
          return (
            <p key={turn.id} className={cn(styles.turn, styles.turnUser)} data-turn="user">
              <span className="visually-hidden">{t('ask.you')}: </span>
              {turn.text}
            </p>
          );
        }

        if (turn.role === 'note') {
          return (
            <p key={turn.id} className={cn(styles.turn, styles.turnNote)} data-turn="note">
              <span className="visually-hidden">{t('ask.you')}: </span>
              {turn.text}
            </p>
          );
        }

        const tag = refusalTag(turn, lang);
        const replies =
          turn.id === lastId && turn.action === 'clarify' && clarify && phase !== 'error' ? clarify.quick_replies : [];

        return (
          <div
            key={turn.id}
            className={cn(styles.turn, styles.turnAssistant)}
            data-turn="assistant"
            data-action={turn.action}
          >
            <span className="visually-hidden">{t('ask.assistant')}: </span>
            {tag ? (
              <p className={styles.refusal} data-refusal="">
                <HandPalm size={14} weight="bold" aria-hidden="true" className="shrink-0" />
                {tag}
              </p>
            ) : null}
            <p className={styles.turnText}>{turn.text}</p>
            {replies.length > 0 ? (
              <div role="group" aria-label={t('ask.quickReplies')} className={styles.replies} data-quick-replies="">
                {replies.map((reply) => (
                  <Chip key={reply} onClick={() => onReply(reply)} disabled={busy}>
                    {reply}
                  </Chip>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}

      {phase === 'thinking' ? (
        <div className={cn(styles.turn, styles.turnAssistant)} data-turn="thinking">
          <span className={styles.dots} aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span className="visually-hidden">{t('ask.thinking')}</span>
        </div>
      ) : null}

      {phase === 'error' ? (
        <div className={cn(styles.turn, styles.turnError)} role="alert" data-turn="error">
          <p className="flex items-start gap-2 text-status-cancelled">
            <WarningCircle size={18} weight="bold" aria-hidden="true" className="mt-[0.15em] shrink-0" />
            <span>{t('ask.error')}</span>
          </p>
          <Button variant="ghost" size="sm" onClick={onRetry}>
            {t('common.retry')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
