/**
 * Части главной, которые не зависят от языка: порядок сцен, запросы к API,
 * адреса ссылок и картинки. Языковые файлы дают сюда только подписи,
 * поэтому ссылка в русской и башкирской версии не может разойтись.
 */

import { eventsHref } from '../../lib/api/params';
import type { CategoryId, EventsQuery } from '../../lib/api/types';
import { ROUTES, TELEGRAM_BOT_IS_SET, TELEGRAM_BOT_URL } from '../links';
import type {
  ChooseColumn,
  ChooseColumnId,
  ChooseFeature,
  FilterPill,
  FilterPillId,
  GalleryCard,
  HomeLink,
  HomeSceneId,
  QuickPick,
  QuickPickId,
} from './types';

/** Сцены главной в порядке прокрутки. */
export const HOME_SCENE_IDS: readonly HomeSceneId[] = [
  'intro',
  'hero',
  'ai',
  'gallery',
  'fullscreen',
  'thermal',
  'blueprint',
  'wordmark',
  'filters',
  'dedup',
  'trust',
  'cities',
  'popular',
  'choose',
  'footer',
];

/**
 * Запросы сцен к каталогу: их передают в listEvents().
 * Числа по городам сцена cities берёт из getFacets() без условий.
 */
export const HOME_QUERIES: Readonly<Record<'fullscreen' | 'thermal' | 'popular', EventsQuery>> = {
  /** Один ближайший спектакль для раскрытой карточки «Театр». */
  fullscreen: { category: ['theatre'], sort: 'date', page_size: 1 },
  /** Три самых популярных события на сегодня. */
  thermal: { date: 'today', sort: 'popularity', page_size: 3 },
  /** Четыре события для широких панелей ленты. */
  popular: { sort: 'popularity', page_size: 4 },
};

/** Куда отправляется строка запроса сцены ai: /ask?q=текст. */
export const ASK_ACTION = ROUTES.ask;
export const ASK_PARAM = 'q';

/** Адрес ИИ-подбора с готовым запросом. */
export function askHref(text: string): string {
  const query = text.trim();
  return query ? `${ASK_ACTION}?${ASK_PARAM}=${encodeURIComponent(query)}` : ASK_ACTION;
}

/** Адрес каталога для города: `${CITY_HREF_BASE}${slug}`. */
export const CITY_HREF_BASE = `${ROUTES.events}?city=`;

// ---------------------------------------------------------------------------
// Быстрые подборки сцены ai
// ---------------------------------------------------------------------------

const QUICK_PICK_HREFS: Record<QuickPickId, string> = {
  weekend: eventsHref({ date: 'weekend' }),
  kids: eventsHref({ audience: 'kids' }),
  free: eventsHref({ free_only: true }),
  today: eventsHref({ date: 'today' }),
};

const QUICK_PICK_ORDER: readonly QuickPickId[] = ['weekend', 'kids', 'free', 'today'];

export function quickPicks(labels: Record<QuickPickId, string>): QuickPick[] {
  return QUICK_PICK_ORDER.map((id) => ({ id, label: labels[id], href: QUICK_PICK_HREFS[id] }));
}

// ---------------------------------------------------------------------------
// Лента категорий сцены gallery
// ---------------------------------------------------------------------------

/** Театр стоит последним: его карточка раскрывается в сцену fullscreen. */
const GALLERY_ORDER: readonly CategoryId[] = ['concert', 'museum', 'exhibition', 'festival', 'kids', 'theatre'];

const GALLERY_IMAGES: Record<CategoryId, string> = {
  concert: '/images/events/concert-1.webp',
  museum: '/images/events/museum-1.webp',
  exhibition: '/images/events/exhibition-2.webp',
  festival: '/images/events/festival-1.webp',
  kids: '/images/events/kids-1.webp',
  theatre: '/images/events/theatre-1.webp',
};

export function galleryCards(labels: Record<CategoryId, { label: string; note: string }>): GalleryCard[] {
  return GALLERY_ORDER.map((id) => ({
    id,
    label: labels[id].label,
    note: labels[id].note,
    href: eventsHref({ category: [id] }),
    image: GALLERY_IMAGES[id],
  }));
}

// ---------------------------------------------------------------------------
// Плашки сцены filters
// ---------------------------------------------------------------------------

const FILTER_PILL_HREFS: Record<FilterPillId, string> = {
  date: eventsHref({ date: 'weekend' }),
  city: eventsHref({ city: ['ufa'] }),
  price: eventsHref({ price_max: 1000 }),
  age: eventsHref({ age: 6 }),
  category: eventsHref({ category: ['theatre'] }),
};

const FILTER_PILL_ORDER: readonly FilterPillId[] = ['date', 'city', 'price', 'age', 'category'];

export function filterPills(labels: Record<FilterPillId, { label: string; example: string }>): FilterPill[] {
  return FILTER_PILL_ORDER.map((id) => ({
    id,
    label: labels[id].label,
    example: labels[id].example,
    href: FILTER_PILL_HREFS[id],
  }));
}

// ---------------------------------------------------------------------------
// Колонки сцены choose
// ---------------------------------------------------------------------------

export interface ChooseColumnText {
  name: string;
  tagline: string;
  /** Значения по порядку меток из rowLabels. */
  values: string[];
  cta: string;
  secondary?: string;
}

export interface ChooseTexts {
  /** Метки строк сравнения: одни и те же для трёх колонок. */
  rowLabels: string[];
  columns: Record<ChooseColumnId, ChooseColumnText>;
  /** Пометка у бота, пока его адрес не задан в NEXT_PUBLIC_TELEGRAM_BOT_URL. */
  botPendingNote: string;
}

const CHOOSE_ORDER: readonly ChooseColumnId[] = ['site', 'bot', 'widget'];

const CHOOSE_LINKS: Record<ChooseColumnId, { cta: Omit<HomeLink, 'label'>; secondary?: Omit<HomeLink, 'label'> }> = {
  site: { cta: { href: ROUTES.events }, secondary: { href: ROUTES.ask } },
  bot: { cta: { href: TELEGRAM_BOT_URL, external: true } },
  widget: { cta: { href: ROUTES.widget }, secondary: { href: ROUTES.developers } },
};

export function chooseColumns(texts: ChooseTexts): ChooseColumn[] {
  return CHOOSE_ORDER.map((id) => {
    const text = texts.columns[id];
    const links = CHOOSE_LINKS[id];
    const features: ChooseFeature[] = texts.rowLabels.map((label, index) => ({
      label,
      value: text.values[index] ?? '',
    }));
    const column: ChooseColumn = {
      id,
      name: text.name,
      tagline: text.tagline,
      features,
      cta: { label: text.cta, ...links.cta },
    };
    if (links.secondary && text.secondary) column.secondary = { label: text.secondary, ...links.secondary };
    if (id === 'bot' && !TELEGRAM_BOT_IS_SET) column.note = texts.botPendingNote;
    return column;
  });
}

/** Ссылка на Telegram-бота с подписью на нужном языке. */
export function telegramLink(label: string): HomeLink {
  return { label, href: TELEGRAM_BOT_URL, external: true };
}

export { ROUTES };
