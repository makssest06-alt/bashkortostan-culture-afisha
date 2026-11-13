import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';

import { cn } from '@/lib/cn';

export type ButtonVariant = 'primary' | 'ghost' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg';

type OwnProps = {
  /** primary: главное действие (светлая заливка). ghost: второстепенное (контур). link: текстовая ссылка. */
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Кнопка на всю ширину контейнера. */
  fullWidth?: boolean;
  className?: string;
  children?: ReactNode;
};

type AsButton = OwnProps & { href?: undefined } & Omit<ComponentProps<'button'>, keyof OwnProps>;
type AsLink = OwnProps & {
  href: string;
  /** Внешняя ссылка: откроется в новой вкладке. */
  external?: boolean;
} & Omit<ComponentProps<'a'>, keyof OwnProps | 'href'>;

export type ButtonProps = AsButton | AsLink;

const BASE =
  'inline-flex items-center justify-center gap-2 font-medium whitespace-nowrap select-none ' +
  'transition-[scale,background-color,color,border-color,text-decoration-color] duration-(--duration-press) ease-out ' +
  'active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45 aria-disabled:pointer-events-none aria-disabled:opacity-45';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'rounded-sm bg-fg text-bg hover:bg-fg-soft',
  ghost: 'rounded-sm border border-line-strong text-fg hover:bg-hover',
  link: 'rounded-xs text-fg underline decoration-line-strong decoration-1 underline-offset-[0.3em] hover:decoration-fg',
};

/** Высота md и lg от 44px. sm ниже, но на сенсорном экране тоже вырастает до 44px. */
const SIZES: Record<ButtonSize, string> = {
  sm: 'min-h-9 px-3.5 text-[0.875rem] leading-[1.2] pointer-coarse:min-h-11',
  md: 'min-h-11 px-5 text-[0.9375rem] leading-[1.2]',
  lg: 'min-h-13 px-7 text-[1.0625rem] leading-[1.2]',
};

const LINK_SIZES: Record<ButtonSize, string> = {
  sm: 'min-h-9 text-[0.875rem] leading-[1.2] pointer-coarse:min-h-11',
  md: 'min-h-11 text-[0.9375rem] leading-[1.2]',
  lg: 'min-h-11 text-[1.0625rem] leading-[1.2]',
};

/**
 * Кнопка или ссылка в виде кнопки. С `href` рендерит ссылку (внутреннюю через next/link).
 *
 *   <Button onClick={send}>{t('ask.send')}</Button>
 *   <Button variant="ghost" href="/events">{t('nav.events')}</Button>
 *   <Button variant="link" href={url} external>{t('event.sourceLink')}</Button>
 */
export function Button(props: ButtonProps) {
  const { variant = 'primary', size = 'md', fullWidth = false, className, children, ...rest } = props;
  const classes = cn(
    BASE,
    VARIANTS[variant],
    variant === 'link' ? LINK_SIZES[size] : SIZES[size],
    fullWidth && 'w-full',
    className,
  );

  if ('href' in rest && typeof rest.href === 'string') {
    const { href, external, ...anchorProps } = rest;
    if (external) {
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" className={classes} {...anchorProps}>
          {children}
        </a>
      );
    }
    return (
      <Link href={href} className={classes} {...anchorProps}>
        {children}
      </Link>
    );
  }

  const { type = 'button', ...buttonProps } = rest as Omit<AsButton, keyof OwnProps>;
  return (
    <button type={type} className={classes} {...buttonProps}>
      {children}
    </button>
  );
}
