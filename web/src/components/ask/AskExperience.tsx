'use client';

/**
 * Страница ИИ-подбора: диалог слева, рабочая область с чипами и карточками справа.
 * На телефоне это одна колонка: чипы липкой строкой, лента, допущения, подборка,
 * поле ввода закреплено у нижнего края (порядок и раскладка описаны в ask.module.css).
 */

import { ArrowCounterClockwise, Info } from '@phosphor-icons/react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { PageShell } from '@/components/shell/PageShell';
import { scrollToTarget } from '@/components/shell/scroll';
import { Button } from '@/components/ui';
import type { AssistantChip, ChipKind, ConstraintsPatch, Relaxation } from '@/lib/api/types';
import { pick, useT } from '@/lib/i18n';
import { prefersReducedMotion } from '@/lib/motion';

import styles from './ask.module.css';
import { kindLabel } from './ChipEditor';
import { Composer } from './Composer';
import { Assumptions, Conditions } from './Conditions';
import { ASK_GLOW } from './constants';
import { askText } from './copy';
import { removeChipPatch } from './patches';
import { Results } from './Results';
import type { ResultsMode } from './Results';
import { Thread } from './Thread';
import { useAskDialog } from './useAskDialog';
import type { InitialExchange } from './useAskDialog';

const WIDE_QUERY = '(min-width: 1024px)';

export type AskExperienceProps = {
  /** Первый обмен репликами, собранный на сервере по параметру ?q=. */
  initial: InitialExchange | null;
  /** Фраза из ?q=, на которую сервер не ответил: её отправит браузер. */
  pendingQuery: string | null;
};

export function AskExperience({ initial, pendingQuery }: AskExperienceProps) {
  const { t, lang } = useT();
  const dialog = useAskDialog(initial, pendingQuery);
  const { state, started, busy, send, applyPatch, retry, reset } = dialog;

  const [editing, setEditing] = useState<ChipKind | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const seenTurns = useRef(state.turns.length);

  // Новая реплика: на широком экране лента прокручивается вниз внутри своей колонки,
  // на телефоне страница подъезжает к последней фразе пользователя, под ней ответ и подборка.
  useEffect(() => {
    const count = state.turns.length;
    const grew = count > seenTurns.current;
    seenTurns.current = count;
    const thread = threadRef.current;
    if (!thread) return;

    if (window.matchMedia(WIDE_QUERY).matches) {
      thread.scrollTo({ top: thread.scrollHeight, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
      return;
    }
    if (!grew) return;
    const own = thread.querySelectorAll<HTMLElement>('[data-turn="user"], [data-turn="note"]');
    const last = own[own.length - 1];
    if (last && state.turns[count - 1]?.role !== 'assistant') scrollToTarget(last);
  }, [state.turns, state.phase]);

  const closeEditor = useCallback((): void => {
    // Фокус возвращается на чип, с которого редактор открыли.
    const opener = editing ? rootRef.current?.querySelector<HTMLElement>(`[data-chip-edit="${editing}"]`) : null;
    setEditing(null);
    opener?.focus({ preventScroll: true });
  }, [editing]);

  const handleSend = useCallback(
    (text: string): boolean => {
      const sent = send(text);
      if (sent) setEditing(null);
      return sent;
    },
    [send],
  );

  const handleReply = useCallback(
    (text: string): void => {
      handleSend(text);
    },
    [handleSend],
  );

  const handleExample = useCallback(
    (text: string): void => {
      if (handleSend(text)) inputRef.current?.focus({ preventScroll: true });
    },
    [handleSend],
  );

  const handleRemove = useCallback(
    (chip: AssistantChip): void => {
      if (!state.constraints) return;
      setEditing(null);
      applyPatch(
        removeChipPatch(chip, state.constraints),
        askText('removedNote', lang, { label: `${chip.label}: ${chip.value}` }),
        state.chips.filter((item) => item.key !== chip.key),
      );
    },
    [applyPatch, lang, state.chips, state.constraints],
  );

  const handleApply = useCallback(
    (kind: ChipKind, patch: ConstraintsPatch): void => {
      applyPatch(patch, askText('changedNote', lang, { label: kindLabel(kind, t, lang) }));
      closeEditor();
    },
    [applyPatch, closeEditor, lang, t],
  );

  const handleRelax = useCallback(
    (relaxation: Relaxation): void => {
      setEditing(null);
      applyPatch(relaxation.patch, askText('relaxedNote', lang, { label: pick(relaxation.label, lang) }));
    },
    [applyPatch, lang],
  );

  const handleReset = useCallback((): void => {
    reset();
    setEditing(null);
    // Фраза из адреса больше не относится к диалогу: без этого перезагрузка задала бы её снова.
    if (window.location.search) window.history.replaceState(null, '', window.location.pathname);
    scrollToTarget(0, { immediate: true });
    inputRef.current?.focus({ preventScroll: true });
  }, [reset]);

  const toggleEdit = useCallback((kind: ChipKind): void => {
    setEditing((current) => (current === kind ? null : kind));
  }, []);

  let mode: ResultsMode = 'examples';
  if (state.view) mode = 'view';
  else if (state.phase === 'thinking') mode = 'loading';
  else if (state.clarify) mode = 'waiting';

  const placeholder = !started
    ? t('ask.placeholder')
    : state.clarify
      ? askText('answerPlaceholder', lang)
      : askText('followPlaceholder', lang);

  return (
    <div className={styles.page}>
      <PageShell demoNotice={false} glow={ASK_GLOW} className={styles.main}>
        <div ref={rootRef} className={styles.root} data-started={started ? '' : undefined} data-ask-root="">
          <div className={styles.dialog}>
            {started ? (
              <header className={styles.headCompact}>
                <h1 className="t-caps text-fg-soft">{t('ask.title')}</h1>
                <Button variant="ghost" size="sm" onClick={handleReset} data-ask-reset="">
                  <ArrowCounterClockwise size={16} weight="bold" aria-hidden="true" />
                  {t('ask.reset')}
                </Button>
              </header>
            ) : (
              <header className={styles.head}>
                <h1 className="t-heading">{t('ask.title')}</h1>
                <p className="t-lead mt-5 max-w-[34ch] text-fg-soft">{t('ask.subtitle')}</p>
              </header>
            )}

            <Thread
              turns={state.turns}
              phase={state.phase}
              clarify={state.clarify}
              onReply={handleReply}
              onRetry={retry}
              threadRef={threadRef}
            />

            <Composer onSend={handleSend} busy={busy} placeholder={placeholder} inputRef={inputRef} />

            <p className={styles.engineNote} data-ask-engine-note="">
              <Info size={16} weight="bold" aria-hidden="true" className="mt-[0.1em] shrink-0" />
              <span>
                {t('ask.stubNote')}
                {lang === 'ba' ? ` ${t('ask.langNote')}` : null}
              </span>
            </p>
          </div>

          <div className={styles.workspace}>
            <Conditions
              chips={state.chips}
              constraints={state.constraints}
              today={state.today}
              editing={editing}
              busy={busy}
              onToggleEdit={toggleEdit}
              onCloseEdit={closeEditor}
              onRemove={handleRemove}
              onApply={handleApply}
            />
            <Assumptions assumptions={state.assumptions} busy={busy} onEdit={setEditing} />
            <Results
              mode={mode}
              view={state.view}
              today={state.today}
              pendingQuestions={state.clarify?.pending.length ?? 1}
              busy={busy}
              onExample={handleExample}
              onRelax={handleRelax}
            />
          </div>
        </div>
      </PageShell>
    </div>
  );
}
