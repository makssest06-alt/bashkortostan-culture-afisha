import type { CSSProperties } from 'react';

import { cn } from '@/lib/cn';

export type SkeletonProps = {
  /** Размеры задаются классами (h-6 w-40) или стилем. Форма должна повторять будущее содержимое. */
  className?: string;
  style?: CSSProperties;
};

/** Плашка-заглушка на время загрузки. При «меньше движения» блик не бежит. */
export function Skeleton({ className, style }: SkeletonProps) {
  return <span aria-hidden="true" className={cn('skeleton block rounded-sm', className)} style={style} />;
}

export type SkeletonTextProps = {
  lines?: number;
  className?: string;
};

/** Несколько строк текста-заглушки: последняя короче. */
export function SkeletonText({ lines = 3, className }: SkeletonTextProps) {
  return (
    <span aria-hidden="true" className={cn('flex flex-col gap-2.5', className)}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} className={cn('h-4', index === lines - 1 ? 'w-3/5' : 'w-full')} />
      ))}
    </span>
  );
}
