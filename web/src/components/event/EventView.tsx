'use client';

/**
 * Страница события целиком: журнальная раскладка из заголовка, картинки 3:4, колонки с сеансами
 * и ценой, описания, площадки и блока доверия. Данные приходят с сервера готовыми, здесь только
 * подписи на выбранном языке и интерактив (раскрытие списков, «Поделиться», возврат в каталог).
 */

import { Info, XCircle } from '@phosphor-icons/react';
import Link from 'next/link';
import type { CSSProperties } from 'react';

import { AgeBadge, PriceTag } from '@/components/ui';
import { ROUTES } from '@/content/links';
import { getCategory } from '@/data/dictionaries';
import { formatOccurrence } from '@/lib/api/format';
import { eventsHref } from '@/lib/api/params';
import type { AfishaEvent } from '@/lib/api/types';
import { cn } from '@/lib/cn';
import { IS_DEMO_DATA } from '@/lib/env';
import { pick, useT } from '@/lib/i18n';

import { BackLink } from './BackLink';
import { BuyAction } from './BuyAction';
import { copy } from './copy';
import { Description } from './Description';
import styles from './event.module.css';
import { EventMedia } from './EventMedia';
import { Fact, FactList } from './Facts';
import { LONG_TITLE, eventPath, eventTitle, nearestSession } from './model';
import type { ImageMeta, MoreItem } from './model';
import { MoreInCity } from './MoreInCity';
import { PriceBlock } from './PriceBlock';
import { Sessions } from './Sessions';
import { ShareButton } from './ShareButton';
import { TrustBlock } from './TrustBlock';
import { VenueBlock } from './VenueBlock';

const AGE_KEYS = {
  '0+': 'age.0',
  '6+': 'age.6',
  '12+': 'age.12',
  '16+': 'age.16',
  '18+': 'age.18',
} as const;

/** Номер блока в каскаде появления. */
const order = (index: number): CSSProperties => ({ '--i': index }) as CSSProperties;

export type EventViewProps = {
  event: AfishaEvent;
  /** Сегодняшняя дата афиши (пояс Asia/Yekaterinburg), посчитанная сервером. */
  today: string;
  /** Адрес каталога, известный серверу: из ?from=... или каталог без условий. */
  backHref: string;
  /** Другие события того же города. */
  more: readonly MoreItem[];
  imageMeta: ImageMeta | null;
};

/**
 * Пометка отменённого события (п. 6.1): событие пропало из выдачи, но по прямой ссылке
 * открывается, и первое, что видит человек, это крупное «Отменено».
 */
function CancelledNotice({ backHref }: { backHref: string }) {
  const { t } = useT();
  return (
    <div className="mb-6 flex flex-col gap-3 rounded-sm border-2 border-status-cancelled bg-status-cancelled/10 px-5 py-5 md:mb-8 md:px-6" data-event-cancelled="">
      <p className="flex items-center gap-3 text-status-cancelled">
        <XCircle size={36} weight="fill" aria-hidden="true" className="shrink-0" />
        <span className="text-[clamp(1.75rem,4vw,2.75rem)] leading-none font-semibold tracking-tight uppercase">{t('event.cancelled.badge')}</span>
      </p>
      <p className="t-body max-w-[60ch] text-fg">{t('event.cancelled.text')}</p>
      <Link href={backHref} className="self-start text-[0.9375rem] text-fg underline decoration-line-strong underline-offset-4 hover:decoration-fg">
        {t('event.cancelled.catalog')}
      </Link>
    </div>
  );
}

