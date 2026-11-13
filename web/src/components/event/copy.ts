/**
 * Подписи страницы события, которых пока нет в общем словаре (src/lib/i18n).
 * Словарь общий для всех страниц и правится отдельно: после переноса туда этих строк файл можно убрать.
 * Башкирские варианты нужно показать носителю языка.
 */

import type { Lang, LocalizedText } from '@/lib/i18n/lang';
import { pick } from '@/lib/i18n/lang';

export const EVENT_COPY = {
  /** Возврат в каталог, когда пришли из выдачи с условиями. */
  backToResults: { ru: 'Назад к подборке', ba: 'Һайланмаға кире ҡайтыу' },
  /** Заголовок блока: «Ещё в Уфе». {where} это форма «где» из справочника городов. */
  moreInCity: { ru: 'Ещё {where}', ba: '{where} башҡа саралар' },
  allInCity: { ru: 'Все события {where}', ba: '{where} бөтә саралар' },
  moreInCityEmpty: { ru: 'Других событий {where} сейчас нет.', ba: '{where} әлегә башҡа саралар юҡ.' },
  openYandex: { ru: 'Открыть в Яндекс Картах', ba: 'Яндекс Карталарҙа асыу' },
  findYandex: { ru: 'Найти на Яндекс Картах', ba: 'Яндекс Карталарҙан эҙләү' },
  mapCredit: { ru: 'Карта: © участники OpenStreetMap', ba: 'Карта: © OpenStreetMap ҡатнашыусылары' },
  copyFailed: {
    ru: 'Не получилось скопировать ссылку. Возьмите её из адресной строки.',
    ba: 'Һылтанманы күсереп булманы. Уны адрес юлынан алығыҙ.',
  },
  /** Подпись навигации с возвратом в каталог: для чтения с экрана. */
  crumbs: { ru: 'Возврат в каталог', ba: 'Каталогҡа кире ҡайтыу' },
  /** Заглушка вместо картинки: для чтения с экрана. */
  noImage: { ru: 'Изображения нет', ba: 'Рәсем юҡ' },
  /** Подпись под картинкой: снимок из фотобанка, а не съёмка самого события. */
  photoCredit: { ru: 'Иллюстративное фото: {author}, Pexels', ba: 'Иллюстратив фото: {author}, Pexels' },
  mapTitle: { ru: 'Карта: {venue}', ba: 'Карта: {venue}' },
  /** Заголовок блока доверия. */
  trustTitle: { ru: 'Откуда данные', ba: 'Мәғлүмәт ҡайҙан' },
  checkedLabel: { ru: 'Проверка', ba: 'Тикшереү' },
  /** До гидратации и без JavaScript время проверки показано точной датой. */
  checkedAt: { ru: 'Проверено {date}', ba: '{date} тикшерелгән' },
  sourcesLabel: { ru: 'Источники', ba: 'Сығанаҡтар' },
  sourcesSingle: { ru: 'Один источник', ba: 'Бер сығанаҡ' },
  aboutDemo: { ru: 'Что такое демо-данные', ba: 'Демо-мәғлүмәт нимә ул' },
  /** Ошибка загрузки страницы события. */
  errorTitle: { ru: 'Не получилось открыть событие', ba: 'Сараны асып булманы' },
} as const satisfies Record<string, LocalizedText>;

export type EventCopyKey = keyof typeof EVENT_COPY;

/** Строка на нужном языке с подстановками в фигурных скобках. */
export function copy(key: EventCopyKey, lang: Lang, vars?: Record<string, string>): string {
  const template = pick(EVENT_COPY[key], lang);
  if (!vars) return template;
  return template.replace(/\{([a-z]+)\}/g, (placeholder, name: string) => vars[name] ?? placeholder);
}
