import clsx from 'clsx';
import type { ClassValue } from 'clsx';

/** Склейка классов: строки, массивы и объекты `{ класс: условие }`. */
export function cn(...values: ClassValue[]): string {
  return clsx(values);
}
