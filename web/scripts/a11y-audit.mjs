// Аудит доступности (ТЗ п. 6.1): 360 px, клавиатура и видимый фокус, контраст, alt и подписи полей.
// Запуск при работающем сайте: node scripts/a11y-audit.mjs [адрес] [страницы через запятую]
//   node scripts/a11y-audit.mjs http://localhost:3210 /,/events,/ask
// Что проверяет на ширине 1280 и 360:
//   - axe-core по WCAG 2.2 A и AA (контраст, alt, подписи полей, роли, имена кнопок и ссылок);
//   - горизонтальную прокрутку страницы;
//   - проход по Tab: у каждого элемента в фокусе должен быть видимый индикатор (outline или тень).
// Код выхода 1, если есть нарушения axe уровня serious или critical, вылет по ширине или фокус без индикатора.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const base = process.argv[2] ?? 'http://localhost:3210';
const pages = (process.argv[3] ?? '/,/events,/ask,/widget,/about,/developers,/admin,/embed?city=ufa').split(',');
const VIEWPORTS = [
  { name: '1280', width: 1280, height: 900 },
  { name: '360', width: 360, height: 780 },
];
const TABS = 40;

async function settle(page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForFunction(() => !document.querySelector('[data-preloader]'), null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(800);
}

/**
 * Видим ли фокус: вид элемента и трёх его предков в фокусе сравнивается с видом без фокуса
 * (outline, тень, цвет рамки и фона, подчёркивание). Так засчитываются и кольцо на карточке
 * через :has(:focus-visible), и рамка обёртки поля. Внутри Shadow DOM берётся настоящий элемент.
 */
async function focusAudit(page) {
  const missing = [];
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    document.activeElement?.blur?.();
  });
  for (let i = 0; i < TABS; i += 1) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      let el = document.activeElement;
      while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
      if (!el || el === document.body) return null;
      const chain = [];
      for (let node = el, depth = 0; node && depth < 4; depth += 1) {
        chain.push(node);
        node = node.parentElement ?? node.getRootNode()?.host ?? null;
      }
      const parts = chain.flatMap((node, index) => (index === 0 ? [[node, null], [node, '::after'], [node, '::before']] : [[node, null]]));
      const snap = () =>
        parts
          .map(([node, pseudo]) => {
            const s = getComputedStyle(node, pseudo);
            const ring = s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0 ? `${s.outlineColor} ${s.outlineWidth}` : '';
            return [ring, s.boxShadow, s.borderTopColor, s.borderBottomColor, s.backgroundColor, s.textDecorationLine, s.textDecorationColor].join('|');
          })
          .join('#');
      const focused = snap();
      const outline = getComputedStyle(el).outlineStyle !== 'none' && parseFloat(getComputedStyle(el).outlineWidth) > 0;
      el.blur();
      const blurred = snap();
      el.focus();
      const rect = el.getBoundingClientRect();
      const label = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('name') || el.tagName).trim().slice(0, 50);
      return { ok: outline || focused !== blurred, tag: el.tagName.toLowerCase(), label, visible: rect.width > 0 && rect.height > 0 };
    });
    if (info && info.visible && !info.ok) missing.push(`${info.tag} «${info.label}»`);
  }
  return [...new Set(missing)];
}

const browser = await chromium.launch({ args: ['--no-proxy-server'] });
let failed = false;
for (const viewport of VIEWPORTS) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, locale: 'ru-RU', reducedMotion: 'reduce' });
  for (const path of pages) {
    const page = await context.newPage();
    await page.goto(base + path, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await settle(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    await page.addScriptTag({ content: AXE });
    const axe = await page.evaluate(async () => {
      // eslint-disable-next-line no-undef
      const result = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } });
      return result.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        count: v.nodes.length,
        help: v.help,
        sample: v.nodes.slice(0, 3).map((n) => `${n.target.join(' ')}${n.any[0]?.message ? ` → ${n.any[0].message}` : ''}`),
      }));
    });
    const focus = await focusAudit(page);
    const serious = axe.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    if (serious.length || overflow > 1 || focus.length) failed = true;
    console.log(`\n${viewport.name}px ${path}: вылет ${overflow}px, нарушений axe ${axe.length} (серьёзных ${serious.length}), фокус без индикатора ${focus.length}`);
    for (const v of axe) {
      console.log(`  [${v.impact}] ${v.id} ×${v.count}: ${v.help}`);
      for (const s of v.sample) console.log(`      ${s.slice(0, 220)}`);
    }
    for (const f of focus.slice(0, 8)) console.log(`  фокус не виден: ${f}`);
    await page.close();
  }
  await context.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
