/**
 * Сводная цена события. Модуль без серверных зависимостей: его используют и API, и клиент.
 */

import type { Offer, PriceSummary } from './types';

/**
 * Сводная цена для карточки. Считается по общим билетам (без пометки или «взрослый»);
 * детские и льготные тарифы на сводку не влияют. «Бесплатно» появляется только
 * из явной пометки, из неизвестной цены оно не выводится.
 */
export function summarizePrice(offers: readonly Offer[]): PriceSummary {
  const general = offers.filter((offer) => offer.audience === undefined || offer.audience === 'adult');
  const considered = general.length > 0 ? general : offers;
  if (considered.length === 0) return { kind: 'unknown' };
  if (considered.every((offer) => offer.is_free)) return { kind: 'free' };
  const amounts = considered
    .filter((offer) => !offer.is_free && offer.amount_minor !== null)
    .map((offer) => offer.amount_minor as number);
  if (amounts.length === 0) return { kind: 'unknown' };
  return { kind: 'from', amount_minor: Math.min(...amounts) };
}
