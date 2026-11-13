import type { Metadata } from 'next';

import { AboutDoc } from '@/components/about/AboutDoc';
import { EventPath } from '@/components/about/EventPath';
import { loadCredits } from '@/components/about/manifest';
import { PageShell } from '@/components/shell/PageShell';
import { getServerT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerT();
  return { title: t('about.metaTitle'), description: t('about.subtitle') };
}

/**
 * О проекте: как собираются, проверяются и сводятся события, что из этого уже есть в прототипе,
 * демо-данные (#demo) и авторы фотографий (#credits). Список авторов читается из
 * public/images/manifest.json при сборке страницы.
 */
export default async function AboutPage() {
  const [{ t, lang }, credits] = await Promise.all([getServerT(), loadCredits()]);

  return (
    <PageShell title={t('about.title')} lead={t('about.subtitle')}>
      <EventPath lang={lang} t={t} />
      <AboutDoc lang={lang} credits={credits} />
    </PageShell>
  );
}
