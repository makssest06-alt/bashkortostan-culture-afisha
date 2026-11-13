/**
 * Текст с кодом внутри: всё, что стоит в обратных кавычках, становится моноширинным.
 *   rich('Параметр `page_size` от 1 до 50')
 * Так тексты в copy.ts остаются обычными строками на двух языках.
 */

import type { ReactNode } from 'react';

import styles from './docs.module.css';

export function rich(text: string): ReactNode {
  if (!text.includes('`')) return text;
  return text.split('`').map((part, index) =>
    index % 2 === 1 ? (
      <code key={index} className={styles.icode}>
        {part}
      </code>
    ) : (
      part
    ),
  );
}
