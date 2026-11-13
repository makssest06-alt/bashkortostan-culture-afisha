/**
 * Настройки виджета: одна модель для страницы /widget, страницы /embed и кода вставки.
 * Чистый модуль без React: работает и на сервере, и в браузере.
 *
 * Атрибуты и их порядок здесь те же, что читает public/widget.js: живой пример на /widget
 * собирается из widgetAttributes(), поэтому показанная строка кода и пример не расходятся.
 */

import { CATEGORIES, CITIES, DATE_PRESETS, isCategoryId, isCityId } from '@/data/dictionaries';
import type { CategoryId, CityId, DatePreset } from '@/lib/api/types';
import { isLang } from '@/lib/i18n/lang';
import type { Lang } from '@/lib/i18n/lang';

export type WidgetTheme = 'light' | 'dark';

export type WidgetSettings = {
  /** Пустая строка: вся республика. */
  city: CityId | '';
  /** Пустая строка: все категории. */
  category: CategoryId | '';
  /** Период п. 6.3: сегодня, завтра, выходные, неделя. Пустая строка: все ближайшие. */
  period: DatePreset | '';
  /** Высота виджета в пикселях п. 6.3. null: по содержимому. Длинный список прокручивается внутри. */
  height: number | null;
  limit: number;
  theme: WidgetTheme;
  lang: Lang;
};

export const WIDGET_MIN_HEIGHT = 240;
export const WIDGET_MAX_HEIGHT = 1600;
/** Варианты в настройке «Высота». */
export const WIDGET_HEIGHT_OPTIONS: readonly number[] = [320, 480, 640, 800];
export const WIDGET_PERIOD_IDS: readonly DatePreset[] = DATE_PRESETS.map((entry) => entry.id);

function isPeriod(value: string): value is DatePreset {
  return WIDGET_PERIOD_IDS.includes(value as DatePreset);
}

/** Высота из параметра: число в пределах 240–1600 или null («по содержимому»). */
export function parseHeight(value: string): number | null {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return null;
  return Math.min(WIDGET_MAX_HEIGHT, Math.max(WIDGET_MIN_HEIGHT, number));
}

export const WIDGET_MIN_LIMIT = 1;
export const WIDGET_MAX_LIMIT = 10;
export const WIDGET_DEFAULT_LIMIT = 5;
/** Варианты в настройке «Сколько событий». */
export const WIDGET_LIMIT_OPTIONS: readonly number[] = [3, 4, 5, 6, 8, 10];

export const WIDGET_SCRIPT_PATH = '/widget.js';
export const EMBED_PATH = '/embed';

export function defaultWidgetSettings(lang: Lang): WidgetSettings {
  return { city: '', category: '', period: '', height: null, limit: WIDGET_DEFAULT_LIMIT, theme: 'light', lang };
}

type RawParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  const single = Array.isArray(value) ? value[0] : value;
  return typeof single === 'string' ? single.trim().toLowerCase() : '';
}

export function clampLimit(value: number): number {
  if (!Number.isFinite(value)) return WIDGET_DEFAULT_LIMIT;
  return Math.min(WIDGET_MAX_LIMIT, Math.max(WIDGET_MIN_LIMIT, Math.trunc(value)));
}

/** Настройки страницы /widget из адресной строки. Всё незнакомое молча заменяется значением по умолчанию. */
export function parseWidgetSettings(raw: RawParams, fallbackLang: Lang): WidgetSettings {
  const base = defaultWidgetSettings(fallbackLang);
  const city = first(raw.city);
  const category = first(raw.category);
  const limit = first(raw.limit);
  const theme = first(raw.theme);
  const lang = first(raw.lang);
  const period = first(raw.period);
  return {
    city: isCityId(city) ? city : base.city,
    category: isCategoryId(category) ? category : base.category,
    period: isPeriod(period) ? period : base.period,
    height: parseHeight(first(raw.height)),
    limit: limit ? clampLimit(Number(limit)) : base.limit,
    theme: theme === 'dark' ? 'dark' : 'light',
    lang: isLang(lang) ? lang : base.lang,
  };
}

/** Параметры адреса /widget: только то, что отличается от значений по умолчанию. */
export function widgetSettingsToSearch(settings: WidgetSettings, fallbackLang: Lang): string {
  const base = defaultWidgetSettings(fallbackLang);
  const params = new URLSearchParams();
  if (settings.city) params.set('city', settings.city);
  if (settings.category) params.set('category', settings.category);
  if (settings.period) params.set('period', settings.period);
  if (settings.height !== null) params.set('height', String(settings.height));
  if (settings.limit !== base.limit) params.set('limit', String(settings.limit));
  if (settings.theme !== base.theme) params.set('theme', settings.theme);
  if (settings.lang !== base.lang) params.set('lang', settings.lang);
  const text = params.toString();
  return text ? `?${text}` : '';
}

