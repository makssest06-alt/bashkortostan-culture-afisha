/**
 * Список событий для страницы /embed: серверная разметка без клиентского кода.
 * Повторяет то, что рисует public/widget.js: те же блоки, подписи и правила показа
 * (три состояния цены, статус сеанса одной плашкой, время проверки, пометка «Демо-данные»).
 * Работает и в iframe с запретом скриптов (sandbox без allow-scripts).
 */

import type { CSSProperties } from 'react';

import { ROUTES } from '@/content/links';
import { DATE_PRESETS, displayStatusOf, getCategory, getCity } from '@/data/dictionaries';
import { formatAgo, formatDay, formatOccurrence, formatPrice } from '@/lib/api/format';
import { eventsHref } from '@/lib/api/params';
import { valueDate, valueTime } from '@/lib/api/time';
import type { DisplayStatus, EventListItem, EventsListResponse, Occurrence } from '@/lib/api/types';
import { createT } from '@/lib/i18n/dict';
import type { TKey } from '@/lib/i18n/dict';
import { pick } from '@/lib/i18n/lang';
import type { Lang } from '@/lib/i18n/lang';

import { WIDGET_COPY } from './copy';
import styles from './embed.module.css';
import type { EmbedParams } from './settings';

const STATUS_KEYS: Record<DisplayStatus, TKey> = {
  scheduled: 'status.scheduled',
  cancelled: 'status.cancelled',
  postponed: 'status.postponed',
  rescheduled: 'status.rescheduled',
  sold_out: 'status.soldOut',
  unverified: 'status.unverified',
};

export type EmbedViewProps = {
  params: EmbedParams;
  /** Ответ каталога. null: запрос не выполнялся (ошибка в параметрах) или не удался. */
  data: EventsListResponse | null;
  /** Каталог не ответил: показываем ошибку со ссылкой на повтор. */
  failed: boolean;
  /** Момент сборки страницы: от него считается «проверено 2 часа назад». */
  now: number;
  /** Адрес этой же страницы: ссылка «Повторить» работает без скриптов. */
  retryHref: string;
};

function occurrenceParts(occurrence: Occurrence, lang: Lang, today: string): string[] {
  if (occurrence.start.precision === 'minute') {
    const time = valueTime(occurrence.start);
    const day = formatDay(valueDate(occurrence.start), lang, { weekday: 'short' });
    return time ? [day, time] : [day];
  }
  return [formatOccurrence(occurrence, lang, today)];
}

function NewTabHint({ lang }: { lang: Lang }) {
  return <span className="visually-hidden"> ({pick(WIDGET_COPY.newTab, lang)})</span>;
}

function Item({ event, lang, today, now, index }: { event: EventListItem; lang: Lang; today: string; now: number; index: number }) {
  const t = createT(lang);
  const occurrence = event.occurrences.find((item) => item.id === event.primary_occurrence_id) ?? event.occurrences[0];
  const title = lang === 'ba' && event.title_ba ? event.title_ba : event.title;
  const status = occurrence ? displayStatusOf(occurrence) : null;

  return (
    <li className={styles.item} style={{ '--i': index } as CSSProperties}>
      {occurrence ? (
        <time dateTime={occurrence.start.local} className={`${styles.caps} ${styles.date}`}>
          {occurrenceParts(occurrence, lang, today).map((part) => (
            <span key={part}>{part}</span>
          ))}
        </time>
      ) : null}
      <h2 className={styles.name}>
        <a href={`${ROUTES.events}/${encodeURIComponent(event.id)}`} target="_blank" rel="noopener" className={styles.link}>
          {title}
          <NewTabHint lang={lang} />
        </a>
      </h2>
      <p className={styles.place}>
        {event.venue.name}, {pick(event.venue.city_name, lang)}
      </p>
      <p className={styles.facts}>
        <span className={styles.price} data-kind={event.price_summary.kind}>
          {formatPrice(event.price_summary, lang)}
        </span>
        {status ? (
          <span className={styles.status} data-status={status}>
            {t(STATUS_KEYS[status])}
          </span>
        ) : null}
        <span className={styles.checked}>
          {pick(WIDGET_COPY.checked, lang).replace('{ago}', formatAgo(event.source.checked_at, new Date(now), lang))}
        </span>
      </p>
    </li>
  );
}

