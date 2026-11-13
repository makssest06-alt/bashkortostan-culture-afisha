'use client';

/**
 * Понятые условия: редактируемые чипы и допущения.
 * Чип можно снять крестиком или открыть его редактор нажатием на значение.
 * У допущения («суббота = 14 ноября») есть действие «изменить»: оно открывает тот же редактор.
 */

import { X } from '@phosphor-icons/react';
import { useId } from 'react';

import { Button } from '@/components/ui';
import type { AssistantAssumption, AssistantChip, ChipKind, Constraints, ConstraintsPatch } from '@/lib/api/types';
import { useT } from '@/lib/i18n';

import styles from './ask.module.css';
import { ChipEditor } from './ChipEditor';
import { askText } from './copy';
import { assumptionKind, isEditable } from './patches';

export type ConditionsProps = {
  chips: AssistantChip[];
  constraints: Constraints | null;
  today: string | null;
  /** Какое условие сейчас правится. */
  editing: ChipKind | null;
  busy: boolean;
  onToggleEdit: (kind: ChipKind) => void;
  onCloseEdit: () => void;
  onRemove: (chip: AssistantChip) => void;
  onApply: (kind: ChipKind, patch: ConstraintsPatch) => void;
};

export function Conditions({
  chips,
  constraints,
  today,
  editing,
  busy,
  onToggleEdit,
  onCloseEdit,
  onRemove,
  onApply,
}: ConditionsProps) {
  const { t } = useT();
  const titleId = useId();
  const editorId = useId();
  const showEditor = editing !== null && constraints !== null && today !== null;

  if (chips.length === 0 && !showEditor) return null;

  return (
    <section className={styles.conditions} aria-labelledby={titleId} data-ask-conditions="">
      <h2 id={titleId} className={styles.conditionsTitle}>
        {t('ask.chips')}
      </h2>

      {chips.length > 0 ? (
        <ul className={styles.chipRow}>
          {chips.map((chip) => {
            const editable = isEditable(chip);
            const open = editable && editing === chip.kind;
            const name = `${chip.label}: ${chip.value}`;
            return (
              <li
                key={chip.key}
                className={styles.chip}
                data-chip={chip.key}
                data-open={open ? '' : undefined}
                data-pending={busy ? '' : undefined}
              >
                {editable ? (
                  <button
                    type="button"
                    className={styles.chipMain}
                    disabled={busy}
                    aria-expanded={open}
                    aria-controls={open ? editorId : undefined}
                    aria-label={t('ask.chipEdit', { label: name })}
                    data-chip-edit={chip.kind}
                    onClick={() => onToggleEdit(chip.kind)}
                  >
                    <span className={styles.chipLabel}>{chip.label}</span>
                    <span className={styles.chipValue}>{chip.value}</span>
                  </button>
                ) : (
                  <span className={styles.chipMain}>
                    <span className={styles.chipLabel}>{chip.label}</span>
                    <span className={styles.chipValue}>{chip.value}</span>
                  </span>
                )}
                {chip.removable ? (
                  <button
                    type="button"
                    className={styles.chipRemove}
                    disabled={busy}
                    aria-label={t('ask.chipRemove', { label: name })}
                    data-chip-remove={chip.key}
                    onClick={() => onRemove(chip)}
                  >
                    <X size={14} weight="bold" aria-hidden="true" />
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {showEditor ? (
        <ChipEditor
          key={editing}
          id={editorId}
          kind={editing}
          constraints={constraints}
          today={today}
          busy={busy}
          onApply={(patch) => onApply(editing, patch)}
          onClose={onCloseEdit}
        />
      ) : null}
    </section>
  );
}

export type AssumptionsProps = {
  assumptions: AssistantAssumption[];
  busy: boolean;
  onEdit: (kind: ChipKind) => void;
};

export function Assumptions({ assumptions, busy, onEdit }: AssumptionsProps) {
  const { t, lang } = useT();
  const titleId = useId();
  if (assumptions.length === 0) return null;

  return (
    <section className={styles.assumptions} aria-labelledby={titleId} data-ask-assumptions="">
      <h2 id={titleId} className={styles.assumptionsTitle}>
        {t('ask.assumptions')}
      </h2>
      <ul className={styles.assumptionList}>
        {assumptions.map((assumption) => {
          const kind = assumptionKind(assumption);
          return (
            <li key={assumption.key} className={styles.assumption} data-assumption={assumption.key}>
              <span>{assumption.text}</span>
              {kind ? (
                <Button
                  variant="link"
                  size="sm"
                  disabled={busy}
                  aria-label={askText('assumptionEdit', lang, { text: assumption.text })}
                  onClick={() => onEdit(kind)}
                >
                  {askText('change', lang)}
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