/** Атрибуты тега script в том порядке, в каком они стоят в коде вставки. */
export function widgetAttributes(settings: WidgetSettings): [name: string, value: string][] {
  const attributes: [string, string][] = [];
  if (settings.city) attributes.push(['data-city', settings.city]);
  if (settings.category) attributes.push(['data-category', settings.category]);
  if (settings.period) attributes.push(['data-period', settings.period]);
  if (settings.height !== null) attributes.push(['data-height', String(settings.height)]);
  attributes.push(['data-limit', String(settings.limit)]);
  attributes.push(['data-theme', settings.theme]);
  attributes.push(['data-lang', settings.lang]);
  return attributes;
}

/** Код вставки одной строкой: тег script. */
export function scriptSnippet(origin: string, settings: WidgetSettings): string {
  const attributes = widgetAttributes(settings)
    .map(([name, value]) => `${name}="${value}"`)
    .join(' ');
  return `<script src="${origin}${WIDGET_SCRIPT_PATH}" ${attributes} async></script>`;
}

/** Адрес страницы /embed с теми же настройками. */
export function embedHref(settings: WidgetSettings): string {
  const params = new URLSearchParams();
  if (settings.city) params.set('city', settings.city);
  if (settings.category) params.set('category', settings.category);
  if (settings.period) params.set('period', settings.period);
  if (settings.height !== null) params.set('height', String(settings.height));
  params.set('limit', String(settings.limit));
  params.set('theme', settings.theme);
  params.set('lang', settings.lang);
  return `${EMBED_PATH}?${params.toString()}`;
}

/**
 * Высота iframe с запасом на узкую колонку: на телефоне строка события занимает четыре строки текста.
 * В широкой колонке строки просто становятся просторнее: список на /embed растягивается на всю высоту.
 */
export function embedHeight(limit: number): number {
  return 160 + clampLimit(limit) * 112;
}

/** Код вставки одной строкой: iframe. Амперсанды записаны как &amp;: так требует HTML. */
export function iframeSnippet(origin: string, settings: WidgetSettings, title: string): string {
  const src = `${origin}${embedHref(settings)}`.replace(/&/g, '&amp;');
  const safeTitle = title.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const height = settings.height ?? embedHeight(settings.limit);
  return `<iframe src="${src}" title="${safeTitle}" loading="lazy" width="100%" height="${height}" style="border:0"></iframe>`;
}

// ---------------------------------------------------------------------------
// Параметры страницы /embed
// ---------------------------------------------------------------------------

export type EmbedParams = {
  cities: CityId[];
  categories: CategoryId[];
  period: DatePreset | null;
  height: number | null;
  limit: number;
  theme: WidgetTheme;
  lang: Lang;
  /** Значения, которых нет в справочниках: страница покажет их и не станет гадать. */
  unknownCities: string[];
  unknownCategories: string[];
};

function list(value: string | string[] | undefined): string[] {
  const text = Array.isArray(value) ? value.join(',') : (value ?? '');
  return text
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 12);
}

/** Параметры /embed. Города и категории можно перечислять через запятую, как в API. */
export function parseEmbedParams(raw: RawParams, fallbackLang: Lang): EmbedParams {
  const cities = list(raw.city);
  const categories = list(raw.category);
  const limit = first(raw.limit);
  const lang = first(raw.lang);
  const period = first(raw.period);
  return {
    cities: cities.filter(isCityId),
    categories: categories.filter(isCategoryId),
    period: isPeriod(period) ? period : null,
    height: parseHeight(first(raw.height)),
    limit: limit ? clampLimit(Number(limit)) : WIDGET_DEFAULT_LIMIT,
    theme: first(raw.theme) === 'dark' ? 'dark' : 'light',
    lang: isLang(lang) ? lang : fallbackLang,
    unknownCities: cities.filter((value) => !isCityId(value)),
    unknownCategories: categories.filter((value) => !isCategoryId(value)),
  };
}

export const WIDGET_CITY_IDS: readonly CityId[] = CITIES.map((entry) => entry.slug);
export const WIDGET_CATEGORY_IDS: readonly CategoryId[] = CATEGORIES.map((entry) => entry.id);
