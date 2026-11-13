/**
 * Лёгкая подсветка кода без библиотек: чистые функции, которые работают и на сервере.
 * Задача не раскрасить всё, а помочь глазу: в JSON выделены ключи, в HTML имена и значения
 * атрибутов, в командах строки в кавычках. Остальной текст остаётся спокойным.
 */

import type { ReactNode } from 'react';

import styles from './docs.module.css';

export type CodeLanguage = 'json' | 'html' | 'bash' | 'text';

/** JSON, уже разложенный по строкам (JSON.stringify с отступом): ключ в начале строки. */
function highlightJson(code: string): ReactNode[] {
  return code.split('\n').map((line, index) => {
    const match = /^(\s*)("(?:[^"\\]|\\.)*")(:)(.*)$/.exec(line);
    const tail = index === 0 ? '' : '\n';
    if (!match) return `${tail}${line}`;
    return (
      <span key={index}>
        {tail}
        {match[1]}
        <span className={styles.tkKey}>{match[2]}</span>
        {match[3]}
        {match[4]}
      </span>
    );
  });
}

/** Тег с атрибутами: имя тега приглушено, значения атрибутов выделены. */
function highlightHtml(code: string): ReactNode[] {
  const parts = code.split(/(<\/?[a-z][a-z0-9]*|\/?>|"[^"]*")/gi);
  return parts.map((part, index) => {
    if (!part) return null;
    if (/^<\/?[a-z]/i.test(part) || /^\/?>$/.test(part)) {
      return (
        <span key={index} className={styles.tkDim}>
          {part}
        </span>
      );
    }
    if (part.startsWith('"')) {
      return (
        <span key={index} className={styles.tkStr}>
          {part}
        </span>
      );
    }
    return part;
  });
}

/** Команда оболочки: строки в кавычках выделены, сама команда и ключи приглушены. */
function highlightBash(code: string): ReactNode[] {
  const parts = code.split(/("(?:[^"\\]|\\.)*"|'[^']*'|\bcurl\b|\s-[A-Za-z]\b|\\\n)/g);
  return parts.map((part, index) => {
    if (!part) return null;
    if (part.startsWith('"') || part.startsWith("'")) {
      return (
        <span key={index} className={styles.tkKey}>
          {part}
        </span>
      );
    }
    if (part === 'curl' || /^\s-[A-Za-z]$/.test(part) || part === '\\\n') {
      return (
        <span key={index} className={styles.tkDim}>
          {part}
        </span>
      );
    }
    return part;
  });
}

export function highlight(code: string, language: CodeLanguage): ReactNode {
  if (language === 'json') return highlightJson(code);
  if (language === 'html') return highlightHtml(code);
  if (language === 'bash') return highlightBash(code);
  return code;
}
