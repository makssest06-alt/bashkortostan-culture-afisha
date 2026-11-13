import { EventNotFound } from '@/components/event/EventNotFound';
import { EVENT_GLOW } from '@/components/event/model';
import { PageShell } from '@/components/shell/PageShell';

/** Неизвестный id события: понятная страница со ссылкой в каталог. Заголовок вкладки задаёт generateMetadata. */
export default function EventNotFoundPage() {
  return (
    <PageShell demoNotice={false} glow={EVENT_GLOW}>
      <EventNotFound />
    </PageShell>
  );
}
