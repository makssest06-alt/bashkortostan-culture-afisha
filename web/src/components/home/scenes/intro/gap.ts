/**
 * Зазор под жетон на телефоне.
 *
 * На телефоне текст сцены стоит над жетоном и под ним, а высота этих блоков зависит от экрана и языка.
 * Сцена замеряет свободное место между ними (useGap) и кладёт сюда, def.ts читает отсюда и ставит жетон
 * в зазор. Значения в долях высоты экрана сцены. Модуль без зависимостей: его можно импортировать из def.ts.
 */

export type GapBox = {
  /** Низ верхнего блока. */
  top: number;
  /** Верх нижнего блока. */
  bottom: number;
};

export type Gap = {
  read: () => GapBox;
  write: (top: number, bottom: number) => void;
};

/** initial: зазор до первого замера (телефон 390x844, русский текст). */
export function makeGap(initial: GapBox): Gap {
  const box: GapBox = { ...initial };
  return {
    read: () => box,
    write(top, bottom) {
      if (!Number.isFinite(top) || !Number.isFinite(bottom)) return;
      box.top = top;
      box.bottom = bottom;
    },
  };
}
