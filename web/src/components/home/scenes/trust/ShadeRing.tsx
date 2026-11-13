'use client';

import { useEffect, useRef } from 'react';

import { KUSKAR_RING } from '@/components/ornament';

import styles from './trust.module.css';

/** Во сколько раз холст меньше своего места на экране: увеличение браузером само смягчает край. */
const DOWNSCALE = 6;
/** Без фильтра у холста (старый Safari) холст ещё мельче: мягкий край даёт только увеличение. */
const DOWNSCALE_NO_FILTER = 14;
/** Размытие тени в пикселях экрана (как было у filter: blur на слое). */
const BLUR_PX = 11;
const MIN_SIDE = 64;
const MAX_SIDE = 256;

/** Цвет текста светлой темы: тень видна только после инверсии. */
function lightInk(host: HTMLElement): string {
  const probe = document.createElement('span');
  probe.dataset.theme = 'light';
  probe.style.color = 'var(--color-fg)';
  host.appendChild(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color || 'rgb(48 44 40)';
}

function drawRing(context: CanvasRenderingContext2D, side: number, color: string): void {
  const scale = side / KUSKAR_RING.size;
  const center = KUSKAR_RING.size / 2;
  const line = new Path2D(KUSKAR_RING.line);
  const diamond = new Path2D(KUSKAR_RING.diamond);
  context.setTransform(scale, 0, 0, scale, 0, 0);
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = KUSKAR_RING.strokeWidth;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  for (let index = 0; index < KUSKAR_RING.count; index += 1) {
    context.save();
    context.translate(center, center);
    context.rotate((index * 2 * Math.PI) / KUSKAR_RING.count);
    context.translate(-center, -center);
    context.stroke(line);
    context.fill(diamond);
    context.restore();
  }
  context.setTransform(1, 0, 0, 1, 0, 0);
}

/**
 * Кольцо кускар для тени на кремовом блоке. Рисуется один раз на маленьком холсте (сторона в 6 раз меньше
 * места на экране) и размывается там же; браузер растягивает холст до 128vh. Слой занимает доли мегабайта
 * вместо двух текстур по 40 МБ, которые давали filter: blur на квадрате 128vh и его анимация.
 */
export function ShadeRing({ viewport }: { viewport: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return;
    // Сцена может быть выгружена (display: none): тогда размер берётся из окна, как в CSS (128vh).
    const box = canvas.offsetWidth || Math.max(560, window.innerHeight * 1.28);
    const filtered = 'filter' in CanvasRenderingContext2D.prototype;
    const side = Math.round(Math.min(MAX_SIDE, Math.max(MIN_SIDE, box / (filtered ? DOWNSCALE : DOWNSCALE_NO_FILTER))));
    canvas.width = side;
    canvas.height = side;
    const context = canvas.getContext('2d');
    if (!context) return;
    const color = lightInk(host);

    const sharp = document.createElement('canvas');
    sharp.width = side;
    sharp.height = side;
    const sharpContext = sharp.getContext('2d');
    context.clearRect(0, 0, side, side);
    if (sharpContext && filtered) {
      // Размытие всей группы сразу: мотивы не складываются по яркости там, где перекрываются.
      drawRing(sharpContext, side, color);
      context.filter = `blur(${(BLUR_PX / DOWNSCALE).toFixed(2)}px)`;
      context.drawImage(sharp, 0, 0);
      context.filter = 'none';
    } else {
      // Без фильтра холста край смягчает само увеличение (в 14 раз).
      drawRing(context, side, color);
    }
  }, [viewport]);

  return <canvas ref={ref} className={styles.shadeCanvas} aria-hidden="true" />;
}
