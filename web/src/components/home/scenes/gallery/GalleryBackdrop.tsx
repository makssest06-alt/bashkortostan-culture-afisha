'use client';

/**
 * Подложка сцены gallery: всё, что лежит ПОД жетоном. Снизу вверх: гигантская фраза, билетный конверт,
 * ленты миниатюр, рамка с фото. Слой декоративный (aria-hidden у слоя подложек): тексты и ссылки
 * для людей и для чтения с экрана лежат в экране сцены (index.tsx).
 *
 * Узлы помечены data-g: по этим меткам их находит таймлайн.
 */

import Image from 'next/image';

import type { GalleryCard } from '@/content/home';
import { cn } from '@/lib/cn';

import { HALL_SRC, HallPicture } from '../fullscreen/HallPicture';
import frame from './frame.module.css';
import styles from './gallery.module.css';

const PATTERN_ROWS = 9;
const PATTERN_REPEAT = 7;

function WrapPattern({ word }: { word: string }) {
  const row = Array.from({ length: PATTERN_REPEAT }, () => word).join(' ');
  return (
    <>
      <div className={styles.wrapPattern}>
        {Array.from({ length: PATTERN_ROWS }, (_, index) => (
          <span key={index}>{row}</span>
        ))}
      </div>
      <div className={styles.wrapSheen} />
    </>
  );
}

function Thumbs({ cards }: { cards: readonly GalleryCard[] }) {
  return (
    <div className={styles.track} data-g="track">
      {cards.map((card, index) => (
        <div key={card.id} className={styles.thumb}>
          <Image
            src={index === cards.length - 1 ? HALL_SRC : card.image}
            alt=""
            fill
            sizes="14vw"
            className="object-cover"
          />
        </div>
      ))}
    </div>
  );
}

export type GalleryBackdropProps = {
  phrase: string;
  /** Слово на билетном конверте: словесный знак. */
  wrapWord: string;
  cards: readonly GalleryCard[];
};

export function GalleryBackdrop({ phrase, wrapWord, cards }: GalleryBackdropProps) {
  const last = cards.length - 1;

  return (
    <div className={cn(frame.vars, styles.back)}>
      <p className={styles.phrase} data-g="phrase">
        {phrase}
        <span className={styles.phraseGlow} data-g="glow">
          {phrase}
        </span>
      </p>

      <div className={styles.wrap} data-g="wrap">
        <div className={styles.wrapTilt}>
          <div className={cn(styles.wrapHalf, styles.wrapHalfLeft)} data-g="wrap-l">
            <WrapPattern word={wrapWord} />
          </div>
          <div className={cn(styles.wrapHalf, styles.wrapHalfRight)} data-g="wrap-r">
            <WrapPattern word={wrapWord} />
          </div>
        </div>
      </div>

      <div className={cn(styles.strip, styles.stripLeft)} data-g="strip-l">
        <Thumbs cards={cards} />
      </div>
      <div className={cn(styles.strip, styles.stripRight)} data-g="strip-r">
        <Thumbs cards={cards} />
      </div>

      <div className={styles.frame} data-g="frame">
        <div className={styles.photo}>
          <div className={styles.glass} data-g="glass" />
          {cards.map((card, index) => (
            <div key={card.id} className={styles.card} data-g="card">
              <div className={styles.cardZoom} data-g="zoom">
                {index === last ? (
                  // Последняя карточка это окно в зал: тот же кадр раскроется на весь экран в сцене fullscreen.
                  <div className={styles.stageBox}>
                    <HallPicture />
                  </div>
                ) : (
                  <Image src={card.image} alt="" fill sizes="(max-width: 767px) 80vw, 36vw" className="object-cover" />
                )}
              </div>
              {index === last ? (
                <>
                  <div className={styles.coverShade} data-g="cover-shade" />
                  <div className={styles.cover} data-g="cover">
                    {card.label}
                  </div>
                </>
              ) : null}
            </div>
          ))}
          {/* По одной полосе-шву на каждую смену карточки */}
          {cards.slice(1).map((card) => (
            <div key={card.id} className={styles.seam} data-g="seam" />
          ))}
        </div>

        <div className={styles.edges} data-g="edges">
          <span className={cn(styles.edge, styles.edgeTop)} />
          <span className={cn(styles.edge, styles.edgeRight)} />
          <span className={cn(styles.edge, styles.edgeBottom)} />
          <span className={cn(styles.edge, styles.edgeLeft)} />
          <span className={styles.dotWrap}>
            <span className={cn(styles.dot, 'block')} data-g="dot" />
          </span>
        </div>

        <div className={styles.circle} data-g="circle">
          <span className={cn(styles.tick, styles.tickTop)} />
          <span className={cn(styles.tick, styles.tickRight)} />
          <span className={cn(styles.tick, styles.tickBottom)} />
          <span className={cn(styles.tick, styles.tickLeft)} />
        </div>
      </div>
    </div>
  );
}
