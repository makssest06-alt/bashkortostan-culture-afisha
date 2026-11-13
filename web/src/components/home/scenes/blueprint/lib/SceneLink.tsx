import { ArrowRight } from '@phosphor-icons/react';
import Link from 'next/link';

import { cn } from '@/lib/cn';

/** Тихая ссылка сцены: мелкие прописные со стрелкой, цель касания от 44px. */
export function SceneLink({ href, children, className }: { href: string; children: string; className?: string }) {
  return (
    <Link
      href={href}
      className={cn(
        'group/link t-caps inline-flex min-h-11 items-center gap-2 text-fg underline decoration-line-strong underline-offset-[5px]',
        'transition-[text-decoration-color] duration-(--duration-fast) ease-out hover:decoration-fg',
        className,
      )}
    >
      <span>{children}</span>
      <ArrowRight
        size={14}
        weight="bold"
        aria-hidden="true"
        className="transition-transform duration-(--duration-fast) ease-(--ease-out) group-hover/link:translate-x-0.5"
      />
    </Link>
  );
}
