import type { Metadata } from 'next';

import { DevelopersDoc } from '@/components/docs/DevelopersDoc';
import { loadApiExamples } from '@/components/docs/examples';
import { getSiteOrigin } from '@/components/docs/origin';
import { PageShell } from '@/components/shell/PageShell';
import { getDictionaries } from '@/lib/api/server';
import { getServerT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerT();
  return { title: t('developers.metaTitle'), description: t('developers.subtitle') };
}

/**
 * Разработчикам: описание REST API афиши.
 * Примеры ответов не написаны руками: при сборке страницы сервер вызывает те же обработчики,
 * что отвечают по адресу /api/v1, и показывает их настоящий ответ.
 */
export default async function DevelopersPage() {
  const [{ t, lang }, origin, examples, dictionaries] = await Promise.all([
    getServerT(),
    getSiteOrigin(),
    loadApiExamples(),
    getDictionaries(),
  ]);

  return (
    <PageShell title={t('developers.title')} lead={t('developers.subtitle')}>
      <DevelopersDoc lang={lang} origin={origin} examples={examples} dictionaries={dictionaries} />
    </PageShell>
  );
}
