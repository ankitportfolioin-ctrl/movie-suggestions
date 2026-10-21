/**
 * One-off search-flow debug (read-only): replay hero search and dump state.
 */
import { chromium } from '@playwright/test';
const BASE = 'https://movie-night-picker-one.vercel.app';
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const reqs = [];
page.on('request', (r) => { if (r.url().includes('/api/')) reqs.push(`${r.method()} ${r.url().slice(29, 120)}`); });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e?.stack ?? e).slice(0, 500)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 300)); });
page.route('**/api/analytics/**', (route) => route.abort());
page.route(/\/api\/event$/, (route) => route.abort());

await page.goto(BASE, { waitUntil: 'networkidle', timeout: 45000 });
await page.locator('#hero-search').fill('Inception');
await page.keyboard.press('Enter');
await page.waitForTimeout(4000);
console.log('after first Enter: url=', page.url());
console.log('visible h1:', await page.locator('h1').first().textContent().catch(() => null));
console.log('search input visible:', await page.locator('input[placeholder*="Describe what you want"]').isVisible().catch(() => false));
console.log('requests after 1st:', reqs);
await page.locator('input[placeholder*="Describe what you want"]').press('Enter');
await page.waitForTimeout(6000);
console.log('requests after 2nd:', reqs);
console.log('h1:', await page.locator('h1').first().textContent().catch(() => null));
console.log('finding-picks visible:', await page.getByText('Finding your picks').first().isVisible().catch(() => false));
console.log('errors:', errs.slice(0, 6));
await page.screenshot({ path: 'reports/live-evidence-2026-10-21/s03b-search-debug.png' });
await browser.close();
