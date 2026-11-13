'use client';

/**
 * ВРЕМЕННЫЕ заглушки страниц: заголовок из словаря и пометка «страница в работе».
 * Автор страницы заменяет их своим содержимым.
 */

import { pick, useT } from '@/lib/i18n';
import type { LocalizedText, TKey } from '@/lib/i18n';

import { DemoDataNotice } from './DemoDataNotice';
import { PageShell } from './PageShell';

const IN_PROGRESS: LocalizedText = {
  ru: 'Страница в работе.',
  ba: 'Бит әҙерләнә.',
};

export type PageStubProps = {
  titleKey: TKey;
  leadKey?: TKey;
  /** Готовый текст под заголовком вместо leadKey: например, название события из API. */
  lead?: string;
};

/** Заглушка внутренней страницы в оболочке сайта. */
export function PageStub({ titleKey, leadKey, lead }: PageStubProps) {
  const { t, lang } = useT();
  return (
    <PageShell title={t(titleKey)} lead={lead ?? (leadKey ? t(leadKey) : undefined)}>
      <p className="t-body max-w-[60ch] rounded-md border border-line bg-surface/60 px-5 py-4 text-fg-soft">
        {pick(IN_PROGRESS, lang)}
      </p>
    </PageShell>
  );
}

/** Заглушка страницы без оболочки сайта: для /embed, который живёт внутри чужого iframe. */
export function BareStub({ titleKey }: { titleKey: TKey }) {
  const { t, lang } = useT();
  return (
    <main className="flex min-h-dvh flex-col gap-4 bg-bg p-5 text-fg">
      <h1 className="t-subtitle">{t(titleKey)}</h1>
      <p className="t-body text-fg-soft">{pick(IN_PROGRESS, lang)}</p>
      <DemoDataNotice compact className="self-start" />
    </main>
  );
}
