import { Suspense } from 'react';

import { AdminApp } from '@/components/admin/AdminApp';
import { PageShell } from '@/components/shell/PageShell';

/** /admin: импорт, правка, модерация и журнал изменений (п. 6.1, 6.3 ТЗ). */
export default function AdminPage() {
  return (
    <PageShell title="Админка афиши" lead="Импорт CSV и JSON, правка карточек, статусы, спорные карточки и журнал изменений." demoNotice={false} footer={false} glow={0.2}>
      <Suspense fallback={<p className="text-fg-soft">Загрузка…</p>}>
        <AdminApp />
      </Suspense>
    </PageShell>
  );
}
