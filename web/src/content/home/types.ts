/**
 * Форма текстов главной страницы: по одному типу на сцену.
 *
 * Здесь только тексты, подписи и ссылки. Числа и события сцены получают
 * из API во время выполнения: у сцен с данными есть поле `query` с готовым запросом.
 * Строки заголовков уже разбиты на строки так, как они стоят в сцене.
 */

import type { CategoryId, EventsQuery } from '../../lib/api/types';

export interface HomeLink {
  label: string;
  href: string;
  /** Ссылка ведёт на другой сайт: открывать в новой вкладке с rel="noopener noreferrer". */
  external?: boolean;
}

/** Общая тройка левой панели и титула по центру: надзаголовок, титул по строкам, абзац. */
export interface PanelCopy {
  eyebrow: string;
  /** Титул по строкам, прописными. */
  title: string[];
  /** Абзац не длиннее 25 слов. */
  body: string;
}

// ---------------------------------------------------------------------------
// Сцены
// ---------------------------------------------------------------------------

export interface IntroCopy {
  /** Словесный знак. */
  wordmark: string;
  /** Мелкая строка над знаком. */
  slogan: string;
  /** Главная фраза в две строки. */
  tagline: [string, string];
  body: string;
  /** Матовая карточка слева снизу. */
  card: { title: string[]; note: string };
  /** Подпись у нижнего края. */
  caption: string;
  /** Вертикальный текст на бирке-индикаторе. */
  tag: string;
  cta: HomeLink;
}

export interface HeroCopy {
  title: [string, string];
  /** Абзац справа. Звёздочка в конце отсылает к сноске. */
  body: string;
  footnote: string;
}

export type QuickPickId = 'weekend' | 'kids' | 'free' | 'today';

export interface QuickPick {
  id: QuickPickId;
  label: string;
  href: string;
}

export interface AiCopy {
  title: string;
  /** Короткая метка под заголовком. */
  label: string;
  /** Подпись справа, три строки прописными. */
  caption: string[];
  hint: string;
  /** Честная пометка о том, кто разбирает запрос в прототипе. */
  note: string;
  input: {
    label: string;
    placeholder: string;
    /** Пример запроса: показывается в строке и отправляется по нажатию. */
    example: string;
    submit: string;
    /** Куда отправлять: `${action}?${param}=${encodeURIComponent(текст)}`. */
    action: string;
    param: string;
  };
  quickLabel: string;
  quick: QuickPick[];
}

export interface GalleryCard {
  id: CategoryId;
  label: string;
  note: string;
  href: string;
  image: string;
}

export interface GalleryCopy {
  /** Малая подпись слева. */
  caption: string;
  /** Гигантская фраза строчными. */
  phrase: string;
  cardCta: string;
  /** Шесть категорий по порядку ленты. Последняя: театр, она раскрывается в следующую сцену. */
  cards: GalleryCard[];
}

export interface FullscreenCopy extends PanelCopy {
  /** Запрос за одним ближайшим событием. */
  query: EventsQuery;
  eventCta: string;
  cta: HomeLink;
  empty: string;
}

export interface ThermalCopy extends PanelCopy {
  /** Подписи концов тепловой шкалы. */
  scale: { low: string; high: string };
  /** Запрос за тремя популярными событиями на сегодня. */
  query: EventsQuery;
  cta: HomeLink;
  empty: { text: string; link: HomeLink };
}

export interface BlueprintCopy extends PanelCopy {
  stat: { value: string; label: string };
  /** Пометки «от руки» на чертеже жетона. */
  marks: string[];
  cta: HomeLink;
}

export interface WordmarkCopy {
  eyebrow: string;
  word: string;
  letters: string[];
  body: string;
  /** Подписи линий построения. */
  guides: string[];
}

export type FilterPillId = 'date' | 'city' | 'price' | 'age' | 'category';

export interface FilterPill {
  id: FilterPillId;
  label: string;
  /** Пример значения: показывается на плашке и открывается по ссылке. */
  example: string;
  href: string;
}

export interface FiltersCopy extends PanelCopy {
  pills: FilterPill[];
  cta: HomeLink;
}

export interface DedupCopy extends PanelCopy {
  /** Подпись над стопкой исходных записей. */
  sourcesLabel: string;
  /** Подпись над итоговой карточкой. */
  cardLabel: string;
  cta: HomeLink;
}

export type TrustCardId = 'source' | 'status' | 'unknown' | 'checked';

export interface TrustCard {
  id: TrustCardId;
  title: string;
  text: string;
  link?: HomeLink;
}

export interface TrustCopy {
  eyebrow: string;
  /** Малая подпись над гигантским словом. */
  caption: string;
  /** Гигантское слово строчными. */
  word: string;
  body: string;
  /** Заголовок светлого блока с карточками доверия. */
  blockTitle: string;
  cards: TrustCard[];
}

export interface CitiesCopy {
  eyebrow: string;
  title: string[];
  body: string;
  /**
   * Ключ словаря для числа событий: t(countKey, { count }).
   * Сами числа приходят из GET /api/v1/facets (поле cities).
   */
  countKey: 'events.count';
  /** Адрес каталога для города: `${cityHrefBase}${slug}`. */
  cityHrefBase: string;
  all: HomeLink;
}

export interface PopularCopy {
  eyebrow: string;
  /** Запрос за событиями для широких панелей. Заголовки панелей это названия событий. */
  query: EventsQuery;
  labels: { when: string; where: string; price: string };
  openLabel: string;
  cta: HomeLink;
  empty: string;
}

export type ChooseColumnId = 'site' | 'bot' | 'widget';

export interface ChooseFeature {
  /** Мелкая метка над значением: одинаковая во всех трёх колонках. */
  label: string;
  value: string;
}

export interface ChooseColumn {
  id: ChooseColumnId;
  name: string;
  tagline: string;
  features: ChooseFeature[];
  cta: HomeLink;
  secondary?: HomeLink;
  /** Пометка под кнопкой. У бота появляется, пока адрес не задан в окружении. */
  note?: string;
}

export interface ChooseCopy {
  /** Строка над знаком. */
  eyebrow: string;
  /** Знак под надзаголовком в нужной форме слова. */
  word: string;
  /** Полный заголовок одной строкой: для aria-label и мобильной версии. */
  title: string;
  aside: { name: string; text: string };
  /** Три пункта справа от жетона. */
  points: string[];
  columns: ChooseColumn[];
}

export interface FooterCopy {
  eyebrow: string;
  wordmark: string;
  /** Абзац под знаком. Слово из `highlight` выделяется акцентом. */
  about: string;
  highlight: string;
  /** Три плашки под знаком. */
  buttons: HomeLink[];
  groups: { title: string; links: HomeLink[] }[];
  lang: { label: string; ru: string; ba: string };
  demoNote: string;
  madeFor: string;
  /** Ссылка на авторов фотографий: /about#credits. */
  credits: string;
}

// ---------------------------------------------------------------------------
// Вся главная
// ---------------------------------------------------------------------------

export interface HomeCopy {
  intro: IntroCopy;
  hero: HeroCopy;
  ai: AiCopy;
  gallery: GalleryCopy;
  fullscreen: FullscreenCopy;
  thermal: ThermalCopy;
  blueprint: BlueprintCopy;
  wordmark: WordmarkCopy;
  filters: FiltersCopy;
  dedup: DedupCopy;
  trust: TrustCopy;
  cities: CitiesCopy;
  popular: PopularCopy;
  choose: ChooseCopy;
  footer: FooterCopy;
}

export type HomeSceneId = keyof HomeCopy;
