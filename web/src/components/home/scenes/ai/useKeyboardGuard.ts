'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { RefObject } from 'react';

import { scrollToTarget } from '@/components/shell/scroll';
import { ScrollTrigger } from '@/lib/gsap';

/**
 * Экранная клавиатура и закреплённая сцена.
 *
 * Поле запроса стоит внутри закреплённого экрана. На телефоне клавиатура может увести сцену из-под
 * пальцев двумя способами, оба закрыты здесь:
 *
 *   1. Браузер подвигает страницу, чтобы показать поле. Сцена при этом может уехать за свой конец.
 *      Перед вводом прокрутка тихо встаёт в середину отрезка, где сцена неподвижна: картинка та же,
 *      а запас в обе стороны больше высоты клавиатуры.
 *   2. Там, где клавиатура сжимает окно (встроенные браузеры на Android), длины всех закреплений
 *      пересчитываются под новую высоту, и та же прокрутка попадает в другую сцену: поле прячется,
 *      фокус теряется. Пока идёт ввод, после каждого пересчёта прокрутка сразу возвращается в середину
 *      неподвижного отрезка уже по новым границам, а фокус в поле, и всё это до отрисовки кадра.
 *
 * Работает только на сенсорных устройствах: у мыши и клавиатуры этих бед нет.
 */

export type KeyboardGuardOptions = {
  /** Отрезок сцены, где картинка неподвижна: в него прокрутка возвращается при вводе. */
  safeFrom: number;
  safeTo: number;
  /** Сколько ещё держать защиту после потери фокуса, мс: клавиатура закрывается, окно возвращает высоту. */
  releaseDelay?: number;
};

export function useKeyboardGuard(section: RefObject<HTMLElement | null>, options: KeyboardGuardOptions) {
  const { safeFrom, safeTo, releaseDelay = 1200 } = options;
  const active = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  /** Поле, которое было в фокусе перед пересчётом закреплений: фокус надо вернуть. */
  const resume = useRef<HTMLElement | null>(null);

  /** Закрепление экрана этой сцены. */
  const findPin = useCallback(() => {
    const stage = section.current?.querySelector('.scene-stage');
    return stage ? ScrollTrigger.getAll().find((trigger) => trigger.pin === stage) : undefined;
  }, [section]);

  /** Прокрутка в середину неподвижного отрезка. force: даже если она уже внутри него. */
  const settle = useCallback(
    (force: boolean) => {
      const pin = findPin();
      if (!pin) return;
      const length = pin.end - pin.start;
      if (length <= 0) return;
      const progress = (pin.scroll() - pin.start) / length;
      const edge = (safeTo - safeFrom) * 0.25;
      if (!force && progress >= safeFrom + edge && progress <= safeTo - edge) return;
      scrollToTarget(Math.round(pin.start + length * ((safeFrom + safeTo) / 2)), { immediate: true });
      // Сцены сверяются с прокруткой сразу, не дожидаясь кадра: экран не успевает спрятаться.
      ScrollTrigger.update();
    },
    [findPin, safeFrom, safeTo],
  );

  // Пересчёт на время вынимает закреплённый экран из разметки, и поле теряет фокус.
  // Перед пересчётом запоминаем поле, после него возвращаем и место сцены, и фокус.
  const onRefreshInit = useCallback(() => {
    const focusedNode = document.activeElement;
    resume.current =
      focusedNode instanceof HTMLElement && section.current?.contains(focusedNode) ? focusedNode : null;
  }, [section]);

  const onRefresh = useCallback(() => {
    settle(false);
    const node = resume.current;
    resume.current = null;
    if (node?.isConnected && document.activeElement !== node) node.focus({ preventScroll: true });
  }, [settle]);

  const stop = useCallback(() => {
    window.clearTimeout(timer.current);
    if (!active.current) return;
    active.current = false;
    resume.current = null;
    ScrollTrigger.removeEventListener('refreshInit', onRefreshInit);
    ScrollTrigger.removeEventListener('refresh', onRefresh);
  }, [onRefreshInit, onRefresh]);

  /** Поле получило фокус. */
  const engage = useCallback(() => {
    if (!window.matchMedia('(pointer: coarse)').matches) return;
    window.clearTimeout(timer.current);
    settle(false);
    if (!active.current) {
      active.current = true;
      ScrollTrigger.addEventListener('refreshInit', onRefreshInit);
      ScrollTrigger.addEventListener('refresh', onRefresh);
    }
  }, [settle, onRefreshInit, onRefresh]);

  /** Поле потеряло фокус: защита живёт ещё немного, пока окно возвращает высоту. */
  const release = useCallback(() => {
    if (!active.current) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(stop, releaseDelay);
  }, [stop, releaseDelay]);

  useEffect(() => stop, [stop]);

  return { engage, release };
}
