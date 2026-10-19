/**
 * One-shot production probe (delete after evidence capture).
 * Standalone Playwright script against the PUBLIC deployment — not a test.
 * Produces: trace.zip (tablet session), network ndjson, screenshots, findings JSON.
 * Read-only for other people: nav + quiz defaults + save/remove on a FRESH anon
 * id (localStorage cleared = brand-new visitor); the error/retry UX stub is
 * per-browser-only and never mutates anything server-side.
 */
import { chromium } from '@playwright/test';
import { mkdirSync, appendFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const BASE = 'https://movie-night-picker-one.vercel.app/';
const OUT = 'reports/prod-evidence-2026-10-19';
const tabletDir = path.join(OUT, 'tablet-768x1024');
const pcDir = path.join(OUT, 'desktop-1366x768');
mkdirSync(tabletDir, { recursive: true });
mkdirSync(pcDir, { recursive: true });

const findings = [];

/** Bounded observation: ['ok',v] | ['timeout',null] | ['err',msg] — never throws. */
function bounded(p, ms, label) {
  const t = new Promise((r) => setTimeout(() => r(['timeout', null]), ms));
  return Promise.race([p.then((v) => ['ok', v], (e) => ['err', String(e?.message ?? e).slice(0, 300)]), t])
    .then((res) => { findings.push({ t: new Date().toISOString(), label, result: res[0], detail: res[1] ?? null }); return res; });
}

/** Attach network + console/pageerror ndjson recorder to a page. */
function attachRecorder(page, file) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, '');
  const line = (o) => appendFileSync(file, JSON.stringify({ t: new Date().toISOString(), ...o }) + '\n');
  page.on('response', (r) => line({ event: 'response', status: r.status(), method: r.request().method(), url: r.url().slice(0, 160) }));
  page.on('requestfailed', (r) => line({ event: 'requestfailed', method: r.method(), url: r.url().slice(0, 160), err: r.failure()?.errorText }));
  page.on('console', (m) => { if (m.type() === 'error') line({ event: 'console-error', text: m.text().slice(0, 200) }); });
  page.on('pageerror', (e) => line({ event: 'pageerror', text: String(e?.message ?? e).slice(0, 200) }));
}

const browser = await chromium.launch();

