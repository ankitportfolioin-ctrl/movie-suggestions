/**
 * One-off read-only poster probe (2026-10-21): why do result-card posters show
 * no image and no image network request? Loads home, runs one mood pick, then
 * dumps the poster container HTML and /img request statuses.
 */
import { chromium } from '@playwright/test';

const BASE = 'https://movie-night-picker-one.vercel.app';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
const imgReqs = [];
page.on('response', (r) => { if (r.url().includes('/img/')) imgReqs.push(`${r.status()} ${r.url().slice(0, 130)}`); });
page.on('requestfailed', (r) => { if (r.url().includes('/img/')) imgReqs.push(`FAILED ${r.url().slice(0, 130)} ${r.failure()?.errorText}`); });
page.route('**/api/analytics/**', (route) => route.abort());
page.route(/\/api\/event$/, (route) => route.abort());

await page.goto(BASE, { waitUntil: 'networkidle', timeout: 45000 });
await page.getByRole('button', { name: 'Browse by mood' }).click();
const [resp] = await Promise.all([
  page.waitForResponse((r) => r.url().includes('/api/recommend'), { timeout: 30000 }),
  page.locator('button:has-text("Mind-bending")').first().click(),
]);
const rec = await resp.json();
console.log('API posterUrl[0].slice(0,120):', rec.movies?.[0]?.posterUrl?.slice(0, 120));
console.log('API posterUrl types:', (rec.movies || []).map((m) => (typeof m.posterUrl) + ':' + (m.posterUrl || '').slice(0, 40)));
await page.waitForTimeout(4000);

const dump = await page.evaluate(() => {
  const arts = [...document.querySelectorAll('article')].slice(0, 3);
  return arts.map((el, i) => {
    const img = el.querySelector('img');
    return {
      i,
      articleImgs: el.querySelectorAll('img').length,
      imgSrcAttr: img?.getAttribute('src') ?? null,
      imgCurrentSrc: img?.currentSrc ?? null,
      natural: img ? `${img.naturalWidth}x${img.naturalHeight}` : null,
      containerHtml: el.querySelector('div')?.outerHTML.replace(/\s+/g, ' ').slice(0, 350) ?? null,
      imgHtml: img ? img.outerHTML.slice(0, 260) : null,
    };
  });
});
console.log(JSON.stringify(dump, null, 1));
console.log('/img requests observed:', imgReqs.length);
imgReqs.slice(0, 6).forEach((l) => console.log('  ' + l));

// scroll to force lazy loading, wait, re-check
await page.evaluate(() => window.scrollTo(0, 400));
await page.waitForTimeout(4000);
const again = await page.evaluate(() => [...document.querySelectorAll('article img')].slice(0, 4).map((im) => ({ src: (im.getAttribute('src') || '').slice(0, 80), cur: (im.currentSrc || '').slice(0, 80), loaded: im.naturalWidth > 0 })));
console.log('after scroll:', JSON.stringify(again));
console.log('/img requests total:', imgReqs.length);
imgReqs.slice(0, 8).forEach((l) => console.log('  ' + l));
await page.screenshot({ path: 'reports/live-evidence-2026-10-21/s02b-poster-probe.png' });
await browser.close();
