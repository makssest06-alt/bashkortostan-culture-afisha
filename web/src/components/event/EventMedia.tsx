'use client';

/**
 * Картинка события 3:4. Если картинки нет или она не загрузилась, на её месте заглушка
 * по категории: кольцо кускар, значок и название раздела.
 */

import { Balloon, Bank, Confetti, FrameCorners, MaskHappy, MusicNotes } from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import Image from 'next/image';
import { useState } from 'react';

import { KuskarRing } from '@/components/ornament';
import { getCategory } from '@/data/dictionaries';
import type { CategoryId } from '@/lib/api/types';
import { cn } from '@/lib/cn';
import { pick, useT } from '@/lib/i18n';

import { copy } from './copy';
import styles from './event.module.css';
import type { ImageMeta } from './model';

const CATEGORY_ICONS: Record<CategoryId, Icon> = {
  theatre: MaskHappy,
  concert: MusicNotes,
  museum: Bank,
  exhibition: FrameCorners,
  festival: Confetti,
  kids: Balloon,
};

export type EventMediaProps = {
  image: string | null;
  /** Описание и автор снимка из манифеста. null: о картинке ничего не известно. */
  meta: ImageMeta | null;
  category: CategoryId;
  className?: string;
};

export function EventMedia({ image, meta, category, className }: EventMediaProps) {
  const { lang } = useT();
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(image) && !failed;
  const entry = getCategory(category);
  const CategoryIcon = CATEGORY_ICONS[category];

  return (
    <figure className={cn('flex flex-col gap-2.5', className)} data-event-media={showImage ? 'image' : 'placeholder'}>
      <div className={styles.frame}>
        {showImage && image ? (
          <Image
            src={image}
            alt={meta?.alt ?? ''}
            fill
            preload
            sizes="(min-width: 1200px) 30vw, (min-width: 768px) 44vw, 100vw"
            className={styles.image}
            onError={() => setFailed(true)}
          />
        ) : (
          <div className={styles.placeholder}>
            <span className="relative flex w-[58%] max-w-60 items-center justify-center text-copper-hi">
              <KuskarRing size="100%" />
              <CategoryIcon size="34%" weight="light" aria-hidden="true" className="absolute text-fg" />
            </span>
            {entry ? <span className="t-subtitle text-fg">{pick(entry.name_one, lang)}</span> : null}
            <span className="visually-hidden">{copy('noImage', lang)}</span>
          </div>
        )}
      </div>
      {showImage && meta?.author ? (
        <figcaption className="text-[0.8125rem] leading-[1.4] text-fg-muted">
          {copy('photoCredit', lang, { author: meta.author })}
        </figcaption>
      ) : null}
    </figure>
  );
}
