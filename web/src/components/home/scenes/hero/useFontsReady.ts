'use client';

import { useEffect, useState } from 'react';

/**
 * true, когда шрифт сайта загружен. Сцена, которая считает строки вёрстки, пересобирает таймлайн
 * после подмены запасного шрифта: строки абзаца к этому моменту могли лечь иначе.
 */
export function useFontsReady(): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void document.fonts.ready.then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return ready;
}
