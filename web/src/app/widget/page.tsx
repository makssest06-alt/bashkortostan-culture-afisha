import { ArrowRight } from '@phosphor-icons/react/ssr';
import type { Metadata } from 'next';

import { getSiteOrigin } from '@/components/docs/origin';
import { KuskarBorder } from '@/components/ornament';
import { PageShell } from '@/components/shell/PageShell';
import { Button } from '@/components/ui';
import { WIDGET_COPY } from '@/components/widget/copy';
import { parseWidgetSettings } from '@/components/widget/settings';
import styles from '@/components/widget/widget.module.css';
import { WidgetPlayground } from '@/components/widget/WidgetPlayground';
import type { CodeMode } from '@/components/widget/WidgetPlayground';
import { ROUTES } from '@/content/links';
import { pick } from '@/lib/i18n/lang';
import { getServerT } from '@/lib/i18n/server';

type SearchParams = Record<string, string | string[] | undefined>;

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerT();
  return { title: t('widget.metaTitle'), description: t('widget.subtitle') };
}

const FEATURE_KEYS = [
  'widget.features.live',
  'widget.features.filters',
  'widget.features.responsive',
  'widget.features.trust',
] as const;

/**
 * Виджет: код вставки одной строкой, настройки и живой пример в макете страницы министерства.
 * Настройки читаются из адреса (?city=ufa&category=theatre&limit=5&theme=dark&lang=ba&mode=iframe),
 * поэтому первая версия кода приходит с сервера уже нужной.
 */
export default async function WidgetPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const [{ t, lang }, origin, raw] = await Promise.all([getServerT(), getSiteOrigin(), searchParams]);
  const initial = parseWidgetSettings(raw, lang);
  const mode: CodeMode = raw.mode === 'iframe' ? 'iframe' : 'script';

  return (
    <PageShell title={t('widget.title')} lead={t('widget.subtitle')}>
      <WidgetPlayground origin={origin} initial={initial} initialMode={mode} fallbackLang={lang} />

      <KuskarBorder height={16} variant="row" className="mt-20 text-fg-muted opacity-60" />

      <section aria-labelledby="widget-features-title" className="mt-12">
        <h2 id="widget-features-title" className="t-subtitle">
          {t('widget.features.title')}
        </h2>
        <ul className={`${styles.features} mt-8`}>
          {FEATURE_KEYS.map((key) => (
            <li key={key} className={`t-lead ${styles.feature}`}>
              {t(key)}
            </li>
          ))}
        </ul>
      </section>

      <div className="mt-16 grid gap-x-16 gap-y-12 md:grid-cols-2">
        <section aria-labelledby="widget-safe-title">
          <h2 id="widget-safe-title" className="t-caps text-fg-muted">
            {pick(WIDGET_COPY.safeTitle, lang)}
          </h2>
          <p className="t-body mt-3 max-w-[52ch] text-fg-soft">{pick(WIDGET_COPY.safeText, lang)}</p>
          <Button href={`${ROUTES.developers}#connect`} variant="link" className="mt-2">
            {pick(WIDGET_COPY.allSettings, lang)}
            <ArrowRight size={16} weight="bold" aria-hidden="true" />
          </Button>
        </section>
        <section aria-labelledby="widget-api-title">
          <h2 id="widget-api-title" className="t-caps text-fg-muted">
            {pick(WIDGET_COPY.ownDesignTitle, lang)}
          </h2>
          <p className="t-body mt-3 max-w-[52ch] text-fg-soft">{pick(WIDGET_COPY.ownDesignText, lang)}</p>
          <Button href={ROUTES.apiDocs} variant="link" className="mt-2">
            {pick(WIDGET_COPY.ownDesignAction, lang)}
            <ArrowRight size={16} weight="bold" aria-hidden="true" />
          </Button>
        </section>
      </div>
    </PageShell>
  );
}
