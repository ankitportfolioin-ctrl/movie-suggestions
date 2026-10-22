/**
 * Read-only live test of PRODUCTION (2026-10-21, v2) - not part of the app.
 * Site: https://movie-night-picker-one.vercel.app
 * v2 fixes vs v1: (1) console errors caused by our own client-side beacon blocks
 * are counted separately, not as app errors; (2) hero search in natural mode
 * opens a second search page - Enter is pressed again there; (3) poster audit
 * runs AFTER a settle wait (lazy images); (4) full innerText capture.
 * Analytics beacons (/api/analytics/*, /api/event) are intercepted CLIENT-SIDE,
 * so the probe neither writes prod analytics nor eats the rate-limit budget.
 * Nothing server-side is mutated (no saves/likes/resets).
 * Output: reports/live-evidence-2026-10-21/{steps.json, network.ndjson, *.png}
 */
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync, appendFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const BASE = 'https://movie-night-picker-one.vercel.app';
const OUT = path.join('reports', 'live-evidence-2026-10-22-r4');
mkdirSync(OUT, { recursive: true });
const ndjson = path.join(OUT, 'network.ndjson');
writeFileSync(ndjson, '');
const net = (o) => appendFileSync(ndjson, JSON.stringify({ t: new Date().toISOString(), ...o }) + '\n');

const steps = [];
const apiCalls = { recommend: 0, recommendSearch: 0, search: 0, titleSearch: 0, blockedBeacons: 0 };
const recommendTimings = [];
const record = (name, status, details, screenshot) => {
  steps.push({ name, status, details, screenshot });
  console.log(`[${status.toUpperCase()}] ${name}${screenshot ? ` (shot: ${screenshot})` : ''}`);
  if (typeof details === 'string') console.log('   ' + details);
  else if (details) console.log('   ' + JSON.stringify(details).slice(0, 900));
};
const shot = async (page, name) => {
  const file = `${name}.png`;
  try { await page.screenshot({ path: path.join(OUT, file) }); return file; }
  catch { return null; }
};

function attach(page, counters) {
  page.on('response', async (r) => {
    const url = r.url();
    net({ ev: 'response', status: r.status(), method: r.request().method(), url: url.slice(0, 180) });
    if (url.endsWith('/api/recommend') && r.request().method() === 'POST') {
      counters.recommend++;
      let audience = null, bodMood = null, recent = null, notices = [], firstTypes = [];
      try {
        const b = JSON.parse(r.request().postData());
        audience = b.audience ?? null; bodMood = b.mood ?? null; recent = b.preferences?.recent ?? null;
      } catch {}
      try {
        const j = await r.json();
        notices = Array.isArray(j.notices) ? j.notices : [];
        firstTypes = (j.movies ?? []).slice(0, 10).map((m) => `${m.title}[${m.type ?? '?'}]${m.minAge != null ? ` age=${m.minAge}` : ''}`);
      } catch {}
      respFacts.push({ t: Date.now(), audience, mood: bodMood, recent, notices, firstTypes });
      net({ ev: 'response-facts', audience, mood: bodMood, recent, notices, firstTypes });
      const t = (() => { try { return r.request().timing(); } catch { return null; } })();
      const ttfb = t && t.responseStart && t.responseStart > 0 ? Math.round((t.responseStart - t.startTime) * 1000) : null;
      recommendTimings.push({ status: r.status(), ttfbMs: ttfb });
    } else if (url.endsWith('/api/search-title')) {
      counters.titleSearch++;
    } else if (url.endsWith('/api/search')) {
      counters.search++;
    }
  });
  page.route('**/api/analytics/**', (route) => { counters.blockedBeacons++; return route.abort(); });
  page.route(/\/api\/event$/, (route) => { counters.blockedBeacons++; return route.abort(); });
}

/** Console/pageerror recorder that separates our own blocked-beacon noise. */
function makeErrLog(page, counters) {
  const consoleErrors = []; const consoleWarnings = []; const pageErrors = []; const failedRequests = [];
  page.on('console', (m) => {
    if (m.type() === 'error') {
      const text = m.text();
      // Our route-abort of analytics/event causes benign ERR_FAILED console lines.
      if (text.includes('ERR_FAILED') && counters.blockedBeacons > 0) counters.errorSuppressPool++;
      else consoleErrors.push(text.slice(0, 250));
    } else if (m.type() === 'warning') consoleWarnings.push(m.text().slice(0, 250));
  });
  page.on('pageerror', (e) => pageErrors.push(String(e?.message ?? e).slice(0, 250)));
  page.on('requestfailed', (r) => {
    const url = r.url();
    if (url.includes('/api/analytics/') || url.endsWith('/api/event')) return; // ours
    failedRequests.push(`${r.method()} ${url.slice(0, 160)} :: ${r.failure()?.errorText}`);
  });
  return { consoleErrors, consoleWarnings, pageErrors, failedRequests };
}

