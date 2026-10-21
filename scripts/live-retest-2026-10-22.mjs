/**
 * Read-only retest probe (2026-10-22): does /api/recommend with
 * types:["series"] return series at all (direct API), and what does the
 * Series filter do from a neutral UI context (home -> mood -> filter)?
 */
import { writeFileSync } from 'node:fs';
const BASE = 'https://movie-night-picker-one.vercel.app';
const out = [];

// --- 1. direct API: minimal body, types:["series"] ---
const body = {
  mood: 'Surprise me',
  genres: ['Surprise me'],
  audience: 'Just me',
  maxRuntime: 'Any length',
  languages: ['Any'],
  types: ['series'],
  preferences: { highlyRated: false, hiddenGems: false, recent: false, classics: false, mature: false },
  note: '',
  excludeIds: [],
  taste: { weights: {}, eventCount: 0 },
  referenceIds: [],
};
const r = await fetch(`${BASE}/api/recommend`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
const j = await r.json();
const picks = j.results ?? j.recommendations ?? j.picks ?? [];
out.push({ test: 'direct API types=[series]', status: r.status, keys: Object.keys(j), count: picks.length, first: picks.slice(0, 5).map((p) => `${p.title ?? p.name ?? '?'} [${p.type ?? p.mediaType ?? '?'}]`) });

// --- 2. UI: neutral context (no search), mood results page, then Series filter ---
const { chromium } = await import('@playwright/test');
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
const bodies = [];
page.on('request', (req) => { if (req.url().endsWith('/api/recommend')) bodies.push({ note: safe(req), types: safeTypes(req) }); });
function safe(req) { try { return JSON.parse(req.postData()).note ?? null; } catch { return null; } }
function safeTypes(req) { try { return JSON.parse(req.postData()).types ?? null; } catch { return null; } }
page.route('**/api/analytics/**', (route) => route.abort());
page.route(/\/api\/event$/, (route) => route.abort());

await page.goto(BASE, { waitUntil: 'networkidle', timeout: 45000 });
await page.getByRole('button', { name: 'Browse by mood' }).click({ timeout: 10000 });
await Promise.all([
  page.waitForResponse((res) => res.url().endsWith('/api/recommend'), { timeout: 30000 }),
  page.locator('button:has-text("Funny")').first().click(),
]);
await page.waitForTimeout(4000);

await page.locator('button:has-text("Filters")').first().click({ timeout: 10000 });
await page.waitForTimeout(1000);
await page.locator('button:has-text("Type")').first().click({ timeout: 5000 }).catch(() => {});
await page.waitForTimeout(500);
let resp2 = null;
try {
  [resp2] = await Promise.all([
    page.waitForResponse((res) => res.url().endsWith('/api/recommend'), { timeout: 30000 }),
    page.locator('button:has-text("Series")').first().click(),
  ]);
} catch { out.push({ test: 'UI series filter', error: 'no response fired' }); }
await page.waitForTimeout(4000);
const header = await page.locator('h1').first().textContent().catch(() => null);
const cards = await page.locator('article').count();
const firstText = cards ? await page.locator('article').first().innerText().then((t) => t.replace(/\s+/g, ' ').slice(0, 120)) : '';
out.push({ test: 'UI series filter (neutral context)', status: resp2?.status() ?? null, sentTypes: bodies[bodies.length - 1]?.types, header, cards, firstText });
await page.screenshot({ path: 'reports/live-evidence-2026-10-22/s11-series-neutral.png' });

await browser.close();
writeFileSync('reports/live-evidence-2026-10-22/retest-series-probe.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
