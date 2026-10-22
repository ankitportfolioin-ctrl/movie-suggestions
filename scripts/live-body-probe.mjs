/**
 * Read-only request-body probe (2026-10-21): does the hero search send the
 * typed query (note) to /api/recommend, and does the Series filter send
 * types=[series]? Dumps both request bodies. No assertions, just evidence.
 */
import { chromium } from '@playwright/test';
const BASE = 'https://movie-night-picker-one.vercel.app';
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const bodies = [];
page.on('request', (r) => {
  if (r.url().endsWith('/api/recommend')) bodies.push(r.postData());
});
page.route('**/api/analytics/**', (route) => route.abort());
page.route(/\/api\/event$/, (route) => route.abort());

await page.goto(BASE, { waitUntil: 'networkidle', timeout: 45000 });
await page.locator('#hero-search').fill('Inception');
await page.keyboard.press('Enter');
await page.locator('input[placeholder*="Describe what you want"]').press('Enter');
try { await page.waitForResponse((r) => r.url().endsWith('/api/recommend'), { timeout: 30000 }); } catch {}
console.log('--- search request body ---');
console.log(bodies[0] ?? '(none)');

await page.waitForTimeout(2500);
await page.locator('button:has-text("Filters")').first().click({ timeout: 10000 }).catch(() => {});
await page.waitForTimeout(800);
await page.locator('button:has-text("Type")').first().click({ timeout: 5000 }).catch(() => {});
await page.waitForTimeout(500);
await page.locator('button:has-text("Series")').first().click({ timeout: 5000 }).catch(() => {});
try { await page.waitForResponse((r) => r.url().endsWith('/api/recommend'), { timeout: 30000 }); } catch {}
console.log('--- filter request body ---');
console.log(bodies[1] ?? bodies[0] ?? '(none)');
const h1 = await page.locator('h1').first().textContent().catch(() => null);
const firstTitle = await page.locator('article').first().innerText().then((t) => t.replace(/\s+/g, ' ').slice(0, 90)).catch(() => '');
console.log('after filter: h1=', h1, '| first card=', firstTitle);
await browser.close();
