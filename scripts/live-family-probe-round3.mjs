/**
 * Read-only family-audience probe (retest-2, 2026-10-22): the deployed
 * wizard labels the chip "Family / kids" — walk the wizard with that label
 * and verify the request body audience and that every pick says "All ages".
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
const BASE = 'https://movie-night-picker-one.vercel.app';
mkdirSync('reports/live-evidence-2026-10-22-r2', { recursive: true });

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
let sentAudience = null, respNotices = [];
page.route('**/api/analytics/**', (r) => r.abort());
page.route(/\/api\/event$/, (r) => r.abort());

await page.goto(BASE, { waitUntil: 'networkidle', timeout: 45000 });
await page.locator('button:has-text("Pick for me")').first().click({ timeout: 10000 });
await page.waitForTimeout(1000);
await page.locator('button:has-text("Family / kids")').first().click({ timeout: 10000 });
await page.waitForTimeout(800);
await page.locator('button:has-text("Feel-good")').first().click({ timeout: 10000 }); // mood step
await page.waitForTimeout(800);
const tR = Date.now();
await Promise.all([
  page.waitForResponse(async (r) => {
    if (!r.url().endsWith('/api/recommend')) return false;
    try { sentAudience = JSON.parse(r.request().postData()).audience ?? null; } catch {}
    try { respNotices = (await (await r.response()).json()).notices ?? []; } catch {}
    return true;
  }, { timeout: 30000 }),
  page.locator('button:has-text("Skip")').first().click({ timeout: 10000 }), // runtime step
]);
const dur = Date.now() - tR;
await page.waitForSelector('article', { timeout: 20000 });
await page.waitForTimeout(1500);
await page.evaluate(async () => {
  for (let y = 0; y <= document.body.scrollHeight; y += 700) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 250)); }
  window.scrollTo(0, 0);
});
await page.waitForTimeout(1500);
const audit = await page.evaluate(() => {
  const arts = [...document.querySelectorAll('article')];
  return {
    header: document.querySelector('h1')?.textContent?.trim() ?? '',
    cards: arts.map((el) => {
      const img = el.querySelector('img');
      const text = el.innerText.replace(/\s+/g, ' ');
      return {
        title: el.querySelector('h2,h3')?.textContent?.trim() ?? img?.getAttribute('alt') ?? '',
        age: text.match(/All ages|1?6\+|18\+|\b\d{1,2}\+|Rating not confirmed/)?.[0] ?? 'none',
        posterLoaded: img ? !!img.complete && img.naturalWidth > 0 : null,
      };
    }),
  };
});
const allAges = audit.cards.length > 0 && audit.cards.every((c) => c.age === 'All ages');
await page.screenshot({ path: 'reports/live-evidence-2026-10-22-r2/s07-family-kids.png' });
const out = { sentAudience, header: audit.header, cards: audit.cards.length, allAges, cardAges: audit.cards.map((c) => `${c.title}: ${c.age} (poster=${c.posterLoaded})`), respNotices, durationMs: dur };
writeFileSync('reports/live-evidence-2026-10-22-r2/family-probe.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await browser.close();
