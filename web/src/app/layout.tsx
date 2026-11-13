import '@fontsource-variable/golos-text';
import 'lenis/dist/lenis.css';
import './globals.css';

import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { SiteChrome } from '@/components/shell/SiteChrome';
import { I18nProvider } from '@/lib/i18n';
import { HTML_LANG } from '@/lib/i18n/lang';
import { getServerLang, getServerT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerT();
  return {
    title: {
      default: t('home.metaTitle'),
      template: `%s | ${t('common.brand')}`,
    },
    description: t('home.metaDescription'),
    applicationName: t('common.brandFull'),
    formatDetection: { telephone: false, address: false, email: false },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  colorScheme: 'dark',
  // Цвет фона сайта (--color-bg): панель браузера на телефоне сливается со страницей.
  themeColor: '#100D0C',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Язык из cookie: страница сразу приходит на выбранном языке, без мигания после загрузки.
  const lang = await getServerLang();

  return (
    <html lang={HTML_LANG[lang]} data-header-tone="light">
      <body>
        <I18nProvider initialLang={lang}>
          <SiteChrome>{children}</SiteChrome>
        </I18nProvider>
      </body>
    </html>
  );
}
