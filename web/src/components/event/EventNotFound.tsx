'use client';

/**
 * Страница «такого события нет»: объяснение, ссылка в каталог и ссылка на подбор по фразе.
 * Клиентский компонент: подписи сразу меняются при переключении языка.
 */

import { ArrowRight } from '@phosphor-icons/react';

import { KuskarRing } from '@/components/ornament';
import { Button } from '@/components/ui';
import { ROUTES } from '@/content/links';
import { useT } from '@/lib/i18n';

export function EventNotFound() {
  const { t } = useT();

  return (
    <div
      className="grid items-center gap-x-16 gap-y-10 py-6 md:grid-cols-[minmax(0,1fr)_auto] md:py-14"
      data-event-not-found=""
    >
      <div className="flex min-w-0 flex-col items-start">
        <p className="t-caps text-copper-hi" data-num>
          404
        </p>
        <h1 className="t-heading mt-4 max-w-[16ch]">{t('event.notFound.title')}</h1>
        <p className="t-lead mt-5 max-w-[44ch] text-fg-soft">{t('event.notFound.text')}</p>
        <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
          <Button href={ROUTES.events} size="lg">
            {t('event.notFound.action')}
            <ArrowRight size={18} weight="bold" aria-hidden="true" />
          </Button>
          <Button variant="link" href={ROUTES.ask}>
            {t('nav.ask')}
          </Button>
        </div>
      </div>
      <KuskarRing size="clamp(140px, 22vw, 300px)" className="text-line-strong max-md:hidden" />
    </div>
  );
}
