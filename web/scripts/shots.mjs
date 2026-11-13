#!/usr/bin/env node
/**
 * Серия скриншотов страницы с прокруткой (Playwright, Chromium).
 *
 *   node scripts/shots.mjs <url> <ширина> <высота> <шаг прокрутки, px> <каталог вывода> [флаги]
 *
 * Пример:
 *   node scripts/shots.mjs http://localhost:3210/ 1440 810 700 .reanimate/home/check --first=40 --last=5
 *   node scripts/shots.mjs http://localhost:3210/ 390 844 700 .reanimate/home/check --mobile --menu
 *
 * Флаги:
 *   --first=N     снять только первые N шагов (по умолчанию все)
 *   --last=M      и последние M шагов страницы (по умолчанию 0)
 *   --prefix=имя  начало имени файла (по умолчанию из адреса и ширины)
 *   --mobile      телефон: сенсорный экран, плотность 2, мобильный user agent
 *   --reduced     prefers-reduced-motion: reduce
 *   --menu        открыть мобильное меню и снять его отдельным кадром
 *   --wait=мс     пауза после каждой прокрутки (по умолчанию 900: жетон успевает догнать позу)
 *   --lang=ru|ba  язык интерфейса (cookie afisha_lang)
 *
 * Печатает: высоту страницы, список файлов, ошибки консоли и страницы, неудачные запросы,
 * а также наличие горизонтальной прокрутки. Код выхода 1, если были ошибки.
 */

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { chromium } from 'playwright';

const [url, widthArg, heightArg, stepArg, outDirArg, ...rest] = process.argv.slice(2);

if (!url || !widthArg || !heightArg || !stepArg || !outDirArg) {
  console.error('Использование: node scripts/shots.mjs <url> <ширина> <высота> <шаг> <каталог> [флаги]');
  process.exit(2);
}

const flags = Object.fromEntries(
  rest.map((item) => {
    const [key, value] = item.replace(/^--/, '').split('=');
    return [key, value ?? true];
  }),
);

const width = Number(widthArg);
const height = Number(heightArg);
const step = Number(stepArg);
const outDir = path.resolve(outDirArg);
const first = flags.first ? Number(flags.first) : Infinity;
const last = flags.last ? Number(flags.last) : 0;
const wait = flags.wait ? Number(flags.wait) : 900;
const mobile = Boolean(flags.mobile);

const target = new URL(url);
const slug = target.pathname.replace(/\/+$/, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'home';
const prefix = typeof flags.prefix === 'string' ? flags.prefix : `${slug}-${width}`;

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width, height },
  deviceScaleFactor: mobile ? 2 : 1,
  isMobile: mobile,
  hasTouch: mobile,
  reducedMotion: flags.reduced ? 'reduce' : 'no-preference',
  userAgent: mobile
    ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
    : undefined,
});

if (typeof flags.lang === 'string') {
  await context.addCookies([{ name: 'afisha_lang', value: flags.lang, url: target.origin }]);
}

const page = await context.newPage();
const problems = [];

page.on('console', (message) => {
  if (message.type() === 'error') problems.push(`console.error: ${message.text()}`);
});
page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
page.on('requestfailed', (request) => {
  const failure = request.failure()?.errorText ?? '';
  // Отменённые запросы предзагрузки не считаются сбоем.
  if (!failure.includes('ERR_ABORTED')) problems.push(`requestfailed: ${request.url()} ${failure}`);
});
page.on('response', (response) => {
  if (response.status() >= 400) problems.push(`http ${response.status()}: ${response.url()}`);
});

await page.goto(url, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
// Главная: ждём, пока уйдёт экран загрузки (он держит прокрутку, пока грузятся картинки и жетон)
await page.waitForFunction(() => !document.querySelector('[data-preloader]'), null, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(800);

const measure = () =>
  page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    innerHeight: window.innerHeight,
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));

const size = await measure();
const maxScroll = Math.max(0, size.scrollHeight - size.innerHeight);
const totalSteps = Math.floor(maxScroll / step) + 1;

const positions = [];
for (let index = 0; index < totalSteps; index += 1) {
  const fromStart = index < first;
  const fromEnd = index >= totalSteps - last;
  if (fromStart || fromEnd) positions.push({ index, y: Math.min(index * step, maxScroll) });
}
// Самый низ страницы снимаем всегда, если просили хвост.
if (last > 0 && positions.at(-1)?.y !== maxScroll) positions.push({ index: totalSteps, y: maxScroll });

const files = [];
let overflowX = false;

for (const { index, y } of positions) {
  await page.evaluate((top) => window.scrollTo(0, top), y);
  await page.waitForTimeout(wait);
  const state = await page.evaluate(() => ({
    y: Math.round(window.scrollY),
    overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    active: document.querySelector('[data-scene][data-active]')?.getAttribute('data-scene') ?? null,
    tone: document.documentElement.dataset.headerTone ?? null,
  }));
  if (state.overflow) overflowX = true;
  const name = `${prefix}-${String(index).padStart(3, '0')}-y${String(state.y).padStart(6, '0')}.png`;
  await page.screenshot({ path: path.join(outDir, name) });
  files.push({ name, y: state.y, scene: state.active, tone: state.tone });
}

if (flags.menu) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(wait);
  const button = page.locator('.site-header__compact .site-header__menu-button');
  if (await button.isVisible()) {
    await button.click();
    await page.waitForTimeout(700);
    const name = `${prefix}-menu-open.png`;
    await page.screenshot({ path: path.join(outDir, name) });
    const open = await page.evaluate(() => ({
      open: document.querySelector('.mobile-menu')?.hasAttribute('data-open') ?? false,
      focus: document.activeElement?.className ?? '',
      links: document.querySelectorAll('.mobile-menu__link').length,
      minLinkHeight: Math.min(
        ...Array.from(document.querySelectorAll('.mobile-menu a, .mobile-menu button')).map(
          (node) => node.getBoundingClientRect().height,
        ),
      ),
    }));
    files.push({ name, menu: open });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    const closed = await page.evaluate(() => !document.querySelector('.mobile-menu')?.hasAttribute('data-open'));
    files.push({ name: '(меню закрыто клавишей Escape)', closed });
  } else {
    problems.push('Кнопка мобильного меню не видна на этой ширине');
  }
}

await browser.close();

console.log(
  JSON.stringify(
    {
      url,
      viewport: `${width}x${height}${mobile ? ' mobile' : ''}${flags.reduced ? ' reduced-motion' : ''}`,
      pageHeight: size.scrollHeight,
      screens: Number((size.scrollHeight / size.innerHeight).toFixed(2)),
      totalSteps,
      shots: files.length,
      horizontalScroll: overflowX || size.scrollWidth > size.innerWidth + 1,
      outDir,
    },
    null,
    2,
  ),
);
for (const file of files) console.log(JSON.stringify(file));
if (problems.length > 0) {
  console.log(`\nОшибки (${problems.length}):`);
  for (const problem of [...new Set(problems)]) console.log(`  ${problem}`);
  process.exitCode = 1;
} else {
  console.log('\nОшибок консоли, страницы и сети нет.');
}
