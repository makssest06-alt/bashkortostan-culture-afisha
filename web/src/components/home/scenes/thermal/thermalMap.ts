/**
 * Тепловая палитра: карта градиента по яркости. Картинка зала один раз перекрашивается на холсте,
 * дальше слой лежит как обычная картинка и ничего не считает на прокрутке. Так результат одинаков
 * во всех браузерах (SVG-фильтр на слое во весь экран в Safari считается на процессоре).
 *
 * Палитра по замерам референса (video-part-2.md, 1.6): тёмный низ, глубокий синий, сине-фиолетовый,
 * пурпур, маджента, красный, оранжевый, жёлтый. Яркость перед раскраской выравнивается по гистограмме,
 * вокруг «горячей точки» добавляется тепло: центр зала уходит в жёлтый.
 *
 * Холст покрывает только видимую часть картинки (с запасом, см. coverCrop; на экране он стоит
 * с тем же object-fit: cover, что и фото) и не больше заданной длинной стороны. На телефоне видна узкая середина кадра: раньше холст 1280 x 720
 * считал весь кадр, и видимая полоса шириной 270 точек растягивалась на экран. Теперь холст меньше
 * по памяти и чётче на экране.
 */

type Stop = readonly [position: number, r: number, g: number, b: number];

const STOPS: readonly Stop[] = [
  [0.0, 20, 19, 26],
  [0.1, 39, 37, 84],
  [0.22, 39, 44, 128],
  [0.34, 75, 73, 183],
  [0.46, 167, 8, 135],
  [0.58, 238, 47, 153],
  [0.74, 241, 10, 79],
  [0.86, 243, 154, 74],
  [0.95, 245, 255, 135],
  [1.0, 255, 254, 226],
];

/** Сторона уменьшенной копии всего кадра для гистограммы: цвета не зависят от кадрирования. */
const HISTOGRAM_SIDE = 320;

function buildLut(): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256 * 3);
  let stop = 0;
  for (let index = 0; index < 256; index += 1) {
    const t = index / 255;
    while (stop < STOPS.length - 2 && t > STOPS[stop + 1][0]) stop += 1;
    const from = STOPS[stop];
    const to = STOPS[stop + 1];
    const k = Math.min(1, Math.max(0, (t - from[0]) / (to[0] - from[0])));
    lut[index * 3] = from[1] + (to[1] - from[1]) * k;
    lut[index * 3 + 1] = from[2] + (to[2] - from[2]) * k;
    lut[index * 3 + 2] = from[3] + (to[3] - from[3]) * k;
  }
  return lut;
}

function lumaOf(pixels: Uint8ClampedArray, offset: number): number {
  return (pixels[offset] * 54 + pixels[offset + 1] * 183 + pixels[offset + 2] * 19) >> 8;
}