/** Full result-card audit, run after the page has settled. */
async function cardAudit(page) {
  const audit = await page.evaluate(() => {
    const arts = [...document.querySelectorAll('article')].slice(0, 10);
    return {
      header: document.querySelector('h1')?.textContent?.trim() ?? '',
      cards: arts.map((el) => {
        const img = el.querySelector('img');
        const title = el.querySelector('h2,h3')?.textContent?.trim()
          ?? el.querySelector('[class*="font-heading text-lg"], [class*="text-base"]')?.textContent?.trim() ?? '';
        const text = el.innerText.replace(/\s+/g, ' ').slice(0, 220);
        const age = text.match(/All ages|1?6\+|18\+|\b\d{1,2}\+|Rating not confirmed/)?.[0] ?? 'none';
        return {
          title: title || (img?.getAttribute('alt') ?? ''),
          alt: img?.getAttribute('alt') ?? null,
          age,
          text,
          img: img ? { src: img.getAttribute('src'), loaded: !!img.complete && img.naturalWidth > 0 } : null,
        };
      }),
    };
  });
  for (const c of audit.cards) {
    ageStats.total++;
    ageStats.labels[c.age] = (ageStats.labels[c.age] ?? 0) + 1;
    if (c.age === 'Rating not confirmed') ageStats.notConfirmed++;
  }
  return audit;
}

const ageStats = { total: 0, notConfirmed: 0, labels: {} };
const respFacts = [];

const browser = await chromium.launch();

