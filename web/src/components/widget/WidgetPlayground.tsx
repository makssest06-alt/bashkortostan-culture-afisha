'use client';

/**
 * Конфигуратор виджета: код вставки одной строкой, настройки и живой пример.
 *
 * Пример честный: на вкладке «Скрипт» в макет вставляется тот же тег script с теми же атрибутами,
 * что показаны в коде (их собирает widgetAttributes), и виджет рисует public/widget.js.
 * На вкладке «Iframe» в макете стоит iframe с тем же адресом и той же высотой, что в коде.
 * Настройки сразу попадают в адресную строку: настроенную страницу можно переслать ссылкой.
 */

import type { CSSProperties, KeyboardEvent } from 'react';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { CopyButton } from '@/components/docs/CopyButton';
import docs from '@/components/docs/docs.module.css';
import { highlight } from '@/components/docs/highlight';
import { Chip, Field, Select } from '@/components/ui';
import { CATEGORIES, CITIES, DATE_PRESETS, isCategoryId, isCityId } from '@/data/dictionaries';
import type { DatePreset } from '@/lib/api/types';
import { LANGS, pick, translate, useT } from '@/lib/i18n';
import type { Lang } from '@/lib/i18n';

import { WIDGET_COPY } from './copy';
import {
  WIDGET_HEIGHT_OPTIONS,
  WIDGET_LIMIT_OPTIONS,
  WIDGET_PERIOD_IDS,
  parseHeight,
  WIDGET_SCRIPT_PATH,
  clampLimit,
  embedHeight,
  embedHref,
  iframeSnippet,
  scriptSnippet,
  widgetAttributes,
  widgetSettingsToSearch,
} from './settings';
import type { WidgetSettings, WidgetTheme } from './settings';
import styles from './widget.module.css';

export type CodeMode = 'script' | 'iframe';
type Viewport = 'desktop' | 'phone';

const MODES: readonly CodeMode[] = ['script', 'iframe'];
const THEMES: readonly WidgetTheme[] = ['light', 'dark'];

const noopSubscribe = () => () => {};

export type WidgetPlaygroundProps = {
  /** Адрес сайта, посчитанный на сервере: с ним приходит первая версия кода вставки. */
  origin: string;
  initial: WidgetSettings;
  initialMode: CodeMode;
  /** Язык интерфейса в момент загрузки: значение настройки «Язык» по умолчанию. */
  fallbackLang: Lang;
};

/** Живой виджет: тег script вставляется в макет так же, как его вставил бы редактор сайта. */
function LiveScript({ settings, onFail }: { settings: WidgetSettings; onFail: () => void }) {
  const slot = useRef<HTMLDivElement>(null);
  const attributes = widgetAttributes(settings);
  const signature = attributes.map(([name, value]) => `${name}=${value}`).join('&');

  useEffect(() => {
    const node = slot.current;
    if (!node) return;
    const script = document.createElement('script');
    script.src = WIDGET_SCRIPT_PATH;
    script.async = true;
    for (const pair of signature.split('&')) {
      const [name, value] = pair.split('=');
      script.setAttribute(name, value);
    }
    script.addEventListener('error', onFail);
    node.replaceChildren(script);
    return () => {
      script.removeEventListener('error', onFail);
      node.replaceChildren();
    };
  }, [signature, onFail]);

  return (
    <>
      <div ref={slot} className={styles.slot} data-widget-slot />
      <div className={styles.placeholder} aria-hidden="true">
        {Array.from({ length: Math.min(settings.limit, 4) }, (_, index) => (
          <div key={index} className={styles.placeholderRow}>
            <span className={styles.bar} style={{ width: '28%' }} />
            <span className={styles.bar} style={{ width: '72%', height: 18 }} />
            <span className={styles.bar} style={{ width: '48%' }} />
          </div>
        ))}
      </div>
    </>
  );
}

