'use client';

/**
 * Площадка: название, город, адрес и карта.
 * Есть координаты: встроенная карта OpenStreetMap (грузится лениво) и ссылка на точку в Яндекс Картах.
 * Координат нет: только адрес и ссылка поиска по адресу. Точку на карте без координат не выдумываем.
 */

import { ArrowUpRight, MapPin } from '@phosphor-icons/react';
import { useId } from 'react';

import { Button } from '@/components/ui';
import type { Venue } from '@/lib/api/types';
import { cn } from '@/lib/cn';
import { pick, useT } from '@/lib/i18n';

import { copy } from './copy';
import styles from './event.module.css';
import { hasCoordinates, osmEmbedUrl, yandexMapsUrl } from './model';

const OSM_COPYRIGHT_URL = 'https://www.openstreetmap.org/copyright';

export type VenueBlockProps = {
  venue: Venue;
  className?: string;
};

export function VenueBlock({ venue, className }: VenueBlockProps) {
  const { t, lang } = useT();
  const titleId = useId();
  const withMap = hasCoordinates(venue);
  const mapsUrl = yandexMapsUrl(venue);
  const city = pick(venue.city_name, lang);

  return (
    <section
      className={className}
      aria-labelledby={titleId}
      data-venue={venue.id}
      data-venue-map={withMap ? 'embed' : 'search'}
    >
      <h2 id={titleId} className="t-caps mb-4 text-fg-muted">
        {t('event.venue')}
      </h2>

      <div className={cn('grid gap-x-10 gap-y-6', withMap && 'md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:items-start')}>
        <div className="flex min-w-0 flex-col gap-4">
          <p className="t-subtitle max-w-[22ch]">{venue.name}</p>

          <address className="flex items-start gap-2.5 text-[1.0625rem] leading-[1.4] not-italic">
            <MapPin size={20} weight="bold" aria-hidden="true" className="mt-0.5 shrink-0 text-fg-muted" />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-fg" data-venue-address={venue.address ? 'known' : 'unknown'}>
                {venue.address ? `${city}, ${venue.address}` : city}
              </span>
              {venue.address ? null : <span className="text-[0.9375rem] text-fg-muted">{t('event.addressUnknown')}</span>}
            </span>
          </address>

          <Button variant="link" href={mapsUrl} external className="self-start" data-venue-link="">
            {copy(withMap ? 'openYandex' : 'findYandex', lang)}
            <ArrowUpRight size={16} weight="bold" aria-hidden="true" />
          </Button>
        </div>

        {withMap ? (
          <div className="flex min-w-0 flex-col gap-2">
            <div className={styles.map}>
              <iframe
                src={osmEmbedUrl(venue.lat, venue.lon)}
                title={copy('mapTitle', lang, { venue: venue.name })}
                loading="lazy"
                referrerPolicy="strict-origin-when-cross-origin"
                sandbox="allow-scripts allow-same-origin"
                tabIndex={-1}
                className={styles.mapFrame}
              />
              {/* Карта здесь картинка места: нажатие по ней ведёт туда же, куда текстовая ссылка рядом. */}
              <a
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                tabIndex={-1}
                aria-hidden="true"
                className={styles.mapLink}
              />
            </div>
            <a
              href={OSM_COPYRIGHT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-6 items-center self-start rounded-xs text-[0.75rem] leading-[1.3] text-fg-soft underline decoration-line-strong decoration-1 underline-offset-[0.25em] transition-colors duration-(--duration-fast) ease-out hover:text-fg pointer-coarse:min-h-11"
            >
              {copy('mapCredit', lang)}
            </a>
          </div>
        ) : null}
      </div>
    </section>
  );
}
