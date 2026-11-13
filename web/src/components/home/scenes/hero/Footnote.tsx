import { cn } from '@/lib/cn';

export type FootnoteProps = {
  text: string;
  className?: string;
};

/**
 * Сноска справа снизу: короткая линия и мелкие прописные по правому краю.
 * Стоит в сценах hero и ai на одном и том же месте, поэтому на склейке сцен не мигает.
 */
export function Footnote({ text, className }: FootnoteProps) {
  return (
    <p
      className={cn(
        't-caps absolute right-(--gutter) bottom-[2.6%] flex w-[min(46vw,15.5rem)] flex-col items-end gap-2 text-right text-fg-soft',
        className,
      )}
    >
      <span className="block h-px w-15 bg-line-strong" aria-hidden="true" />
      <span className="text-balance">{text}</span>
    </p>
  );
}
