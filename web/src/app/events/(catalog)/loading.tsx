import { CatalogSkeleton } from '@/components/events/CatalogSkeleton';
import { PageShell } from '@/components/shell/PageShell';

/** Переход в каталог: каркас страницы, пока сервер собирает первую выдачу. */
export default function EventsLoading() {
  return (
    <PageShell demoNotice={false}>
      <CatalogSkeleton />
    </PageShell>
  );
}
