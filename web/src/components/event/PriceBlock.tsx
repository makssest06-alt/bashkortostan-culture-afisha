'use client';

/**
 * Цена события. «Бесплатно» и «цена не указана» не смешиваются, а несколько тарифов
 * (партер и балкон, взрослый и детский) показаны раздельными строками.
 */

import type { ReactNode } from 'react';

import { PriceTag } from '@/components/ui';
import { formatMinor } from '@/lib/api/format';
import type { AfishaEvent, Offer } from '@/lib/api/types';
import { useT } from '@/lib/i18n';

import { hasOfferList, offerLabel } from './model';

function OfferAmount({ offer }: { offer: Offer }) {
  const { t } = useT();
  if (offer.is_free) {
    return (
      <span data-offer-price="free" className="font-semibold text-status-ok">
        {t('price.free')}
      </span>
    );
  }
  if (offer.amount_minor === null) {
    return (
      <span data-offer-price="unknown" className="text-fg-muted">
        {t('price.unknown')}
      </span>
    );
  }
  return (
    <span data-offer-price="amount" data-num className="font-semibold whitespace-nowrap text-fg">
      {formatMinor(offer.amount_minor)}
    </span>
  );
}

export type PriceBlockProps = {
  event: Pick<AfishaEvent, 'offers' | 'price_summary'>;
  /** Что стоит сразу под итоговой ценой, до списка тарифов: кнопка покупки в правой колонке. */
  action?: ReactNode;
  className?: string;
};

export function PriceBlock({ event, action, className }: PriceBlockProps) {
  const { t } = useT();
  const { offers, price_summary: summary } = event;
  const showList = hasOfferList(offers);

  return (
    <section className={className} aria-label={t('event.price')} data-price-block={summary.kind}>
      <h2 className="t-caps mb-3 text-fg-muted">{showList ? t('price.offers') : t('event.price')}</h2>

      <p className="text-[1.75rem] leading-[1.1] tracking-[-0.03em]">
        <PriceTag price={summary} className={summary.kind === 'unknown' ? 'text-[1.25rem] tracking-normal' : undefined} />
      </p>

      {summary.kind === 'unknown' ? (
        <p className="mt-2 max-w-[44ch] text-[0.875rem] leading-[1.45] text-fg-soft">{t('price.unknownHint')}</p>
      ) : null}

      {action}

      {showList ? (
        <ul className="mt-4 flex flex-col">
          {offers.map((offer) => {
            const label = offerLabel(offer);
            return (
              <li
                key={offer.id}
                data-offer={offer.id}
                className="flex items-baseline justify-between gap-4 border-t border-line py-2.5 text-[0.9375rem] leading-[1.3]"
              >
                <span className="min-w-0 text-fg-soft">{'name' in label ? label.name : t(label.key)}</span>
                <OfferAmount offer={offer} />
              </li>
            );
          })}
        </ul>
      ) : null}

      {summary.kind === 'from' ? (
        <p className="mt-3 max-w-[44ch] text-[0.8125rem] leading-[1.45] text-fg-muted">{t('event.price.note')}</p>
      ) : null}
    </section>
  );
}