export function EventView({ event, today, backHref, more, imageMeta }: EventViewProps) {
  const { t, lang } = useT();
  const cancelled = event.status === 'cancelled';
  const title = eventTitle(event, lang);
  const category = getCategory(event.category);
  const nearest = nearestSession(event.occurrences);
  // Дата в шапке стоит, только если на этот сеанс можно идти: отменённый показан в списке сеансов.
  const nearestIsLive = nearest !== null && nearest.status !== 'cancelled' && nearest.status !== 'postponed';
  const city = pick(event.venue.city_name, lang);

  return (
    <>
      <div className={styles.page} data-event={event.id}>
        <nav aria-label={copy('crumbs', lang)} className="mb-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 md:mb-8">
          <BackLink fallbackHref={backHref} />
          {event.synthetic && IS_DEMO_DATA ? (
            <Link
              href={ROUTES.aboutDemo}
              className="t-caps inline-flex min-h-11 items-center gap-2 rounded-sm border border-line-strong px-3 text-fg transition-colors duration-(--duration-fast) ease-out hover:bg-hover"
              data-event-demo=""
            >
              <Info size={16} weight="bold" aria-hidden="true" className="shrink-0" />
              {t('common.demoData')}
            </Link>
          ) : null}
        </nav>

        <article className={styles.layout}>
          <header className={cn(styles.head, styles.reveal)} style={order(0)}>
            {cancelled ? <CancelledNotice backHref={backHref} /> : null}
            <p className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {category ? (
                <Link
                  href={eventsHref({ category: [event.category] })}
                  className="t-caps inline-flex min-h-6 items-center rounded-xs text-copper-hi underline decoration-transparent decoration-1 underline-offset-[0.3em] transition-[text-decoration-color] duration-(--duration-fast) ease-out hover:decoration-current pointer-coarse:min-h-11"
                  data-event-category={event.category}
                >
                  {pick(category.name_one, lang)}
                </Link>
              ) : null}
              <AgeBadge rating={event.age_rating} />
            </p>

            <h1 className={cn(styles.title, 'mt-3 md:mt-4')} data-long={title.length > LONG_TITLE ? '' : undefined}>
              {title}
            </h1>

            <p className="t-lead mt-5 flex max-w-[52ch] flex-col gap-1 md:mt-6">
              {nearest && nearestIsLive ? (
                <time dateTime={nearest.start.local} className="text-fg first-letter:uppercase" data-event-when="">
                  {formatOccurrence(nearest, lang, today)}
                </time>
              ) : null}
              <span className="text-balance text-fg-soft">
                {event.venue.name}, {city}
              </span>
            </p>
          </header>

          <div className={cn(styles.media, styles.reveal)} style={order(1)}>
            <EventMedia image={event.image} meta={imageMeta} category={event.category} />
          </div>

          <aside className={cn(styles.aside, styles.reveal)} style={order(3)}>
            <div className={cn(styles.asideInner, 'flex flex-col gap-8')}>
              <Sessions occurrences={event.occurrences} today={today} />
              <PriceBlock
                event={event}
                action={cancelled ? null : <BuyAction event={event} variant="panel" className={cn(styles.panelOnly, 'mt-5')} />}
              />
              <ShareButton title={title} path={eventPath(event.id)} />
            </div>
          </aside>

          <div className={cn(styles.desc, styles.reveal, 'flex flex-col gap-8')} style={order(2)}>
            <Description text={event.description} />

            <FactList>
              {category ? <Fact label={t('event.category')}>{pick(category.name, lang)}</Fact> : null}
              <Fact label={t('event.age')}>
                {event.age_rating ? (
                  <span data-event-age={event.age_rating}>
                    <span data-num>{event.age_rating}</span>
                    <span className="text-fg-soft">, {t(AGE_KEYS[event.age_rating]).toLowerCase()}</span>
                  </span>
                ) : (
                  <span data-event-age="unknown">
                    {t('age.unknown')}
                    <span className="mt-0.5 block text-[0.875rem] text-fg-muted">{t('age.unknownHint')}</span>
                  </span>
                )}
              </Fact>
              {event.organizer && event.organizer !== event.venue.name ? (
                <Fact label={t('event.organizer')}>{event.organizer}</Fact>
              ) : null}
            </FactList>

            <TrustBlock event={event} />
          </div>

          <div className={cn(styles.venue, styles.reveal)} style={order(4)}>
            <VenueBlock venue={event.venue} />
          </div>
        </article>

        {cancelled ? null : (
          <div className={styles.bar} data-event-bar="">
            <p className="flex min-w-0 flex-col gap-0.5">
              {nearest && nearestIsLive ? (
                <time dateTime={nearest.start.local} className="t-caps truncate text-fg-muted">
                  {formatOccurrence(nearest, lang, today)}
                </time>
              ) : null}
              <PriceTag price={event.price_summary} className="text-[1.0625rem] leading-[1.2]" />
            </p>
            <BuyAction event={event} variant="bar" className="shrink-0" />
          </div>
        )}
      </div>

      <MoreInCity city={event.venue.city} items={more} today={today} className="mt-16 md:mt-24" />
    </>
  );
}
