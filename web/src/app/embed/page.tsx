import type { Metadata } from 'next';

import { EmbedView } from '@/components/widget/EmbedView';
import { EMBED_PATH, parseEmbedParams } from '@/components/widget/settings';
import type { EmbedParams } from '@/components/widget/settings';
import { listEvents } from '@/lib/api/server';
import type { EventsListResponse } from '@/lib/api/types';
import { createT } from '@/lib/i18n/dict';
import { getServerLang } from '@/lib/i18n/server';

type SearchParams = Record<string, string | string[] | undefined>;

export async function generateMetadata({ searchParams }: { searchParams: Promise<SearchParams> }): Promise<Metadata> {
  const params = parseEmbedParams(await searchParams, await getServerLang());
  // Страница для вставки в чужой сайт через iframe: в поиске ей делать нечего.
  return { title: createT(params.lang)('widget.heading'), robots: { index: false, follow: false } };
}

type Loaded = {
  data: EventsListResponse | null;
  failed: boolean;
  /** Момент сборки страницы: от него считается «проверено N часов назад». */
  renderedAt: number;
};

async function load(params: EmbedParams): Promise<Loaded> {
  const renderedAt = Date.now();
  // Незнакомый город или категория: событий не запрашиваем, страница назовёт ошибку в параметрах.
  if (params.unknownCities.length > 0 || params.unknownCategories.length > 0) {
    return { data: null, failed: false, renderedAt };
  }
  try {
    const data = await listEvents({
      city: params.cities,
      category: params.categories,
      ...(params.period ? { date: params.period } : {}),
      sort: 'date',
      page: 1,
      page_size: params.limit,
    });
    return { data, failed: false, renderedAt };
  } catch (error) {
    console.error('[embed] каталог не ответил', error);
    return { data: null, failed: true, renderedAt };
  }
}

/** Адрес этой же страницы с теми же настройками: ссылка «Повторить» работает без скриптов. */
function selfHref(params: EmbedParams): string {
  const search = new URLSearchParams();
  if (params.cities.length > 0) search.set('city', params.cities.join(','));
  if (params.categories.length > 0) search.set('category', params.categories.join(','));
  if (params.period) search.set('period', params.period);
  if (params.height !== null) search.set('height', String(params.height));
  search.set('limit', String(params.limit));
  search.set('theme', params.theme);
  search.set('lang', params.lang);
  return `${EMBED_PATH}?${search.toString()}`;
}

/** Цвет подложки под коробкой списка: тот же, что --bg в embed.module.css. */
const PAGE_BG = { light: '#fffdf8', dark: '#171311' } as const;

/**
 * /embed: список ближайших событий без шапки и подвала сайта, для вставки через iframe.
 * Параметры: city, category (можно несколько через запятую), period (today | tomorrow | weekend | week),
 * height (высота в пикселях, 240–1600), limit (1-10), theme (light | dark), lang (ru | ba).
 * Список собирается на сервере и не требует скриптов: подходит сайтам, где сторонние скрипты запрещены.
 */
export default async function EmbedPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = parseEmbedParams(await searchParams, await getServerLang());
  const { data, failed, renderedAt } = await load(params);

  // Общие стили сайта задают тёмный фон и прячут полосу прокрутки. Внутри iframe нужен фон темы виджета
  // и обычная полоса: высоту iframe выбирает чужой сайт, и список может не поместиться целиком.
  const pageStyle =
    `html,body{background:${PAGE_BG[params.theme]};color-scheme:${params.theme}}` +
    'html{scrollbar-width:thin}html::-webkit-scrollbar{display:block;width:8px}';

  return (
    <>
      <style>{pageStyle}</style>
      <EmbedView params={params} data={data} failed={failed} now={renderedAt} retryHref={selfHref(params)} />
    </>
  );
}
