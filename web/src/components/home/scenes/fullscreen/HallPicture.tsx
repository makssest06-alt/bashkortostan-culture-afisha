'use client';

/**
 * Картинка театрального зала в координатах экрана сцены. Один и тот же компонент стоит:
 *   - в последней карточке галереи (обрезан рамкой, сдвиг начальный);
 *   - в окне сцены fullscreen (сдвиг уходит в ноль по прокрутке);
 *   - в сцене thermal (сдвиг ноль, поверх ложится тепловая карта).
 * Поэтому кадрирование во всех трёх местах совпадает пиксель в пиксель.
 *
 * Родитель обязан быть размером с экран сцены (100vw x 100dvh) и нести класс vars из frame.module.css.
 */

import Image from 'next/image';
import type { ReactNode, Ref } from 'react';

import { cn } from '@/lib/cn';

import styles from './scene.module.css';

export const HALL_SRC = '/images/scenes/hall.webp';

export type HallPictureProps = {
  /** Сдвиг уже пройден (сцена thermal): герой стоит в центре правой области. */
  settled?: boolean;
  /** Узел сдвига: fullscreen ведёт его переменную --sp по прокрутке. */
  shiftRef?: Ref<HTMLDivElement>;
  imageRef?: Ref<HTMLImageElement>;
  /** Загрузить заранее и декодировать сразу при показе: на склейке сцен не должно быть пустого кадра. */
  sync?: boolean;
  /** Сдвиг едет в этой сцене: в активной сцене он становится отдельным слоем (fullscreen). */
  live?: boolean;
  className?: string;
  children?: ReactNode;
};

export function HallPicture({
  settled = false,
  shiftRef,
  imageRef,
  sync = false,
  live = false,
  className,
  children,
}: HallPictureProps) {
  return (
    <div
      ref={shiftRef}
      className={cn(styles.shift, settled && styles.shiftDone, live && styles.shiftLive, className)}
      data-hall-shift
    >
      <div className={styles.pic}>
        {/* Картинка декоративная: смысл сцены несут тексты панели */}
        <Image
          ref={imageRef}
          src={HALL_SRC}
          alt=""
          fill
          sizes="(max-width: 767px) 220vh, 131vw"
          loading={sync ? 'eager' : 'lazy'}
          decoding={sync ? 'sync' : 'async'}
          className={styles.img}
        />
        <span className={styles.dim} aria-hidden="true" />
        {children}
      </div>
    </div>
  );
}