export function WidgetPlayground({ origin, initial, initialMode, fallbackLang }: WidgetPlaygroundProps) {
  const { t, lang } = useT();
  const [settings, setSettings] = useState<WidgetSettings>(initial);
  const [mode, setMode] = useState<CodeMode>(initialMode);
  const [viewport, setViewport] = useState<Viewport>('desktop');
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const tabRefs = useRef<Partial<Record<CodeMode, HTMLButtonElement | null>>>({});

  // После гидратации берём адрес из браузера: за прокси заголовок Host может отличаться от настоящего.
  const liveOrigin = useSyncExternalStore(
    noopSubscribe,
    () => window.location.origin,
    () => origin,
  );

  const snippet =
    mode === 'script'
      ? scriptSnippet(liveOrigin, settings)
      : iframeSnippet(liveOrigin, settings, translate(settings.lang, 'widget.heading'));

  // Настройки живут в адресной строке: страницу с выбранным городом и темой можно переслать.
  useEffect(() => {
    const params = new URLSearchParams(widgetSettingsToSearch(settings, fallbackLang));
    if (mode === 'iframe') params.set('mode', 'iframe');
    const search = params.toString();
    const next = `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`;
    if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.replaceState(null, '', next);
    }
  }, [settings, mode, fallbackLang]);

  const onScriptFail = useCallback(() => setFailed(true), []);

  const update = (patch: Partial<WidgetSettings>) => {
    setFailed(false);
    setSettings((current) => ({ ...current, ...patch }));
  };

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const next = MODES[(MODES.indexOf(mode) + (event.key === 'ArrowRight' ? 1 : MODES.length - 1)) % MODES.length];
    setMode(next);
    tabRefs.current[next]?.focus();
  };

  const modeLabel = (value: CodeMode) => t(value === 'script' ? 'widget.code.script' : 'widget.code.iframe');

  return (
    <div className={styles.playground}>
      <div className={styles.side}>
        {/* ------------------------------------------------------ Код вставки */}
        <section className={`${styles.panel} ${styles.rise}`} aria-labelledby="widget-code-title" style={{ '--i': 0 } as CSSProperties}>
          <div className={styles.panelHead}>
            <h2 id="widget-code-title" className="t-caps text-fg-soft">
              {t('widget.code')}
            </h2>
            <span className="t-caps text-copper-hi">{pick(WIDGET_COPY.oneLine, lang)}</span>
          </div>

          <div role="tablist" aria-label={pick(WIDGET_COPY.codeTabs, lang)} className={styles.tabs}>
            {MODES.map((value) => (
              <button
                key={value}
                ref={(node) => {
                  tabRefs.current[value] = node;
                }}
                type="button"
                role="tab"
                id={`widget-tab-${value}`}
                aria-selected={mode === value}
                aria-controls="widget-code-panel"
                tabIndex={mode === value ? 0 : -1}
                onClick={() => setMode(value)}
                onKeyDown={onTabKey}
                className={styles.tab}
              >
                {modeLabel(value)}
              </button>
            ))}
          </div>

          <div role="tabpanel" id="widget-code-panel" aria-labelledby={`widget-tab-${mode}`} className="flex flex-col gap-4">
            <div className={docs.code}>
              <pre
                className={docs.pre}
                data-size="lg"
                data-widget-code={mode}
                tabIndex={0}
                role="region"
                aria-label={`${t('widget.code')}: ${modeLabel(mode)}`}
                style={{ borderTop: 0 }}
              >
                <code>{highlight(snippet, 'html')}</code>
              </pre>
            </div>
            <div className={styles.codeFoot}>
              <CopyButton text={snippet} variant="primary" />
              <p className={styles.hint}>{t(mode === 'script' ? 'widget.code.scriptHint' : 'widget.code.iframeHint')}</p>
            </div>
          </div>
        </section>

        {/* -------------------------------------------------------- Настройки */}
        <section className={`${styles.panel} ${styles.rise}`} aria-labelledby="widget-settings-title" style={{ '--i': 1 } as CSSProperties}>
          <h2 id="widget-settings-title" className="t-caps text-fg-soft">
            {t('widget.settings')}
          </h2>
          <form className={styles.settings} onSubmit={(event) => event.preventDefault()}>
            <Field label={t('widget.settings.city')}>
              <Select
                name="city"
                value={settings.city}
                onChange={(event) => update({ city: isCityId(event.target.value) ? event.target.value : '' })}
              >
                <option value="">{t('filters.city.all')}</option>
                {CITIES.map((city) => (
                  <option key={city.slug} value={city.slug}>
                    {pick(city.name, lang)}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label={t('widget.settings.category')}>
              <Select
                name="category"
                value={settings.category}
                onChange={(event) => update({ category: isCategoryId(event.target.value) ? event.target.value : '' })}
              >
                <option value="">{t('filters.category.all')}</option>
                {CATEGORIES.map((category) => (
                  <option key={category.id} value={category.id}>
                    {pick(category.name, lang)}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label={pick(WIDGET_COPY.period, lang)}>
              <Select
                name="period"
                value={settings.period}
                onChange={(event) =>
                  update({
                    period: WIDGET_PERIOD_IDS.includes(event.target.value as DatePreset) ? (event.target.value as DatePreset) : '',
                  })
                }
              >
                <option value="">{pick(WIDGET_COPY.periodAll, lang)}</option>
                {DATE_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {pick(preset.label, lang)}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label={pick(WIDGET_COPY.height, lang)} hint={pick(WIDGET_COPY.heightHint, lang)}>
              <Select
                name="height"
                value={settings.height === null ? '' : String(settings.height)}
                onChange={(event) => update({ height: event.target.value ? parseHeight(event.target.value) : null })}
              >
                <option value="">{pick(WIDGET_COPY.heightAuto, lang)}</option>
                {[...new Set([...WIDGET_HEIGHT_OPTIONS, ...(settings.height !== null ? [settings.height] : [])])]
                  .sort((a, b) => a - b)
                  .map((value) => (
                    <option key={value} value={value}>
                      {value} px
                    </option>
                  ))}
              </Select>
            </Field>

            <Field label={t('widget.settings.limit')}>
              <Select
                name="limit"
                value={String(settings.limit)}
                onChange={(event) => update({ limit: clampLimit(Number(event.target.value)) })}
              >
                {[...new Set([...WIDGET_LIMIT_OPTIONS, settings.limit])]
                  .sort((a, b) => a - b)
                  .map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
              </Select>
            </Field>

            <fieldset className={styles.choice}>
              <legend className="t-ui mb-2 text-fg">{t('widget.settings.theme')}</legend>
              <div className={styles.choiceRow}>
                {THEMES.map((value) => (
                  <Chip key={value} selected={settings.theme === value} onClick={() => update({ theme: value })}>
                    {t(value === 'light' ? 'widget.settings.theme.light' : 'widget.settings.theme.dark')}
                  </Chip>
                ))}
              </div>
            </fieldset>

            <fieldset className={`${styles.choice} ${styles.wide}`}>
              <legend className="t-ui mb-2 text-fg">{t('widget.settings.lang')}</legend>
              <div className={styles.choiceRow}>
                {LANGS.map((value) => (
                  <Chip key={value} selected={settings.lang === value} onClick={() => update({ lang: value })}>
                    <span lang={value}>{t(value === 'ru' ? 'lang.ruFull' : 'lang.baFull')}</span>
                  </Chip>
                ))}
              </div>
            </fieldset>
          </form>
        </section>
      </div>

      {/* ------------------------------------------------------------ Пример */}
      <section className={`${styles.panel} ${styles.rise}`} aria-labelledby="widget-preview-title" style={{ '--i': 2 } as CSSProperties}>
        <div className={styles.panelHead}>
          <h2 id="widget-preview-title" className="t-caps text-fg-soft">
            {t('widget.preview')}
          </h2>
          <div role="group" aria-label={pick(WIDGET_COPY.viewport, lang)} className="hidden gap-2 md:flex">
            <Chip selected={viewport === 'desktop'} onClick={() => setViewport('desktop')}>
              {pick(WIDGET_COPY.viewportDesktop, lang)}
            </Chip>
            <Chip selected={viewport === 'phone'} onClick={() => setViewport('phone')}>
              {pick(WIDGET_COPY.viewportPhone, lang)}
            </Chip>
          </div>
        </div>

        <figure
          className={styles.mock}
          data-theme={settings.theme}
          data-viewport={viewport}
          data-widget-mock
          aria-label={t('widget.mock.badge')}
        >
          <div className={styles.mockBar} aria-hidden="true">
            <span className={styles.mockOrg}>
              <span className={styles.mockMark} />
              {t('widget.mock.org')}
            </span>
            <span className={styles.mockNav}>
              <span>{t('widget.mock.nav.news')}</span>
              <span>{t('widget.mock.nav.docs')}</span>
              <span>{t('widget.mock.nav.activity')}</span>
              <span>{t('widget.mock.nav.contacts')}</span>
            </span>
          </div>
          <div className={styles.mockBody}>
            <p className={styles.mockBadge}>{t('widget.mock.badge')}</p>
            <p className={styles.mockTitle}>{t('widget.mock.title')}</p>
            <p className={styles.mockText}>{t('widget.mock.text')}</p>

            {mode === 'iframe' ? (
              <iframe
                key={embedHref(settings)}
                src={embedHref(settings)}
                title={pick(WIDGET_COPY.iframeTitle, lang)}
                height={settings.height ?? embedHeight(settings.limit)}
                loading="lazy"
                className={styles.frame}
                data-widget-frame
              />
            ) : failed ? (
              <div className={styles.mockError} role="alert">
                <p>{pick(WIDGET_COPY.scriptFailed, lang)}</p>
                <button
                  type="button"
                  className={styles.mockRetry}
                  onClick={() => {
                    setFailed(false);
                    setAttempt((value) => value + 1);
                  }}
                >
                  {t('common.retry')}
                </button>
              </div>
            ) : (
              <LiveScript key={attempt} settings={settings} onFail={onScriptFail} />
            )}
          </div>
        </figure>

        <p className="t-body max-w-[60ch] text-fg-soft">{t('widget.previewNote')}</p>
      </section>
    </div>
  );
}
