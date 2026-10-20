/**
 * PRODUCTION QA BATTERY — Part 2: Q056–Q100 (remaining 45 cases).
 * Same rules as Part 1: real UI, fresh context per query, sequential, 429-respectful.
 * Appends to the same ledger.jsonl.
 *
 * Explicit command:
 *   RUN_PROD_100=1 npx playwright test e2e/production-relevance-100-part2.spec.ts --workers=1
 */
import { test, BrowserContext } from '@playwright/test';
import { appendFileSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const PROD = 'https://movie-night-picker-one.vercel.app/';
const OUT_DIR = 'reports/production-relevance-evidence-2026-10-19';
const LEDGER = path.join(OUT_DIR, 'ledger.jsonl');
mkdirSync(OUT_DIR, { recursive: true });

const QUERIES = [
  ['Q056', 'Series', "Recommend a fantasy series that has a clear story arc and isn't just endless battles."],
  ['Q057', 'Series', 'Pick a light romantic series for a weekend binge, preferably with short episodes.'],
  ['Q058', 'Series', 'Find a documentary series about food and culture that is enjoyable rather than grim.'],
  ['Q059', 'Series', "Suggest an animated series that adults can enjoy and that isn't aimed only at small children."],
  ['Q060', 'Series', 'Recommend a limited series based on real events, and show how many episodes or seasons if available.'],
  ['Q061', 'Series', 'I want a Korean series with romance and comedy, not a tragic ending.'],
  ['Q062', 'Series', 'Suggest a Japanese anime series with a strong mystery and little fan service.'],
  ['Q063', 'Series', 'Recommend a Hindi-language series for family viewing, with suitability clearly shown or marked unknown.'],
  ['Q064', 'Series', 'Find a Spanish-language crime series that is suspenseful but not extremely graphic.'],
  ['Q065', 'Series', 'Pick an English-language nature documentary series with beautiful cinematography.'],
  ['Q066', 'Series', 'I want a historical drama series with believable characters and a satisfying arc.'],
  ['Q067', 'Series', 'Recommend a workplace comedy series with episodes I can watch in any order.'],
  ['Q068', 'Series', 'Find a sci-fi series with a hopeful tone rather than a bleak dystopia.'],
  ['Q069', 'Series', 'Suggest a series with short seasons and a strong first episode.'],
  ['Q070', 'Series', 'Recommend an older TV series that still feels accessible to a new viewer.'],
  ['Q071', 'Movie', 'I loved Arrival; suggest a more lighthearted movie with thoughtful science-fiction ideas.'],
  ['Q072', 'Movie', 'I enjoyed Knives Out—recommend a similarly clever whodunit, but not a copy.'],
  ['Q073', 'Movie', 'I liked Paddington 2; suggest a warm, funny family movie with the same kindness.'],
  ['Q074', 'Movie', 'I loved Spirited Away; recommend an imaginative animated fantasy with emotional depth.'],
  ['Q075', 'Movie', 'I liked The Martian; suggest a smart, optimistic survival or space movie.'],
  ['Q076', 'Movie', 'I enjoyed Pride and Prejudice; recommend a witty period romance with strong characters.'],
  ['Q077', 'Movie', 'I liked Into the Spider-Verse; suggest inventive animation with bold visual style.'],
  ['Q078', 'Movie', 'I enjoyed The Grand Budapest Hotel; recommend a quirky, stylish comedy with a heartfelt core.'],
  ['Q079', 'Series', 'I liked Ted Lasso; suggest a warm, funny series about a team or community.'],
  ['Q080', 'Series', 'I enjoyed Sherlock; recommend a modern mystery series with clever cases and strong leads.'],
  ['Q081', 'Movie', 'We have two hours, two adults, one teenager, and very different tastes—find a lively compromise.'],
  ['Q082', 'Movie', "I want a suspenseful movie for tonight, but I'm sensitive to violence and need the rating shown."],
  ['Q083', 'Series', 'I have only 30 minutes tonight; suggest one episode-friendly comedy series.'],
  ['Q084', 'Movie', "Recommend something uplifting that still has emotional depth and isn't overly sentimental."],
  ['Q085', 'Movie', 'I want a twisty mystery, but please avoid spoilers in the description or rationale.'],
  ['Q086', 'Movie', "Suggest a serious drama that has moments of humor and isn't more than two hours long."],
  ['Q087', 'Series', 'Find a series I can watch with a partner who dislikes science fiction; keep the recommendation grounded.'],
  ['Q088', 'Movie', 'Recommend an action-comedy with strong reviews, a clear plot, and no graphic gore.'],
  ['Q089', 'Movie', "I'm curious about a foreign-language film, but want something accessible and under two hours."],
  ['Q090', 'Series', 'Suggest a completed series, not one that was cancelled on a cliffhanger.'],
  ['Q091', 'Movie', 'Give me a "surprise me" pick: any genre, but it must be under 100 minutes and well reviewed.'],
  ['Q092', 'Movie', 'I want a horror movie with atmosphere and suspense, but not torture or extreme gore.'],
  ['Q093', 'Movie', 'Recommend a movie that is both relaxing and fast-paced. If those goals conflict, prioritize relaxing.'],
  ['Q094', 'Movie', 'Find a family movie with mature themes but no explicit sex or graphic violence; explain any uncertainty.'],
  ['Q095', 'Movie', 'Suggest a romantic comedy under 90 minutes in Hindi or English.'],
  ['Q096', 'Series', 'I want a one-season mystery series with no more than eight episodes, if that information is available.'],
  ['Q097', 'Movie', 'Recommend a documentary about technology that explains both benefits and risks without being alarmist.'],
  ['Q098', 'Movie', 'I want a movie like The Dark Knight, but less violent and with a more hopeful tone.'],
  ['Q099', 'Series', 'Suggest a Korean or Japanese series with a warm tone, short episodes, and no graphic violence.'],
  ['Q100', 'Movie', "We can't agree on a genre. Pick a broadly appealing movie under two hours and explain why it may work for both of us."],
];

for (const entry of QUERIES) {
  const id = entry[0];
  const q = entry[2];
  if (q.length > 200) throw new Error(`${id} query exceeds the 200-char note field (${q.length})`);
}

type Card = {
  index: number;
  rawText: string;
  title: string | null;
  posterState: string;
  hasWatchLink: boolean;
  watchHrefSample: string | null;
};

type Row = {
  id: string;
  target: 'Movie' | 'Series';
  query: string;
  timestampUTC: string;
  url: string;
  hostOk: boolean;
  httpStatus: number | null;
  recommendElapsedMs: number | null;
  settleElapsedMs: number | null;
  outcome: 'results' | 'empty' | 'error' | 'timeout' | 'blocked' | 'not-run';
  endStateHeading: string | null;
  endStateText: string | null;
  cardCount: number;
  cards: Card[];
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
  http4xx5xx: Array<{ status: number; url: string }>;
  screenshot: string;
  caseStatus: 'PASS' | 'FAIL' | 'BLOCKED' | 'NOT RUN';
  note?: string;
};

async function submitOnce(ctx: BrowserContext, id: string, target: 'Movie' | 'Series', query: string): Promise<{ row: Row; rateLimited: boolean }> {
  const page = await ctx.newPage();
  const row: Row = {
    id, target, query,
    timestampUTC: '', url: '', hostOk: false,
    httpStatus: null, recommendElapsedMs: null, settleElapsedMs: null,
    outcome: 'not-run', endStateHeading: null, endStateText: null,
    cardCount: 0, cards: [],
    consoleErrors: [], pageErrors: [], failedRequests: [], http4xx5xx: [],
    screenshot: path.join(OUT_DIR, `${id}.png`),
    caseStatus: 'NOT RUN',
  };

  try {
    page.on('console', (m) => { if (m.type() === 'error') row.consoleErrors.push(m.text().slice(0, 200)); });
    page.on('pageerror', (e) => row.pageErrors.push(String(e?.message ?? e).slice(0, 200)));
    page.on('requestfailed', (r) => row.failedRequests.push(`${r.method()} ${r.url().slice(0, 140)} ${r.failure()?.errorText ?? ''}`));
    page.on('response', (r) => { if (r.status() >= 400) row.http4xx5xx.push({ status: r.status(), url: r.url().slice(0, 140) }); });

    await page.goto(PROD, { waitUntil: 'load', timeout: 60_000 });
    row.url = page.url();
    row.hostOk = new URL(row.url).host === new URL(PROD).host;
    if (!row.hostOk) throw new Error(`navigated off production host: ${row.url}`);

    await page.getByRole('button', { name: /Start Full Quiz|Start Tonight's Match|Start Quiz/ }).first().click({ timeout: 20_000 });
    await page.getByRole('button', { name: target === 'Series' ? /^Series/ : /^Movie/ }).first().click({ timeout: 15_000 });
    for (let i = 0; i < 7; i++) {
      await page.getByRole('button', { name: 'Continue', exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
      await page.getByRole('button', { name: 'Continue', exact: true }).click({ timeout: 15_000 });
    }
    await page.locator('#quiz-user-notes').waitFor({ state: 'visible', timeout: 15_000 });
    await page.locator('#quiz-user-notes').fill(query);

    const t0 = Date.now();
    const rec = page.waitForResponse(
      (r) => r.url().includes('/api/recommend') && r.request().method() === 'POST',
      { timeout: 45_000 },
    );
    await page.getByRole('button', { name: 'Find my movies' }).click({ timeout: 15_000 });
    let resp;
    try {
      resp = await rec;
    } catch {
      row.recommendElapsedMs = Date.now() - t0;
      return { row: { ...row, outcome: 'timeout' }, rateLimited: false };
    }
    row.recommendElapsedMs = Date.now() - t0;
    row.httpStatus = resp.status();
    if (resp.status() === 429) return { row: { ...row, outcome: 'blocked' }, rateLimited: true };

    const tSettle = Date.now();
    const endState = await Promise.race([
      page.locator('article').first().waitFor({ timeout: 30_000 }).then(() => 'cards' as const),
      page.getByRole('heading', { name: /No perfect match/i }).waitFor({ timeout: 30_000 }).then(() => 'empty' as const),
      page.getByRole('heading', { name: /Something went wrong/i }).waitFor({ timeout: 30_000 }).then(() => 'error' as const),
    ]).catch(() => 'unsettled' as const);
    row.settleElapsedMs = Date.now() - tSettle;

    const h1 = page.getByRole('heading', { level: 1 }).first();
    row.endStateHeading = (await h1.textContent().catch(() => null))?.trim() ?? null;
    row.endStateText = (await page.locator('main').innerText().catch(() => ''))?.slice(0, 1200) ?? null;

    if (endState === 'cards') {
      row.outcome = 'results';
      const articles = page.locator('article');
      row.cardCount = await articles.count();
      const n = Math.min(row.cardCount, Math.max(3, row.cardCount));
      for (let i = 0; i < n; i++) {
        const card = articles.nth(i);
        const raw = (await card.innerText().catch(() => '')) || '';
        const img = card.locator('img').first();
        const posterLoaded = (await img.count())
          ? await img.evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0).catch(() => false)
          : false;
        const watch = card.getByRole('link', { name: /Watch options/i }).first();
        const watchHref = (await watch.count()) ? await watch.getAttribute('href').catch(() => null) : null;
        const titleMatch = raw.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? null;
        row.cards.push({
          index: i,
          rawText: raw.slice(0, 600),
          title: titleMatch,
          posterState: (await img.count()) ? (posterLoaded ? 'loaded' : 'broken-or-loading') : 'not displayed',
          hasWatchLink: Boolean(watchHref),
          watchHrefSample: watchHref ? watchHref.slice(0, 120) : null,
        });
      }
    } else if (endState === 'empty') row.outcome = 'empty';
    else if (endState === 'error') row.outcome = 'error';
    else row.outcome = 'timeout';

    await page.screenshot({ path: row.screenshot, fullPage: false }).catch(() => {});
  } catch (e) {
    row.outcome = 'error';
    row.note = `harness/UI error: ${String((e as Error)?.message ?? e).slice(0, 300)}`;
  }

  row.timestampUTC = new Date().toISOString();
  return { row, rateLimited: false };
}

test.describe.configure({ mode: 'serial' });

test('production-relevance-100-part2: Q056–Q100 sequentially', async ({ browser }, testInfo) => {
  if (!process.env.RUN_PROD_100) test.skip(true, 'gated: set RUN_PROD_100=1');
  test.setTimeout(4_000_000); // ~65 min for 45 cases

  let total429Waits = 0;
  let halted = false;
  let haltReason = '';

  for (const entry of QUERIES) {
    const id = entry[0];
    const target = entry[1] as 'Movie' | 'Series';
    const query = entry[2];

    if (halted) {
      const row: Row = {
        id, target, query,
        timestampUTC: new Date().toISOString(),
        url: PROD, hostOk: true,
        httpStatus: null, recommendElapsedMs: null, settleElapsedMs: null,
        outcome: 'not-run', endStateHeading: null, endStateText: null,
        cardCount: 0, cards: [],
        consoleErrors: [], pageErrors: [], failedRequests: [], http4xx5xx: [],
        screenshot: path.join(OUT_DIR, `${id}.png`),
        caseStatus: 'NOT RUN',
        note: `run halted early (${haltReason}); case recorded NOT RUN`,
      };
      appendFileSync(LEDGER, JSON.stringify(row) + '\n');
      testInfo.attach(`${id}-ledger`, { body: JSON.stringify(row, null, 2), contentType: 'application/json' });
      continue;
    }

    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    try {
      let result = await submitOnce(ctx, id, target, query);
      if (result.rateLimited) {
        if (total429Waits < 2) {
          total429Waits++;
          await new Promise((r) => setTimeout(r, 615_000));
          result = await submitOnce(ctx, id, target, query);
        }
        if (result.rateLimited) {
          halted = true;
          haltReason = `${id}: repeated 429 after window wait`;
          result.row.outcome = 'blocked';
          result.row.caseStatus = 'BLOCKED';
          result.row.note = result.row.note ?? '429 persisted after one bounded window wait; run halted to respect the rate limit.';
        }
      }
      if (result.row.outcome === 'timeout') {
        result.row.note = result.row.note ?? 'No /api/recommend response within 45s; captured whatever state the UI settled into.';
      }
      if (result.row.outcome === 'results' && result.row.cardCount > 0 && result.row.hostOk) result.row.caseStatus = 'PASS';
      else if (result.row.outcome === 'blocked') result.row.caseStatus = 'BLOCKED';
      else if (result.row.outcome !== 'not-run') result.row.caseStatus = 'FAIL';

      appendFileSync(LEDGER, JSON.stringify(result.row) + '\n');
      testInfo.attach(`${id}-ledger`, { body: JSON.stringify(result.row, null, 2), contentType: 'application/json' });
    } finally {
      await ctx.close();
    }

    await new Promise((r) => setTimeout(r, 4_000));
  }
});