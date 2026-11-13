'use client';

import { useEffect } from 'react';

import { PageShell } from '@/components/shell/PageShell';
import { Button } from '@/components/ui';
import { ROUTES } from '@/content/links';
import { useT } from '@/lib/i18n';

type EventsErrorProps = {
  /** Ошибка серверного компонента приходит как Error с digest, клиентская может быть любым значением. */
  error: unknown;
  /** Повторить: заново запросить и отрисовать страницу (Next 16). */
  retry?: () => void;
  /** Сбросить состояние ошибки без повторного запроса: запасной путь. */
  reset?: () => void;
};

/** Сбой каталога: понятное сообщение, повтор и выход в каталог без условий. Подробности остаются в консоли. */
export default function EventsError({ error, retry, reset }: EventsErrorProps) {
  const { t } = useT();

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <PageShell title={t('events.error')} lead={t('common.errorHint')} demoNotice={false}>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <Button onClick={() => (retry ?? reset)?.()}>{t('common.retry')}</Button>
        <Button variant="link" href={ROUTES.events}>
          {t('filters.reset')}
        </Button>
      </div>
    </PageShell>
  );
}
