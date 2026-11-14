import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound, permanentRedirect } from 'next/navigation';

import { EventView } from '@/components/event/EventView';
import { EVENT_GLOW, MORE_LIMIT, catalogHrefFromParam, eventPath, eventTitle, metaDescription, pickMore } from '@/components/event/model';
import { PageShell } from '@/components/shell/PageShell';
import { getEvent, listEvents } from '@/lib/api/server';
import { configuredSiteOrigin } from '@/lib/api/site-origin';
import { localNow } from '@/lib/api/time';
import { getServerT } from '@/lib/i18n/server';

import { applyDebug, debugModeOf } from './debug';
import { imageMetaOf } from './image-meta';

type SearchParams = Record<string, string | string[] | undefined>;

type EventPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
};

/** Адрес сайта из заголовков запроса: нужен, чтобы картинка в Open Graph получила полный адрес. */
async function requestOrigin(): Promise<URL | undefined> {
  const configured = configuredSiteOrigin();
  if (configured) return configured;
  const headerList = await headers();
  const host = headerList.get('x-forwarded-host') ?? headerList.get('host');
  if (!host) return undefined;
  const protocol = headerList.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  try {
    return new URL(`${protocol}://${host}`);
  } catch {
    return undefined;
  }
}

export async function generateMetadata({ params }: EventPageProps): Promise<Metadata> {
  const { id } = await params;
  const { t, lang } = await getServerT();
  const event = await getEvent(id);
  if (!event) return { title: t('event.notFound.title'), robots: { index: false } };

  const cancelled = event.status === 'cancelled';
  const title = cancelled ? `${t('event.cancelled.badge')}: ${eventTitle(event, lang)}` : eventTitle(event, lang);
  const description = metaDescription(event, lang, localNow(new Date()).date);
  const image = imageMetaOf(event.image);
  const path = eventPath(event.id);

  return {
    title,
    description,
    metadataBase: await requestOrigin(),
    alternates: { canonical: path },
    openGraph: {
      type: 'article',
      title,
      description,
      url: path,
      siteName: t('common.brandFull'),
      locale: lang === 'ba' ? 'ba_RU' : 'ru_RU',
      ...(event.image
        ? {
            images: [
              {
                url: event.image,
                ...(image ? { width: image.width, height: image.height, alt: image.alt } : {}),
              },
            ],
          }
        : {}),
    },
    twitter: { card: event.image ? 'summary_large_image' : 'summary', title, description },
    // Условные события в поиске не нужны: по ним никто не должен планировать вечер.
    // Отменённое событие тоже: страница нужна по старой ссылке, но не в поиске.
    ...(event.synthetic || cancelled ? { robots: { index: false, follow: true } } : {}),
  };
}

/**
 * Карточка события. Данные собираются на сервере (событие и ещё несколько событий того же города),
 * а подписи и интерактив живут в клиентском EventView. Неизвестный id отдаёт страницу 404.
 */
export default async function EventPage({ params, searchParams }: EventPageProps) {
  const [{ id }, search] = await Promise.all([params, searchParams]);
  const found = await getEvent(id);
  if (!found) notFound();
  // Старые ссылки вида /events/evt_demo_t4 ведут на постоянный адрес с UUID (п. 8.1).
  if (found.id !== id) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(search)) if (typeof value === 'string') query.set(key, value);
    const tail = query.toString();
    permanentRedirect(`${eventPath(found.id)}${tail ? `?${tail}` : ''}`);
  }

  const debug = debugModeOf(search.debug);
  const event = await applyDebug(found, debug);
  const today = localNow(new Date()).date;

  // Ближайшие события того же города: берём с запасом на случай, если текущее попадёт в выдачу.
  const sameCity =
    debug === 'alone'
      ? []
      : (await listEvents({ city: [event.venue.city], sort: 'date', page: 1, page_size: MORE_LIMIT + 1 })).items;

  const from = typeof search.from === 'string' ? search.from : undefined;

  return (
    <PageShell demoNotice={false} glow={EVENT_GLOW}>
      <EventView
        event={event}
        today={today}
        backHref={catalogHrefFromParam(from)}
        more={pickMore(sameCity, event.id)}
        imageMeta={imageMetaOf(event.image)}
      />
    </PageShell>
  );
}