// ---------------------------------------------------------------- tablet session
{
  const ctx = await browser.newContext({
    viewport: { width: 768, height: 1024 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
  });
  await ctx.tracing.start({ screenshots: true, snapshots: true, sources: false });
  const page = await ctx.newPage();

  let shot = 0;
  const shotTo = async (name) => { try { await page.screenshot({ path: path.join(tabletDir, `${String(++shot).padStart(2, '0')}-${name}.png`) }); } catch {} };

  const t0 = Date.now();
  await bounded(page.goto(BASE, { waitUntil: 'load', timeout: 45_000 }), 50_000, 'goto / (load)');
  await bounded(page.waitForSelector('h1', { timeout: 20_000 }), 25_000, 'hero h1 visible');
  findings.push({ session: 'tablet768', t: new Date().toISOString(), event: 'homepage-load-ms', detail: Date.now() - t0 });

  await shotTo('home');
  await bounded(page.getByRole('button', { name: 'Discover' }).click({ timeout: 10_000 }), 15_000, 'tap Discover');
  await page.waitForTimeout(1500);
  findings.push({ session: 'tablet768', event: 'discover-scrollY', detail: await page.evaluate(() => Math.round(window.scrollY)).catch(() => null) });
  await shotTo('discover-tap');
  await bounded(page.getByRole('button', { name: 'How It Works' }).click({ timeout: 10_000 }), 15_000, 'tap How It Works');
  await page.waitForTimeout(1500);
  findings.push({ session: 'tablet768', event: 'howitworks-scrollY', detail: await page.evaluate(() => Math.round(window.scrollY)).catch(() => null) });
  await shotTo('how-it-works-tap');

  // Start quiz at tablet size — the flow the old report timed out on.
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  await bounded(page.getByRole('button', { name: /Start Full Quiz|Start Tonight's Match|Start Quiz/ }).first().click({ timeout: 15_000 }), 20_000, 'tap Start Quiz');
  await bounded(page.waitForSelector('text=Question 1 of 8', { timeout: 15_000 }), 20_000, 'Q1 visible');
  await shotTo('q1');
  for (let i = 0; i < 7; i++) {
    await bounded(page.getByRole('button', { name: 'Continue' }).click({ timeout: 10_000 }), 15_000, `tap Continue at Q${i + 1}`);
  }
  const tFind = Date.now();
  await bounded(page.getByRole('button', { name: 'Find my movies' }).click({ timeout: 15_000 }), 20_000, 'tap Find my movies');
  const rec = await bounded(
    page.waitForResponse((r) => r.url().includes('/api/recommend'), { timeout: 45_000 }),
    50_000, 'tablet /api/recommend response'
  );
  findings.push({ session: 'tablet768', event: 'recommend-latency-ms', detail: { ms: Date.now() - tFind, status: rec[0] === 'ok' ? rec[1].status() : null } });
  await page.waitForTimeout(4000);
  findings.push({ session: 'tablet768', event: 'post-find-cards', detail: await page.locator('article').count().catch(() => null) });
  await shotTo('after-find-wait');

  await ctx.tracing.stop({ path: path.join(tabletDir, 'tablet-trace.zip') });
  findings.push({ session: 'tablet768', event: 'trace-written', detail: 'tablet-trace.zip' });
  await ctx.close();
}

// ---------------------------------------------------------------- desktop battery
{
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await ctx.newPage();
  attachRecorder(page, path.join(pcDir, 'network.ndjson'));

  await bounded(page.goto(BASE, { waitUntil: 'load', timeout: 45_000 }), 50_000, 'goto /');
  // Fresh anon id: brand-new visitor identity; nobody else's data is touched.
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto(BASE, { waitUntil: 'load' });

  // Deployment/version markers from the served build (commit SHA likely unverifiable).
  const html = await page.content();
  const assetHashes = [...html.matchAll(/assets\/index-[^"'?]+/g)].map((m) => m[0]);
  const vercelHeaders = await page.request.get(BASE).then((r) => {
    const h = r.headers();
    return { 'x-vercel-id': h['x-vercel-id'] ?? null, 'x-vercel-cache': h['x-vercel-cache'] ?? null, age: h['age'] ?? null, 'last-modified': h['last-modified'] ?? null };
  });
  findings.push({ session: 'desktop1366', event: 'deployment-markers', detail: { assetHashes, vercelHeaders, commitShaClaim: 'NOT VERIFIABLE from the served page/headers' } });

  // 1) Recommendations + card metadata (real recommend on default answers).
  await page.getByRole('button', { name: /Start Full Quiz|Start Quiz/ }).first().click();
  for (let i = 0; i < 7; i++) await page.getByRole('button', { name: 'Continue' }).click({ timeout: 15_000 });
  const tRec = Date.now();
  const all = await bounded(
    Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/recommend') && r.request().method() === 'POST', { timeout: 40_000 }),
      page.getByRole('button', { name: 'Find my movies' }).click(),
    ]),
    45_000, 'real /api/recommend'
  );
  const recResp = Array.isArray(all[1]) ? all[1][0] : all[1];
  const recStatus = recResp && typeof recResp.status === 'function' ? recResp.status() : null;
  findings.push({ session: 'desktop1366', event: 'recommend-latency-ms', detail: { ms: Date.now() - tRec, status: recStatus, result: all[0] } });
  let cardTexts = null;
  try {
    if (recResp && typeof recResp.json === 'function') {
      const body = await recResp.json();
      findings.push({ session: 'desktop1366', event: 'recommend-body', detail: { movies: (body.movies ?? []).length, notices: body.notices ?? null } });
    }
    await page.locator('article').first().waitFor({ timeout: 30_000 });
    cardTexts = await page.locator('article').evaluateAll((els) => els.map((a) => a.innerText.replace(/\n+/g, ' | ').slice(0, 400)));
    findings.push({ session: 'desktop1366', event: 'cards-metadata', detail: cardTexts });
  } catch (e) { findings.push({ session: 'desktop1366', event: 'cards-metadata', detail: 'missing: ' + String(e?.message ?? e).slice(0, 160) }); }
  await page.screenshot({ path: path.join(pcDir, '01-results.png') });

  // 2) Save / persistence / remove.
  try {
    const saveBtn = page.locator('article').first().getByRole('button', { name: 'Save pick' });
    if (await saveBtn.count()) {
      await saveBtn.click();
      const savedCount = await page.evaluate(() => (JSON.parse(localStorage.getItem('cinematch:saved-picks:v1') || '[]')).length);
      findings.push({ session: 'desktop1366', event: 'save-local', detail: { savedCount } });
      await page.screenshot({ path: path.join(pcDir, '02-saved.png') });
      await page.reload({ waitUntil: 'load' });
      await page.waitForTimeout(1500);
      const persisted = await page.evaluate(() => (JSON.parse(localStorage.getItem('cinematch:saved-picks:v1') || '[]')).length);
      findings.push({ session: 'desktop1366', event: 'save-persisted-after-reload', detail: { persisted } });
      await page.getByRole('button', { name: /Saved Picks/ }).click({ timeout: 15_000 }).catch(() => {});
      await page.screenshot({ path: path.join(pcDir, '03-saved-view.png') });
      const unsave = page.getByRole('button', { name: 'Saved', exact: true }).first();
      if (await unsave.count()) {
        await unsave.click({ timeout: 10_000 });
        findings.push({ session: 'desktop1366', event: 'remove-after', detail: { savedCount: await page.evaluate(() => (JSON.parse(localStorage.getItem('cinematch:saved-picks:v1') || '[]')).length) } });
      }
      await page.screenshot({ path: path.join(pcDir, '04-after-remove.png') });
    } else { findings.push({ session: 'desktop1366', event: 'save-local', detail: 'no Save button rendered' }); }
  } catch (e) { findings.push({ session: 'desktop1366', event: 'save-remove', detail: 'err: ' + String(e?.message ?? e).slice(0, 160) }); }

  // 3) Error + retry UX (this-browser-only stub of /api/recommend).
  try {
    await page.goto(BASE, { waitUntil: 'load' });
    await page.evaluate(() => sessionStorage.clear());
    await page.goto(BASE, { waitUntil: 'load' });
    await page.getByRole('button', { name: /Start Full Quiz|Start Quiz/ }).first().click();
    for (let i = 0; i < 7; i++) await page.getByRole('button', { name: 'Continue' }).click({ timeout: 15_000 });
    await page.route('**/api/recommend', (r) => r.abort('failed'));
    await page.getByRole('button', { name: 'Find my movies' }).click({ timeout: 15_000 });
    await bounded(page.getByText(/went wrong/i).first().waitFor({ timeout: 20_000 }), 25_000, 'prod error state shown');
    await page.screenshot({ path: path.join(pcDir, '05-error-state.png') });
    const retryVisible = await page.getByRole('button', { name: /Try again/ }).first().isVisible().catch(() => false);
    findings.push({ session: 'desktop1366', event: 'retry-visible', detail: retryVisible });
    await page.unroute('**/api/recommend');
    await page.getByRole('button', { name: /Try again/ }).first().click({ timeout: 10_000 });
    await bounded(page.getByText(/Tailored Match|No perfect match|went wrong/i).first().waitFor({ timeout: 40_000 }), 45_000, 'prod retry recovery end-state');
    await page.screenshot({ path: path.join(pcDir, '06-after-retry.png') });
  } catch (e) { findings.push({ session: 'desktop1366', event: 'error-retry', detail: 'err: ' + String(e?.message ?? e).slice(0, 160) }); }

  await ctx.close();
}

await browser.close();
writeFileSync(path.join(OUT, 'prod-probe-findings.json'), JSON.stringify(findings, null, 2));
console.log('PROBE DONE; findings entries:', findings.length);
