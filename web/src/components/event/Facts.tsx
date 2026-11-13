import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

/**
 * Список «подпись и значение» тонкими линиями: сведения о событии и блок доверия.
 * Без хуков: работает и в серверных, и в клиентских компонентах.
 */
export function FactList({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <dl
      className={cn(
        'grid max-w-[62ch] grid-cols-[minmax(96px,auto)_minmax(0,1fr)] gap-x-6 border-t border-line text-[0.9375rem] leading-[1.4] sm:gap-x-8',
        className,
      )}
    >
      {children}
    </dl>
  );
}

export type FactProps = {
  label: string;
  children: ReactNode;
};

export function Fact({ label, children }: FactProps) {
  return (
    <>
      <dt className="t-caps border-b border-line py-3.5 text-fg-muted">{label}</dt>
      <dd className="min-w-0 border-b border-line py-3 text-fg">{children}</dd>
    </>
  );
}
