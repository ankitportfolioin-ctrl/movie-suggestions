/**
 * Read-only axe check of the transitional natural-search page (2026-10-21):
 * reachable from the hero search in natural mode; no API call until submitted.
 */
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
const BASE = 'https://movie-night-picker-one.vercel.app';
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
page.route('**/api/analytics/**', (r) => r.abort());
page.route(/\/api\/event$/, (r) => r.abort());
await page.goto(BASE, { waitUntil: 'networkidle', timeout: 45000 });
await page.locator('#hero-search').fill('a suspenseful thriller');
await page.keyboard.press('Enter');          // -> dedicated natural-search page
await page.waitForTimeout(1200);
console.log('on page:', await page.locator('h1').count(), 'h1 elements');
const r = await new AxeBuilder({ page }).analyze();
console.log('violations:', r.violations.map((v) => `${v.impact}/${v.id}(${v.nodes.length})`).join(', ') || 'clean');
const input = page.locator('input[placeholder*="Describe what you want"]');
console.log('input aria-label:', await input.getAttribute('aria-label'), '| has label-for:', await page.locator('label[for]').count());
await page.screenshot({ path: 'reports/live-evidence-2026-10-21/s09b-axe-natural-search-page.png' });
await browser.close();