/** Подпись под заголовком: «Уфа, театр». */
function scopeLabel(params: EmbedParams): string {
  const cities = params.cities.map((id) => getCity(id)).flatMap((entry) => (entry ? [pick(entry.name, params.lang)] : []));
  const categories = params.categories
    .map((id) => getCategory(id))
    .flatMap((entry) => (entry ? [pick(entry.name, params.lang)] : []));
  const period = params.period ? DATE_PRESETS.find((entry) => entry.id === params.period) : null;
  return [...cities, ...categories, ...(period ? [pick(period.label, params.lang)] : [])].join(', ');
}

export function EmbedView({ params, data, failed, now, retryHref }: EmbedViewProps) {
  const { lang } = params;
  const t = createT(lang);
  const badParams = params.unknownCities.length > 0 || params.unknownCategories.length > 0;
  const items = data?.items ?? [];
  const demo = items.some((item) => item.synthetic);
  const filtered = items.length > 0;
  const allHref = filtered
    ? eventsHref({ city: params.cities, category: params.categories, ...(params.period ? { date: params.period } : {}) })
    : ROUTES.events;

  return (
    <main
      className={styles.box}
      data-theme={params.theme}
      data-embed
      lang={lang}
      // Высота из параметра height: коробка не растёт, длинный список прокручивается внутри.
      style={params.height !== null ? { height: params.height, overflowY: 'auto' } : undefined}
    >
      <div className={styles.head}>
        <h1 className={styles.title}>{t('widget.heading')}</h1>
        {filtered && scopeLabel(params) ? <p className={`${styles.caps} ${styles.scope}`}>{scopeLabel(params)}</p> : null}
      </div>

      {badParams ? (
        <div className={styles.note} role="alert" data-state="invalid">
          {params.unknownCities.length > 0 ? (
            <p className={styles.noteTitle}>
              {pick(WIDGET_COPY.unknownCity, lang).replace('{values}', params.unknownCities.join(', '))}
            </p>
          ) : null}
          {params.unknownCategories.length > 0 ? (
            <p className={styles.noteTitle}>
              {pick(WIDGET_COPY.unknownCategory, lang).replace('{values}', params.unknownCategories.join(', '))}
            </p>
          ) : null}
          <p className={styles.noteText}>{pick(WIDGET_COPY.unknownHint, lang)}</p>
        </div>
      ) : failed || !data ? (
        <>
          <div className={styles.note} role="alert" data-state="error">
            <p className={styles.noteTitle}>{pick(WIDGET_COPY.loadFailed, lang)}</p>
            <p className={styles.noteText}>{pick(WIDGET_COPY.loadFailedHint, lang)}</p>
          </div>
          <div className={styles.noteActions}>
            <a href={retryHref} className={styles.button}>
              {t('common.retry')}
            </a>
          </div>
        </>
      ) : items.length === 0 ? (
        <div className={styles.note} role="status" data-state="empty">
          <p className={styles.noteTitle}>{t('widget.empty')}</p>
        </div>
      ) : (
        <ul className={styles.list}>
          {items.map((event, index) => (
            <Item key={event.id} event={event} lang={lang} today={data.reference_date} now={now} index={index} />
          ))}
        </ul>
      )}

      <div className={styles.foot}>
        <a href={allHref} target="_blank" rel="noopener" className={styles.anchor}>
          {t('widget.allEvents')}
          <NewTabHint lang={lang} />
        </a>
        <div className={styles.footSide}>
          {demo ? (
            <a href={ROUTES.aboutDemo} target="_blank" rel="noopener" className={styles.anchor} data-quiet>
              {t('common.demoData')}
              <NewTabHint lang={lang} />
            </a>
          ) : null}
          <a href={ROUTES.home} target="_blank" rel="noopener" className={styles.anchor} data-quiet>
            {t('widget.poweredBy')}
            <NewTabHint lang={lang} />
          </a>
        </div>
      </div>
    </main>
  );
}
