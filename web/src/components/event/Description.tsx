'use client';

/**
 * Описание события. Текст из источника выводится только как текст: React экранирует его сам,
 * разметка из описания на страницу не попадает. Длинное описание свёрнуто, кнопка раскрывает его.
 */

import { CaretDown } from '@phosphor-icons/react';
import { useId, useState } from 'react';

import { cn } from '@/lib/cn';
import { useT } from '@/lib/i18n';

import styles from './event.module.css';
import { descriptionParagraphs, isLongDescription } from './model';

export type DescriptionProps = {
  text: string;
  className?: string;
};

export function Description({ text, className }: DescriptionProps) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const id = useId();
  const paragraphs = descriptionParagraphs(text);
  const long = isLongDescription(text);

  if (paragraphs.length === 0) return null;

  return (
    <section className={className} aria-labelledby={`${id}-title`} data-description={long ? (open ? 'open' : 'clamped') : 'short'}>
      <h2 id={`${id}-title`} className="visually-hidden">
        {t('event.description')}
      </h2>
      <div
        id={id}
        className={cn('flex max-w-[62ch] flex-col gap-4 text-[1.0625rem] leading-[1.6]', long && !open && styles.clamp)}
      >
        {paragraphs.map((paragraph, index) => (
          <p key={index} className={cn('whitespace-pre-line text-pretty', index === 0 ? 'text-fg' : 'text-fg-soft')}>
            {paragraph}
          </p>
        ))}
      </div>
      {long ? (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((value) => !value)}
          className="t-ui mt-2 inline-flex min-h-11 items-center gap-2 rounded-xs text-fg underline decoration-line-strong decoration-1 underline-offset-[0.3em] transition-[text-decoration-color] duration-(--duration-fast) ease-out hover:decoration-fg"
        >
          {open ? t('event.showLess') : t('event.showMore')}
          <CaretDown
            size={14}
            weight="bold"
            aria-hidden="true"
            className={cn('transition-transform duration-(--duration-fast) ease-out', open && 'rotate-180')}
          />
        </button>
      ) : null}
    </section>
  );
}
