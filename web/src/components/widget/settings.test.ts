import { describe, expect, it } from 'vitest';

import { embedHref, iframeSnippet, parseEmbedParams, parseWidgetSettings, scriptSnippet } from './settings';

describe('параметры виджета (п. 6.3: город, категория, период, высота)', () => {
  const settings = parseWidgetSettings({ city: 'ufa', category: 'concert', period: 'weekend', height: '480' }, 'ru');

  it('настройки страницы /widget читают период и высоту', () => {
    expect(settings).toMatchObject({ city: 'ufa', category: 'concert', period: 'weekend', height: 480 });
  });

  it('незнакомые значения заменяются безопасными, высота держится в пределах', () => {
    expect(parseWidgetSettings({ period: 'month', height: '99999' }, 'ru')).toMatchObject({ period: '', height: 1600 });
    expect(parseWidgetSettings({ height: 'abc' }, 'ru').height).toBeNull();
  });

  it('код скрипта и iframe несут все четыре параметра', () => {
    const script = scriptSnippet('https://afisha.example', settings);
    expect(script).toContain('data-city="ufa"');
    expect(script).toContain('data-category="concert"');
    expect(script).toContain('data-period="weekend"');
    expect(script).toContain('data-height="480"');
    const iframe = iframeSnippet('https://afisha.example', settings, 'Афиша');
    expect(iframe).toContain('period=weekend');
    expect(iframe).toContain('height="480"');
  });

  it('страница /embed понимает те же параметры', () => {
    const params = parseEmbedParams(Object.fromEntries(new URL(embedHref(settings), 'http://x').searchParams), 'ru');
    expect(params).toMatchObject({ cities: ['ufa'], categories: ['concert'], period: 'weekend', height: 480 });
  });
});
