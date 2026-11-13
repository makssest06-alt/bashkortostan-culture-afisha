import type { Metadata } from 'next';
import { Suspense } from 'react';

import { Catalog } from '@/components/events/Catalog';
import { CatalogSkeleton } from '@/components/events/CatalogSkeleton';
import { PAGE_SIZE, normalizeQuery, queryKey } from '@/components/events/query';
import { PageShell } from '@/components/shell/PageShell';
import { parseEventsQuery } from '@/lib/api/params';
import { listEvents } from '@/lib/api/server';
import type { EventsListResponse } from '@/lib/api/types';
import { getServerT } from '@/lib/i18n/server';

type SearchParams = Record<string, string | string[] | undefined>;

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerT();
  return { title: t('events.metaTitle'), description: t('events.subtitle') };
}

type InitialCatalog = {
  initial: EventsListResponse | null;
  initialKey: string;
  renderedAt: number;
};

/**
 * Первая страница выдачи по параметрам адреса. Если параметры не прошли проверку,
 * выдачи нет: каталог сам покажет, что именно не так, и предложит сбросить условия.
 */
async function loadInitial(raw: SearchParams): Promise<InitialCatalog> {
  const renderedAt = Date.now();
  const parsed = parseEventsQuery(raw);
  if (!parsed.ok) return { initial: null, initialKey: '', renderedAt };

  const query = normalizeQuery(parsed.value);
  const initial = await listEvents({ ...query, page: 1, page_size: PAGE_SIZE });
  return { initial, initialKey: queryKey(query), renderedAt };
}

/**
 * Каталог событий. Первый экран собирается на сервере по параметрам адресной строки
 * (?date=weekend, ?city=ufa, ?free=1 и остальные из docs/api.md), дальше фильтры работают
 * в браузере без перезагрузки страницы.
 */
export default async function EventsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { initial, initialKey, renderedAt } = await loadInitial(await searchParams);

  return (
    <PageShell demoNotice={false}>
      <Suspense fallback={<CatalogSkeleton />}>
        <Catalog initial={initial} initialKey={initialKey} renderedAt={renderedAt} />
      </Suspense>
    </PageShell>
  );
}
