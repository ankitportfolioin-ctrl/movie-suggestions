/**
 * Read-only axe check of the natural-search flow (retest 2026-10-22):
 * if the transitional search page still appears, axe it; otherwise the fix
 * landed and the first Enter runs the search — axe whatever state a single
 * Enter lands on instead.
 */
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';
const BASE = 'https://movie-night-picker-one.vercel.app';
mkdirSync('reports/live-evidence-2026-10-22', { recursive: true });
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
let apiCalls = 0;
page.on('response', (r) => { if (r.url().endsWith('/api/recommend')) apiCalls++; });
page.route('**/api/analytics/**', (r) => r.abort());
page.route(/\/api\/event$/, (r) => r.abort());
await page.goto(BASE, { waitUntil: 'networkidle', timeout: 45000 });
await page.locator('#hero-search').fill('a suspenseful thriller');
await page.keyboard.press('Enter');
await page.waitForTimeout(4000);
const naturalInput = page.locator('input[placeholder*="Describe what you want"]');
const naturalPageVisible = await naturalInput.isVisible().catch(() => false);
console.log('legacy natural-search page visible:', naturalPageVisible);
console.log('h1 count:', await page.locator('h1').count(), '| cards:', await page.locator('article').count(), '| apiCalls:', apiCalls);
const r = await new AxeBuilder({ page }).analyze();
console.log('violations:', r.violations.map((v) => `${v.impact}/${v.id}(${v.nodes.length})`).join(', ') || 'clean');
if (naturalPageVisible) {
  console.log('input aria-label:', await naturalInput.getAttribute('aria-label'), '| has label-for:', await page.locator('label[for]').count());
}
await page.screenshot({ path: 'reports/live-evidence-2026-10-22/s09b-axe-after-first-enter.png' });
await browser.close();
