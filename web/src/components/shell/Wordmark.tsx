import { cn } from '@/lib/cn';

export type WordmarkProps = {
  /** Текст знака: для шапки «АФИША» из словаря (common.brand). */
  children: string;
  className?: string;
};

/**
 * Словесный знак, набранный текстом: жирный плотный гротеск прописными.
 * Если появится построенный знак в кривых, достаточно заменить этот компонент.
 */
export function Wordmark({ children, className }: WordmarkProps) {
  return <span className={cn('t-wordmark block', className)}>{children}</span>;
}