/** Таблица выравнивания яркости по всему кадру (частичное: тёмный зал иначе целиком ушёл бы в синий). */
function equalizeTable(image: HTMLImageElement): Float32Array | null {
  const aspect = image.naturalWidth / image.naturalHeight;
  const width = aspect >= 1 ? HISTOGRAM_SIDE : Math.round(HISTOGRAM_SIDE * aspect);
  const height = aspect >= 1 ? Math.round(HISTOGRAM_SIDE / aspect) : HISTOGRAM_SIDE;
  const probe = document.createElement('canvas');
  probe.width = width;
  probe.height = height;
  const context = probe.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(image, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;
  const count = width * height;
  const histogram = new Uint32Array(256);
  for (let index = 0; index < count; index += 1) histogram[lumaOf(pixels, index * 4)] += 1;
  const equalized = new Float32Array(256);
  let sum = 0;
  for (let value = 0; value < 256; value += 1) {
    sum += histogram[value];
    equalized[value] = 0.62 * (sum / count) + 0.38 * (value / 255);
  }
  return equalized;
}

export type ThermalOptions = {
  /** Горячая точка в долях картинки: по умолчанию центр зала. */
  hotX?: number;
  hotY?: number;
  /** Размер места картинки на экране, CSS px: холст берёт его пропорции (кадрирование как у cover). */
  boxWidth?: number;
  boxHeight?: number;
  /** Предел длинной стороны холста, px. */
  maxSide?: number;
  /** Плотность экрана: холст не детальнее, чем его покажет экран. */
  pixelRatio?: number;
};

/**
 * Запас кадрирования. Высота места на телефоне считается в dvh и меняется с панелью адреса (до 15 %),
 * а холст красится один раз. Холст берёт полосу кадра шире видимой: пока место не стало шире запаса,
 * cover у холста и cover у фото дают одно и то же совмещение пиксель в пиксель.
 */
const CROP_MARGIN = 1.3;

type Crop = {
  /** Часть кадра в долях картинки: левый верхний угол и размер. */
  fx: number;
  fy: number;
  fw: number;
  fh: number;
  /** Размер этой части на экране, CSS px (cover по высоте или по ширине места). */
  cssWidth: number;
  cssHeight: number;
};

/**
 * Часть картинки для холста. Если место уже картинки (телефон), берётся вся высота и средняя полоса
 * шириной с запасом; если шире (компьютер), вся ширина и средняя полоса по высоте с запасом.
 * Всё в долях: у картинки из srcset naturalWidth поправлен на плотность и не равен числу её точек,
 * поэтому координаты в точках исходника здесь не годятся.
 */
function coverCrop(imageAspect: number, boxWidth: number, boxHeight: number): Crop {
  const boxAspect = boxWidth / boxHeight;
  if (boxAspect < imageAspect) {
    const cropAspect = Math.min(imageAspect, boxAspect * CROP_MARGIN);
    const fw = cropAspect / imageAspect;
    return { fx: (1 - fw) / 2, fy: 0, fw, fh: 1, cssWidth: boxHeight * cropAspect, cssHeight: boxHeight };
  }
  const cropAspect = Math.max(imageAspect, boxAspect / CROP_MARGIN);
  const fh = imageAspect / cropAspect;
  return { fx: 0, fy: (1 - fh) / 2, fw: 1, fh, cssWidth: boxWidth, cssHeight: boxWidth / cropAspect };
}

/**
 * Рисует тепловую версию картинки на холст и задаёт ему размер: пропорции места на экране (с запасом),
 * длинная сторона не больше maxSide. Возвращает false, если холст недоступен: остаётся заливка из CSS.
 */
export function paintThermal(canvas: HTMLCanvasElement, image: HTMLImageElement, options: ThermalOptions = {}): boolean {
  if (image.naturalWidth === 0 || image.naturalHeight === 0) return false;
  const imageAspect = image.naturalWidth / image.naturalHeight;
  const boxWidth = options.boxWidth && options.boxWidth > 0 ? options.boxWidth : image.naturalWidth;
  const boxHeight = options.boxHeight && options.boxHeight > 0 ? options.boxHeight : image.naturalHeight;
  const crop = coverCrop(imageAspect, boxWidth, boxHeight);
  const maxSide = options.maxSide ?? 1600;
  const scale = Math.min(options.pixelRatio ?? 1, maxSide / Math.max(crop.cssWidth, crop.cssHeight));
  const width = Math.max(1, Math.round(crop.cssWidth * scale));
  const height = Math.max(1, Math.round(crop.cssHeight * scale));
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return false;

  // Весь кадр в координатах холста: видимая полоса ложится ровно в холст, остальное за его краями.
  const drawWidth = width / crop.fw;
  const drawHeight = height / crop.fh;
  const drawX = -crop.fx * drawWidth;
  const drawY = -crop.fy * drawHeight;

  // Горячая точка и радиус тепла заданы от всего кадра, как прежде: при кадрировании они не меняются.
  const hotX = drawX + (options.hotX ?? 0.5) * drawWidth;
  const hotY = drawY + (options.hotY ?? 0.44) * drawHeight;
  const radius = Math.min(drawWidth, drawHeight) * 0.15;
  const falloff = 1 / (2 * radius * radius);

  try {
    const equalized = equalizeTable(image);
    if (!equalized) return false;
    context.drawImage(image, drawX, drawY, drawWidth, drawHeight);
    const frame = context.getImageData(0, 0, width, height);
    const pixels = frame.data;
    const lut = buildLut();

    for (let y = 0; y < height; y += 1) {
      const dy = (y - hotY) * 1.25;
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4;
        const dx = x - hotX;
        const heat = 0.34 * Math.exp(-(dx * dx + dy * dy) * falloff);
        // Без добавки тепла яркость не поднимается выше красного: жёлтое остаётся только у горячей точки.
        const level = Math.min(255, Math.round((equalized[lumaOf(pixels, offset)] * 0.76 + heat) * 255)) * 3;
        pixels[offset] = lut[level];
        pixels[offset + 1] = lut[level + 1];
        pixels[offset + 2] = lut[level + 2];
      }
    }

    context.putImageData(frame, 0, 0);
    return true;
  } catch {
    // Холст мог оказаться «грязным» или память кончилась: остаётся заливка из CSS.
    return false;
  }
}
