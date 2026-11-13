// Контраст текста по реальным пикселям (ТЗ п. 6.1: не ниже 4.5:1). Дополняет axe там, где фон это градиент,
// картинка или наложение и axe не может определить цвет фона.
// Как: текст прячется, страница снимается, под каждым текстовым элементом берётся медианный цвет фона
// и сравнивается с цветом текста. Порог 4.5:1, для крупного текста (от 24 px или от 18.7 px жирным) 3:1.
// Запуск при работающем сайте: node scripts/contrast-audit.mjs [адрес] [страницы через запятую] [ширина]
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const sharp = require('sharp');

const base = process.argv[2] ?? 'http://localhost:3210';
const pages = (process.argv[3] ?? '/events,/ask,/widget,/about,/developers,/admin').split(',');
const width = Number(process.argv[4] ?? 1280);

function luminance([r, g, b]) {
  const c = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const ratio = (a, b) => {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};

const browser = await chromium.launch({ args: ['--no-proxy-server'] });
let failed = false;
for (const path of pages) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
  await page.goto(base + path, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !document.querySelector('[data-preloader]'), null, { timeout: 20000 }).catch(() => {});
  // Каскадное появление блоков: мерить после того, как прозрачность дошла до конца.
  await page.waitForTimeout(3000);
  // Текстовые элементы первого экрана и ниже: только видимые, с собственным текстом.
  const items = await page.evaluate(() => {
    const out = [];
    // Цвет в любом формате (oklch, color-mix) переводится в RGBA через canvas.
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const toRgba = (css) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = '#000';
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return [r, g, b, a / 255];
    };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    while (walker.nextNode()) {
      const text = walker.currentNode.textContent.trim();
      const el = walker.currentNode.parentElement;
      if (!text || !el || seen.has(el)) continue;
      seen.add(el);
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4 || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) continue;
      // Ссылка-пропуск видна только в фокусе и тогда стоит на своей подложке.
      if (el.closest('[aria-hidden="true"], .visually-hidden, [inert], .skip-link')) continue;
      // Содержимое свёрнутого <details> не нарисовано: его не видно, пока блок не раскрыли.
      const details = el.closest('details:not([open])');
      if (details && !el.closest('summary')) continue;
      // Текст плавающих панелей стоит на их собственной подложке (основные токены fg/bg); его проверяет axe.
      let floating = false;
      for (let node = el; node && node !== document.body; node = node.parentElement) {
        const position = getComputedStyle(node).position;
        if ((position === 'fixed' || position === 'sticky') && node.getBoundingClientRect().height < window.innerHeight * 0.9) floating = true;
      }
      if (floating) continue;
      const m = toRgba(style.color);
      const size = parseFloat(style.fontSize);
      const weight = Number(style.fontWeight) || 400;
      out.push({
        text: text.slice(0, 40),
        color: m.slice(0, 3),
        alpha: m[3] ?? 1,
        large: size >= 24 || (size >= 18.66 && weight >= 700),
        x: rect.left + window.scrollX,
        y: rect.top + window.scrollY,
        w: rect.width,
        h: rect.height,
      });
    }
    return out;
  });
  await page.addStyleTag({ content: '*{color:transparent!important;text-shadow:none!important;caret-color:transparent!important}' });
  // Плавающие панели (закреплённая кнопка «Фильтры», шапка) на полноэкранном снимке ложатся на чужой текст.
  // Фоном они не служат, поэтому на время снимка прячутся; полноэкранные фоны (свечение, зерно) остаются.
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('body *')) {
      const position = getComputedStyle(el).position;
      if ((position === 'fixed' || position === 'sticky') && el.getBoundingClientRect().height < window.innerHeight * 0.9) {
        el.style.setProperty('visibility', 'hidden', 'important');
      }
    }
  });
  await page.waitForTimeout(200);
  const shot = await page.screenshot({ fullPage: true });
  const { data, info } = await sharp(shot).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const scale = info.width / width;
  const pixel = (x, y) => {
    const i = (Math.min(info.height - 1, Math.max(0, Math.round(y * scale))) * info.width + Math.min(info.width - 1, Math.max(0, Math.round(x * scale)))) * 3;
    return [data[i], data[i + 1], data[i + 2]];
  };
  const bad = [];
  for (const item of items) {
    const samples = [];
    for (let sx = 0; sx < 5; sx += 1) for (let sy = 0; sy < 3; sy += 1) samples.push(pixel(item.x + ((sx + 0.5) * item.w) / 5, item.y + ((sy + 0.5) * item.h) / 3));
    samples.sort((a, b) => luminance(a) - luminance(b));
    // Худший случай: самый близкий к цвету текста фон среди средних образцов (без крайних выбросов).
    const candidates = samples.slice(2, -2);
    const text = item.color.map((c, k) => Math.round(c * item.alpha + candidates[Math.floor(candidates.length / 2)][k] * (1 - item.alpha)));
    const worst = Math.min(...candidates.map((bg) => ratio(text, bg)));
    const need = item.large ? 3 : 4.5;
    if (worst < need) bad.push(`${worst.toFixed(2)} < ${need}: «${item.text}»`);
  }
  if (bad.length) failed = true;
  console.log(`\n${width}px ${path}: текстов ${items.length}, ниже порога ${bad.length}`);
  for (const line of [...new Set(bad)].slice(0, 15)) console.log('   ', line);
  await page.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
