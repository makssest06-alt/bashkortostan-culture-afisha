'use client';

import { useRouter } from 'next/navigation';

import { cn } from '@/lib/cn';
import { LANGS, useT } from '@/lib/i18n';
import type { Lang } from '@/lib/i18n';

export type LangSwitchProps = {
  /** 'compact': мелкие прописные для шапки. 'large': крупные кнопки для мобильного меню и подвала. */
  size?: 'compact' | 'large';
  className?: string;
};

/** Переключатель языка интерфейса РУС/БАШ. */
export function LangSwitch({ size = 'compact', className }: LangSwitchProps) {
  const { t, lang, setLang } = useT();
  const router = useRouter();

  const choose = (next: Lang) => {
    if (next === lang) return;
    setLang(next);
    // Серверные части страницы (заголовок вкладки, тексты серверных компонентов) перечитают cookie.
    router.refresh();
  };

  return (
    <div role="group" aria-label={t('lang.switch')} className={cn('lang-switch', className)} data-size={size}>
      {LANGS.map((code) => (
        <button
          key={code}
          type="button"
          lang={code}
          aria-pressed={code === lang}
          title={t(code === 'ru' ? 'lang.ruFull' : 'lang.baFull')}
          onClick={() => choose(code)}
          className="lang-switch__button"
        >
          {t(code === 'ru' ? 'lang.ru' : 'lang.ba')}
        </button>
      ))}
    </div>
  );
}
