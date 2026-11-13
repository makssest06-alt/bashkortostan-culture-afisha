'use client';

/**
 * Выезжающая снизу панель фильтров для телефона и планшета.
 *
 * Доступность: role="dialog", фокус не выходит за панель, Escape закрывает, после закрытия фокус
 * возвращается на кнопку «Фильтры», прокрутка страницы под панелью заперта.
 * Свайп: панель идёт за пальцем один к одному (transform пишется прямо в узел, без состояния React),
 * закрывается, если протянули дальше четверти высоты или смахнули быстро.
 */

import { X } from '@phosphor-icons/react';
import { useEffect, useId, useRef, useSyncExternalStore } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';

import { lockScroll, unlockScroll } from '@/components/shell/scroll';
import { Button } from '@/components/ui';
import { useT } from '@/lib/i18n';
import { prefersReducedMotion } from '@/lib/motion';

import type { FilterGroup } from './query';
import styles from './sheet.module.css';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Доля высоты панели, после которой отпускание закрывает её. */
const CLOSE_DISTANCE = 0.25;
/** Скорость смахивания вниз, px/мс, которой достаточно для закрытия при любом расстоянии. */
const CLOSE_VELOCITY = 0.5;

export type FilterSheetProps = {
  open: boolean;
  onClose: () => void;
  /** Группа, к которой надо прокрутить панель при открытии (нажали на чип условия). */
  focusGroup?: FilterGroup | null;
  /** Куда вернуть фокус после закрытия. */
  returnFocusRef?: RefObject<HTMLElement | null>;
  /** Подпись главной кнопки: «Показать 12 событий». */
  submitLabel: string;
  /** Сброс фильтров. Без него кнопка сброса не показывается. */
  onReset?: () => void;
  children: ReactNode;
};

const subscribeNever = () => () => {};

type Drag = {
  pointerId: number;
  startY: number;
  lastY: number;
  lastTime: number;
  velocity: number;
  offset: number;
};

export function FilterSheet({
  open,
  onClose,
  focusGroup = null,
  returnFocusRef,
  submitLabel,
  onReset,
  children,
}: FilterSheetProps) {
  const { t } = useT();
  const titleId = useId();
  const isClient = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );

  const sheet = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const drag = useRef<Drag | null>(null);

  useEffect(() => {
    if (!open) return;
    const returnTo = returnFocusRef?.current ?? null;
    lockScroll();

    const group = focusGroup ? body.current?.querySelector<HTMLElement>(`[data-filter-group="${focusGroup}"]`) : null;
    if (group) {
      group.scrollIntoView({ block: 'start' });
      (group.querySelector<HTMLElement>(FOCUSABLE) ?? closeButton.current)?.focus({ preventScroll: true });
    } else {
      if (body.current) body.current.scrollTop = 0;
      closeButton.current?.focus({ preventScroll: true });
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !sheet.current) return;
      const items = Array.from(sheet.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!sheet.current.contains(active)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      unlockScroll();
      returnTo?.focus({ preventScroll: true });
    };
  }, [open, onClose, focusGroup, returnFocusRef]);

  const releaseInline = () => {
    if (sheet.current) {
      sheet.current.style.transition = '';
      sheet.current.style.transform = '';
    }
    if (scrim.current) {
      scrim.current.style.transition = '';
      scrim.current.style.opacity = '';
    }
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current || prefersReducedMotion()) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if ((event.target as HTMLElement).closest('button')) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      lastY: event.clientY,
      lastTime: event.timeStamp,
      velocity: 0,
      offset: 0,
    };
    if (sheet.current) sheet.current.style.transition = 'none';
    if (scrim.current) scrim.current.style.transition = 'none';
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId || !sheet.current) return;
    const delta = event.clientY - state.startY;
    // Вниз панель идёт за пальцем, вверх упирается с нарастающим сопротивлением.
    const offset = delta >= 0 ? delta : -Math.sqrt(-delta) * 2;
    const elapsed = event.timeStamp - state.lastTime;
    if (elapsed > 0) state.velocity = (event.clientY - state.lastY) / elapsed;
    state.lastY = event.clientY;
    state.lastTime = event.timeStamp;
    state.offset = offset;
    sheet.current.style.transform = `translateY(${offset}px)`;
    if (scrim.current) {
      const height = sheet.current.offsetHeight || 1;
      scrim.current.style.opacity = String(Math.max(0, 1 - Math.max(0, offset) / height));
    }
  };

  const onPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    drag.current = null;
    const height = sheet.current?.offsetHeight || 1;
    const shouldClose =
      event.type !== 'pointercancel' &&
      state.offset > 0 &&
      (state.offset > height * CLOSE_DISTANCE || state.velocity > CLOSE_VELOCITY);
    // Переход стартует с текущего положения: панель либо уезжает вниз, либо возвращается на место.
    releaseInline();
    if (shouldClose) onClose();
  };

  if (!isClient) return null;

  return createPortal(
    <div className={styles.root} data-open={open ? '' : undefined} inert={!open} data-filter-sheet="">
      <div ref={scrim} className={styles.scrim} onClick={onClose} aria-hidden="true" />
      <div ref={sheet} className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div
          className={styles.grip}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
        >
          <span className={styles.handle} aria-hidden="true" />
          <div className="flex items-center justify-between gap-4 py-1 pr-2 pl-4">
            <h2 id={titleId} className="t-subtitle text-[1.375rem]">
              {t('filters.title')}
            </h2>
            <div className="flex items-center gap-3">
              {onReset ? (
                <Button variant="link" size="sm" onClick={onReset}>
                  {t('filters.reset')}
                </Button>
              ) : null}
              <button
                ref={closeButton}
                type="button"
                onClick={onClose}
                className="inline-flex size-11 items-center justify-center rounded-sm text-fg transition-[scale,background-color] duration-(--duration-press) ease-out hover:bg-hover active:scale-[0.94]"
              >
                <X size={22} weight="bold" aria-hidden="true" />
                <span className="visually-hidden">{t('common.close')}</span>
              </button>
            </div>
          </div>
        </div>

        <div ref={body} className={styles.body} data-lenis-prevent="">
          <div className="px-4 pt-3 pb-2">{children}</div>
        </div>

        <div className={styles.footer}>
          <div className="px-4 pt-3">
            <Button onClick={onClose} size="lg" fullWidth data-filter-submit="">
              {submitLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
