import Link from 'next/link';

import { EventEditor } from '@/components/admin/EventEditor';
import { PageShell } from '@/components/shell/PageShell';

type Props = { params: Promise<{ id: string }> };

/** /admin/events/{id}: правка одного события с журналом по нему. */
export default async function AdminEventPage({ params }: Props) {
  const { id } = await params;
  return (
    <PageShell
      title="Правка события"
      actions={
        <Link href="/admin" className="text-[0.9375rem] underline underline-offset-4">
          Все события
        </Link>
      }
      demoNotice={false}
      footer={false}
      glow={0.2}
    >
      <EventEditor id={id} />
    </PageShell>
  );
}
