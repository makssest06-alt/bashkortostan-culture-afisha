/**
 * Кадр стола под углом (desk-angle.webp): увеличен и сдвинут так, чтобы сукно лежало под жетоном,
 * а верхние 40 % экрана занимал тёмный задний план под текст. Сцена dedup начинает с того же кадра.
 */
export const ANGLE_FRAME =
  'absolute top-[-8%] left-[-30%] h-[130%] w-[130%] max-md:top-[4%] max-md:left-[-151%] max-md:h-[112%] max-md:w-[300%]';

/** Временное фото притушено: сцену держат жетон и типографика. */
/** Кадр стола под углом. Затемнение 0.6 дано заливкой поверх кадра (bg-[rgb(0_0_0/0.4)]), не filter: так дешевле для памяти. */
export const ANGLE_IMAGE = 'object-cover';

/** Точка жетона внутри увеличенного кадра (в процентах кадра): от неё идёт наезд камеры в dedup. */
export const ANGLE_ORIGIN = { desktop: '62% 55%', mobile: '67% 61%' } as const;

/** Затемнение поверх кадра: сверху под текст и по краям. */
export const ANGLE_SCRIM =
  'absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_62%,transparent_35%,oklch(0.12_0.01_40/0.75)_100%),linear-gradient(to_bottom,oklch(0.12_0.01_40/0.55),transparent_45%)]';
