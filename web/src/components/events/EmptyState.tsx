'use client';

/**
 * Пустая выдача. Вместо «ничего не найдено» показываем, какое одно условие стоит изменить
 * и сколько событий тогда найдётся. Числа посчитаны сервером настоящим поиском.
 */

import { ArrowRight } from '@phosphor-icons/react';

import { Button } from '@/components/ui';
import { ROUTES } from '@/content/links';
import type { Relaxation } from '@/lib/api/types';
import { pick, useT } from '@/lib/i18n';

import { queryKey } from './query';

export type EmptyStateProps = {
  relaxations: Relaxation[];
  onApply: (relaxation: Relaxation) => void;
  onReset: () => void;
};

export function EmptyState({ relaxations, onApply, onReset }: EmptyStateProps) {
  const { t, lang } = useT();
  const options = relaxations.filter((item) => item.query);

  return (
    <div className="flex flex-col gap-8 pt-8" data-empty-state="">
      <div className="flex max-w-[52ch] flex-col gap-3">
        <h3 className="t-subtitle">{t('empty.title')}</h3>
        <p className="t-body text-fg-soft">{options.length > 0 ? t('empty.hint') : t('empty.noOptions')}</p>
      </div>

      {options.length > 0 ? (
        <ul className="flex max-w-[720px] flex-col border-b border-line">
          {options.map((item) => (
            // Вариантов с одним кодом бывает несколько («В пятницу» и «В любой день»): ключом служит сам запрос.
            <li key={item.query ? queryKey(item.query) : item.codes.join('+')} className="border-t border-line">
              <button
                type="button"
                onClick={() => onApply(item)}
                data-relaxation={item.code}
                className="group -mx-3 flex min-h-16 w-[calc(100%+1.5rem)] items-center justify-between gap-6 rounded-sm px-3 py-4 text-left transition-[background-color] duration-(--duration-fast) ease-out hover:bg-hover active:bg-hover"
              >
                <span className="text-[1.25rem] leading-[1.15] font-semibold tracking-[-0.02em] text-fg md:text-[1.5rem]">
                  {pick(item.label, lang)}
                </span>
                <span className="flex shrink-0 items-center gap-3 text-fg-soft">
                  <span data-num className="text-[0.9375rem] font-medium whitespace-nowrap">
                    {t('events.count', { count: item.count })}
                  </span>
                  <ArrowRight
                    size={20}
                    weight="bold"
                    aria-hidden="true"
                    className="text-copper-hi transition-[translate] duration-(--duration-fast) ease-out group-hover:translate-x-1"
                  />
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <Button variant="ghost" onClick={onReset}>
          {t('empty.reset')}
        </Button>
        <Button variant="link" href={ROUTES.ask}>
          {t('empty.askAi')}
        </Button>
      </div>
    </div>
  );
}
