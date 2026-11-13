'use client';

import { useEffect } from 'react';

import { copy } from '@/components/event/copy';
import { EVENT_GLOW } from '@/components/event/model';
import { PageShell } from '@/components/shell/PageShell';
import { Button } from '@/components/ui';
import { ROUTES } from '@/content/links';
import { useT } from '@/lib/i18n';

type EventErrorProps = {
  /** Ошибка серверного компонента приходит как Error с digest, клиентская может быть любым значением. */
  error: unknown;
  /** Повторить: заново запросить и отрисовать страницу (Next 16). */
  retry?: () => void;
  /** Сбросить состояние ошибки без повторного запроса: запасной путь. */
  reset?: () => void;
};

/** Сбой страницы события: понятное сообщение, повтор и выход в каталог. Подробности остаются в консоли. */
export default function EventError({ error, retry, reset }: EventErrorProps) {
  const { t, lang } = useT();

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <PageShell title={copy('errorTitle', lang)} lead={t('common.errorHint')} demoNotice={false} glow={EVENT_GLOW}>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3" data-event-error="">
        <Button onClick={() => (retry ?? reset)?.()}>{t('common.retry')}</Button>
        <Button variant="link" href={ROUTES.events}>
          {t('event.backToCatalog')}
        </Button>
      </div>
    </PageShell>
  );
}
