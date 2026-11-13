'use client';

import { useEffect } from 'react';

import { PageShell } from '@/components/shell/PageShell';
import { Button } from '@/components/ui/Button';
import { useT } from '@/lib/i18n';

type ErrorPageProps = {
  /** Ошибка серверного компонента приходит как Error с digest, клиентская может быть любым значением. */
  error: unknown;
  /** Повторить: заново запросить и отрисовать содержимое (Next 16). */
  retry?: () => void;
  /** Сбросить состояние ошибки без повторного запроса: запасной путь. */
  reset?: () => void;
};

/** Страница сбоя: понятное сообщение и кнопка повтора. Подробности остаются в консоли. */
export default function ErrorPage({ error, retry, reset }: ErrorPageProps) {
  const { t } = useT();

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <PageShell title={t('common.error')} lead={t('common.errorHint')} demoNotice={false}>
      <Button onClick={() => (retry ?? reset)?.()}>{t('common.retry')}</Button>
    </PageShell>
  );
}
