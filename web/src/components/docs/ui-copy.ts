/**
 * Служебные подписи блоков кода и оглавления: общие для /widget, /developers и /about.
 * В общем словаре (src/lib/i18n) их нет, словарь правится отдельно.
 * Башкирские варианты нужно показать носителю языка.
 */

import type { LocalizedText } from '@/lib/i18n/lang';

export const DOCS_UI = {
  copyFailed: {
    ru: 'Не получилось скопировать. Выделите текст и скопируйте вручную.',
    ba: 'Күсереп булманы. Тексты билдәләп, ҡулдан күсерегеҙ.',
  },
  copyCode: { ru: 'Скопировать код: {label}', ba: 'Кодты күсереп алыу: {label}' },
  toc: { ru: 'На этой странице', ba: 'Был биттә' },
  codeRegion: { ru: 'Код: {label}', ba: 'Код: {label}' },
  lines: { ru: 'строк: {count}', ba: 'юлдар: {count}' },
  tryIt: { ru: 'Попробовать', ba: 'Һынап ҡарау' },
  newTab: { ru: 'откроется в новой вкладке', ba: 'яңы вкладкала асыла' },
} as const satisfies Record<string, LocalizedText>;
