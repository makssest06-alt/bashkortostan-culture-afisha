import type { Metadata } from 'next';

import { PageShell } from '@/components/shell/PageShell';
import { Button } from '@/components/ui/Button';
import { ROUTES } from '@/content/links';
import { getServerT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerT();
  return { title: t('common.notFound.title') };
}

export default async function NotFound() {
  const { t } = await getServerT();
  return (
    <PageShell title={t('common.notFound.title')} lead={t('common.notFound.text')} demoNotice={false}>
      <Button href={ROUTES.events}>{t('common.notFound.action')}</Button>
    </PageShell>
  );
}