// ============================ DESKTOP 1280 ============================
// One shared API counter for the whole run (both contexts).
const counters = { recommend: 0, search: 0, titleSearch: 0, blockedBeacons: 0, errorSuppressPool: 0 };
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errs = makeErrLog(page, counters);
  attach(page, counters);
  const hero = page.locator('#hero-search');
  const settle = async () => {
    await page.waitForTimeout(1500);
    await page.evaluate(async () => {
      for (let y = 0; y <= document.body.scrollHeight; y += 700) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 300)); }
      window.scrollTo(0, 0);
    }).catch(() => {});
    await page.waitForTimeout(2000);
  };

  // ---- S1 home loads clean ----
  const t0 = Date.now();
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 45_000 });
  const homeVisible = await page.getByRole('heading', { name: /Movie Night/i }).isVisible().catch(() => false);
  const homeUsable = await hero.isVisible().catch(() => false);
  const s1 = {
    ok: homeVisible && homeUsable && errs.consoleErrors.length === 0 && errs.pageErrors.length === 0 && errs.failedRequests.length === 0,
    loadMs: Date.now() - t0, consoleErrors: errs.consoleErrors, pageErrors: errs.pageErrors, failedRequests: errs.failedRequests,
  };
  record('S1 home loads (desktop 1280)', s1.ok ? 'pass' : 'fail',
    `heading OK=${homeVisible}, input OK=${homeUsable}, load=${s1.loadMs}ms; consoleErrors=${JSON.stringify(s1.consoleErrors)}; pageErrors=${JSON.stringify(s1.pageErrors)}; failedRequests=${JSON.stringify(s1.failedRequests)}`,
    await shot(page, 's01-home-desktop'));

  // ---- S2 mood tiles (all six) ----
  for (const [idx, mood] of ['Mind-bending', 'Suspenseful', 'Funny', 'Feel-good', 'Emotional', 'Adventurous'].entries()) {
    try {
      await page.goto(BASE, { waitUntil: 'networkidle', timeout: 45_000 });
      const tR = Date.now();
      await page.getByRole('button', { name: 'Browse by mood' }).click({ timeout: 10_000 });
      const [resp] = await Promise.all([
        page.waitForResponse((r) => r.url().endsWith('/api/recommend'), { timeout: 30_000 }),
        page.locator(`button:has-text("${mood}")`).first().click(),
      ]);
      const dur = Date.now() - tR;
      await page.waitForSelector('article', { timeout: 20_000 });
      await settle();
      const audit = await cardAudit(page);
      const broken0 = audit.cards.filter((c) => c.img && !c.img.loaded).length;
      let broken = broken0;
      if (broken0 > 0) { await page.waitForTimeout(3000); const a3 = await cardAudit(page); broken = a3.cards.filter((c) => c.img && !c.img.loaded).length; }
      const hasMeta = audit.cards.every((c) => /\d{4}/.test(c.text) && (/\d+h \d+m|\d+m\b/.test(c.text)));
      const errsSnapshot = errs.consoleErrors.length + errs.pageErrors.length;
      recommendTimings[recommendTimings.length - 1].actionMs = dur;
      const lastFacts = respFacts[respFacts.length - 1];
      const moodMatchesTile = lastFacts?.mood === mood;
      record(`S2 mood tile "${mood}"`, (audit.cards.length >= 3 && broken === 0 && hasMeta && dur < 10_000 && errsSnapshot === 0 && moodMatchesTile) ? 'pass' : 'warn',
        `header="${audit.header}"; cards=${audit.cards.length}; bodyMood="${lastFacts?.mood}" moodMatchesTile=${moodMatchesTile}; meta(year+runtime)=${hasMeta}; brokenPosters(after settle)=${broken}; recommend=${dur}ms; titles10=${JSON.stringify(audit.cards.slice(0, 10).map((c) => c.title))}; respNotices=${JSON.stringify(lastFacts?.notices)}; consoleErrsSoFar=${errsSnapshot}`,
        await shot(page, `s02-mood-${mood.toLowerCase().replace(/[^a-z]/g, '')}`));
    } catch (e) {
      record(`S2 mood tile "${mood}"`, 'fail', String(e?.message ?? e).slice(0, 300), await shot(page, `s02-mood-${mood}-fail`));
    }
  }

  // ---- S2b "Popular now": body must be Surprise me + recent:true ----
  try {
    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 45_000 });
    const tR = Date.now();
    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/api/recommend'), { timeout: 30_000 }),
      page.locator('button:has-text("Popular now")').first().click(),
    ]);
    const dur = Date.now() - tR;
    recommendTimings[recommendTimings.length - 1].actionMs = dur;
    await page.waitForSelector('article', { timeout: 20_000 });
    await settle();
    const audit = await cardAudit(page);
    const broken = audit.cards.filter((c) => c.img && !c.img.loaded).length;
    const f = respFacts[respFacts.length - 1];
    record('S2b "Popular now" (mood Surprise me, recent)',
      (resp.status() === 200 && f?.mood === 'Surprise me' && f?.recent === true && audit.cards.length >= 10 && dur < 10_000 && broken === 0) ? 'pass' : 'warn',
      `status=${resp.status()}; bodyMood="${f?.mood}"; recent=${f?.recent}; cards=${audit.cards.length}; recommend=${dur}ms; titles5=${JSON.stringify(audit.cards.slice(0, 5).map((c) => c.title))}; respNotices=${JSON.stringify(f?.notices)}`,
      await shot(page, 's02b-popular-now'));
  } catch (e) {
    record('S2b "Popular now"', 'fail', String(e?.message ?? e).slice(0, 300), await shot(page, 's02b-popular-now-fail'));
  }

  // ---- S3/S4/S5 searches via hero (natural mode opens a 2nd search page) ----

  async function runSearch(q, label) {
    const waitRec = () => page.waitForResponse((r) =>
      r.url().endsWith('/api/recommend') || r.url().endsWith('/api/search') || r.url().endsWith('/api/search-title'), { timeout: 30_000 });
    try {
      await page.goto(BASE, { waitUntil: 'networkidle', timeout: 45_000 });
      const tS = Date.now();
      await hero.fill(q);
      await page.keyboard.press('Enter');
      let resp = null;
      let dur = 0;
      let leg = 'single-Enter (search page did not appear)';
      try {
        resp = await waitRec();
        dur = Date.now() - tS;
      } catch {
        // Natural mode: Enter opened the dedicated search page - submit there too.
        const naturalInput = page.locator('input[placeholder*="Describe what you want"]');
        if (await naturalInput.isVisible().catch(() => false)) {
          const t2 = Date.now();
          [resp] = await Promise.all([waitRec(), naturalInput.press('Enter')]);
          dur = Date.now() - t2; // real search latency: second Enter -> response
          leg = 'two-leg (first Enter opens dedicated search page, no API call)';
        } else throw new Error('no API response and no search page found');
      }
      recommendTimings[recommendTimings.length - 1].actionMs = dur;
      await page.waitForTimeout(3000);
      const audit = await cardAudit(page).catch((e) => ({ header: `ERR:${String(e).slice(0, 60)}`, cards: [] }));
      await settle();
      const audit2 = await cardAudit(page);
      const broken0 = audit2.cards.filter((c) => c.img && !c.img.loaded).length;
      let broken = broken0;
      if (broken0 > 0) { await page.waitForTimeout(3000); const a3 = await cardAudit(page); broken = a3.cards.filter((c) => c.img && !c.img.loaded).length; }
      const endpoint = resp ? resp.url().slice(BASE.length) : '?';
      const status = resp ? resp.status() : '?';
      // transfer isLive challenge? nothing
      const friendly = /No perfect match|No matches found/i.test(audit2.header) || await page.getByText(/No perfect match|No matches found/i).first().isVisible().catch(() => false);
      const appError = await page.getByText(/went wrong/i).first().isVisible().catch(() => false);
      const lastFacts = respFacts[respFacts.length - 1];
      const state = audit2.cards.length === 0 ? (friendly && !appError ? 'pass' : 'fail') : (audit2.cards.length >= 3 && broken === 0 ? 'pass' : 'warn');
      record(`S3 search "${q}" (${label})`, state,
        `endpoint=${endpoint} status=${status} latency=${dur}ms below10s=${dur < 10000}; leg=${leg}; header="${audit2.header}"; cards=${audit2.cards.length}; respNotices=${JSON.stringify(lastFacts?.notices)}; firstTypes=${JSON.stringify(lastFacts?.firstTypes)}; brokenPosters=${broken}; friendlyEmpty=${friendly}; appError=${appError}; first="${audit2.cards[0]?.age ?? ''} | ${audit2.cards[0]?.text.slice(0, 90)}"`,
        await shot(page, `s03-search-${label}`));
      return { audit: audit2, dur, endpoint };
    } catch (e) {
      record(`S3 search "${q}" (${label})`, 'fail', String(e?.message ?? e).slice(0, 300), await shot(page, `s03-${label}-fail`));
      return { audit: { cards: [] } };
    }
  }

  await runSearch('Inception', 'inception');
  await runSearch('Incepton', 'incepton-misspelled');
  // Check 5 asks for a genre search; genre-flavoured hero query.
  await runSearch('best comedies', 'genre-comedies');

  // ---- S4 gibberish -> friendly empty ----
  try {
    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 45_000 });
    const waitRec = () => page.waitForResponse((r) => r.url().endsWith('/api/recommend'), { timeout: 30_000 });
    await hero.fill('asdfghjkl qwerty');
    await page.keyboard.press('Enter');
    let resp; try { resp = await waitRec(); }
    catch {
      const naturalInput = page.locator('input[placeholder*="Describe what you want"]');
      if (await naturalInput.isVisible().catch(() => false)) {
        [resp] = await Promise.all([waitRec(), naturalInput.press('Enter')]);
      } else throw new Error('no API response and no search page found');
    }
    await page.waitForTimeout(3500);
    const audit = await cardAudit(page);
    await settle();
    const audit2 = await cardAudit(page);
    const appError = await page.getByText(/went wrong/i).first().isVisible().catch(() => false);
    const canMatch = await page.getByText(/couldn't match/i).first().isVisible().catch(() => false);
    const friendly = /No perfect match|No matches found/i.test(audit2.header) || await page.getByText(/No perfect match|No matches found|couldn't find|couldn't match/i).first().isVisible().catch(() => false);
    const lastFacts = respFacts[respFacts.length - 1];
    record("S4 gibberish 'asdfghjkl qwerty' -> couldn't-match notice",
      (!appError && errs.pageErrors.length === 0 && canMatch) ? 'pass' : (appError ? 'fail' : 'warn'),
      `endpoint=${resp.url().slice(BASE.length)} status=${resp.status()}; header="${audit2.header}"; cards=${audit2.cards.length}; cantMatchNotice=${canMatch}; friendlyEmpty=${friendly}; respNotices=${JSON.stringify(lastFacts?.notices)}; appError=${appError}; appConsoleErrors=${JSON.stringify(errs.consoleErrors)}; pageErrors=${JSON.stringify(errs.pageErrors)}`,
      await shot(page, 's04-empty-search'));
  } catch (e) {
    record('S4 gibberish', 'fail', String(e?.message ?? e).slice(0, 250), await shot(page, 's04-empty-fail'));
  }

  // ---- S5 reference search ----
  await runSearch('movies like The Matrix', 'reference-matrix');

  // ---- S9a axe: fresh home ----
  {
    const home2 = await ctx.newPage();
    attach(home2, counters);
    await home2.goto(BASE, { waitUntil: 'networkidle', timeout: 45_000 });
    const r1 = await new AxeBuilder({ page: home2 }).analyze();
    const v1 = r1.violations.filter((v) => ['serious', 'critical'].includes(v.impact));
    record('S9 axe: home', v1.length === 0 ? 'pass' : 'warn',
      `${r1.violations.length} violations (${r1.violations.filter((v) => v.impact || 'minor').map((v) => `${v.impact}/${v.id}(${v.nodes.length})`).join(', ') || 'clean'})`,
      await shot(home2, 's09-axe-home'));
    await home2.close();
  }

  // ---- S6 filters: Type -> Series ----
  try {
    const before = await cardAudit(page);
    const tF = Date.now();
    await page.locator('button:has-text("Filters")').first().click({ timeout: 10_000 });
    await page.waitForTimeout(1200);
    const typeChip = page.locator('button:has-text("Type")').first();
    await typeChip.click({ timeout: 5000 }).catch(() => {}); // may open directly
    await page.waitForTimeout(600);
    let [resp2] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/api/recommend'), { timeout: 30_000 }),
      page.locator('button:has-text("Series")').first().click(),
    ]);
    const filterDur = Date.now() - tF;
    await page.waitForTimeout(3000);
    const after = await cardAudit(page);
    const lastFacts = respFacts[respFacts.length - 1];
    const wrongKind = (lastFacts?.notices ?? []).some((n) => /wrong kind/i.test(n));
    const cardTypesAllSeries = (lastFacts?.firstTypes ?? []).length > 0 && !lastFacts.firstTypes.some((t) => !t.includes('[series]'));
    const changed = before.cards[0]?.title !== after.cards[0]?.title || before.header !== after.header;
    recommendTimings[recommendTimings.length - 1].actionMs = filterDur;
    record('S6 filters: Type -> Series returns series',
      (resp2.status() === 200 && cardTypesAllSeries && !wrongKind && after.cards.length > 0) ? 'pass' : 'warn',
      `sentTypes=[series]; before first="${before.cards[0]?.title}"; after header="${after.header}"; cards=${after.cards.length}; cardTypesAllSeries=${cardTypesAllSeries}; wrongKindNotice=${wrongKind}; respNotices=${JSON.stringify(lastFacts?.notices)}; firstTypes=${JSON.stringify(lastFacts?.firstTypes)}; cardAges=${JSON.stringify(after.cards.map((c) => c.age))}; apply=${filterDur}ms; status=${resp2.status()}`,
      await shot(page, 's06-filter-series'));
  } catch (e) {
    record('S6 filters', 'fail', String(e?.message ?? e).slice(0, 300), await shot(page, 's06-filters-fail'));
  }

  // ---- S9b axe: results page ----
  {
    const r2 = await new AxeBuilder({ page }).analyze();
    const serious = r2.violations.filter((v) => ['serious', 'critical'].includes(v.impact));
    record('S9 axe: results (post-filter page)', serious.length === 0 ? 'pass' : 'warn',
      `${r2.violations.length} violations (${r2.violations.map((v) => `${v.impact}/${v.id}(${v.nodes.length})`).join(', ') || 'clean'})`,
      await shot(page, 's09-axe-results'));
  }

  // ---- S7 audience: Family with kids -> all-ages picks ----
  try {
    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 45_000 });
    const waitRec = () => page.waitForResponse((r) => r.url().endsWith('/api/recommend'), { timeout: 30_000 });
    await page.locator('button:has-text("Pick for me")').first().click({ timeout: 10_000 });
    await page.waitForTimeout(1000);
    await page.locator('button:has-text("Family with kids"), button:has-text("Family / kids")').first().click({ timeout: 10_000 });
    await page.waitForTimeout(800);
    await page.locator('button:has-text("Feel-good")').first().click({ timeout: 10_000 }); // mood step
    await page.waitForTimeout(800);
    const tFam = Date.now();
    const [respf] = await Promise.all([
      waitRec(),
      page.locator('button:has-text("Skip")').first().click({ timeout: 10_000 }), // runtime step
    ]);
    const famDur = Date.now() - tFam;
    recommendTimings[recommendTimings.length - 1].actionMs = famDur;
    await page.waitForSelector('article', { timeout: 20_000 });
    await settle();
    const famAudit = await cardAudit(page);
    const lastFacts = respFacts[respFacts.length - 1];
    const allAges = famAudit.cards.length > 0 && famAudit.cards.every((c) => c.age === 'All ages');
    record('S7 audience "Family with kids" -> all-ages picks',
      (respf.status() === 200 && lastFacts?.audience === 'Family with kids' && allAges && famDur < 10_000) ? 'pass' : 'warn',
      `status=${respf.status()}; bodyAudience="${lastFacts?.audience}"; cards=${famAudit.cards.length}; allAges=${allAges}; cardAges=${JSON.stringify(famAudit.cards.map((c) => c.age))}; recommend=${famDur}ms below10s=${famDur < 10000}; respNotices=${JSON.stringify(lastFacts?.notices)}`,
      await shot(page, 's07-family-kids'));
  } catch (e) {
    record('S7 audience "Family with kids"', 'fail', String(e?.message ?? e).slice(0, 300), await shot(page, 's07-family-fail'));
  }

  record('Desktop console summary',
    errs.consoleErrors.length === 0 && errs.pageErrors.length === 0 && errs.failedRequests.length === 0 ? 'pass' : 'warn',
    `app consoleErrors=${JSON.stringify(errs.consoleErrors)}; warnings=${errs.consoleWarnings.length}; pageErrors=${JSON.stringify(errs.pageErrors)}; failedRequests=${JSON.stringify(errs.failedRequests)}; probe-blocked beacons=${counters.blockedBeacons}`);
  await ctx.close();
}

// ============================ MOBILE 390 ============================
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errs = makeErrLog(page, counters);
  attach(page, counters);

  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 45_000 });
  const homeShot = await shot(page, 's10-home-mobile');
  const tR = Date.now();
  try {
    await page.getByRole('button', { name: 'Browse by mood' }).click({ timeout: 10_000 });
    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/api/recommend'), { timeout: 30_000 }),
      page.locator('button:has-text("Suspenseful")').first().click(),
    ]);
    const dur = Date.now() - tR;
    recommendTimings[recommendTimings.length - 1].actionMs = dur;
    await page.waitForSelector('article', { timeout: 25_000 });
    // force lazy images to load: walk the grid, then return to top
    await page.evaluate(async () => {
      for (let y = 0; y <= document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 350)); }
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(2500);
    const audit = await cardAudit(page);
    const broken = audit.cards.filter((c) => c.img && !c.img.loaded).length;
    record('S10 mobile (390px): mood flow', (audit.cards.length >= 3 && broken === 0 && dur < 10_000) ? 'pass' : 'warn',
      `header="${audit.header}"; cards=${audit.cards.length}; brokenPosters=${broken}; recommend=${dur}ms; appConsoleErrors=${JSON.stringify(errs.consoleErrors)}`,
      await shot(page, 's10-results-mobile'));
  } catch (e) {
    record('S10 mobile mood flow', 'fail', String(e?.message ?? e).slice(0, 250), await shot(page, 's10-mobile-fail'));
  }
  record('Mobile home checks', (errs.consoleErrors.length === 0 && errs.pageErrors.length === 0 && errs.failedRequests.length === 0) ? 'pass' : 'warn',
    `appConsoleErrors=${JSON.stringify(errs.consoleErrors)}; pageErrors=${JSON.stringify(errs.pageErrors)}; failedRequests=${JSON.stringify(errs.failedRequests)}`, homeShot);
  await ctx.close();
}

await browser.close();

console.log(JSON.stringify({ apiCalls: { recommendTotal: counters.recommend, appSearch: counters.search, titleSearch: counters.titleSearch, blockedBeacons: counters.blockedBeacons }, recommendTimings }, null, 2));
writeFileSync(path.join(OUT, 'steps.json'), JSON.stringify({ base: BASE, apiCalls: counters, ageStats, recommendTimings, respFacts, steps }, null, 2));
console.log(`DONE ${steps.length} steps -> ${OUT}`);
