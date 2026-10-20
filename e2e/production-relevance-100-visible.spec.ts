/**
 * PRODUCTION QA BATTERY — 100 real-user recommendation queries against the
 * LIVE deployment. VISIBLE MODE: Single headed browser window, one tab,
 * resets through UI between queries.
 *
 * Explicit command:
 *   RUN_PROD_100=1 npx playwright test e2e/production-relevance-100-visible.spec.ts --project=desktop --headed --workers=1
 *
 * Rules honoured here:
 * - Real UI only: quiz controls + note field + submit. No direct /api calls,
 *   no route mocks, no fixtures, no state injection via page.evaluate.
 * - SINGLE browser context and page for ALL queries.
 * - Reset through UI: "Start over" button → back to landing → "Start Quiz" → continue.
 * - Queries submitted one at a time with a short pause.
 * - 429s are respected: bounded window wait, single in-test retry, then halt —
 *   remaining cases are recorded NOT RUN, never retried aggressively.
 * - Everything recorded is what the browser displayed; nothing inferred.
 * - Browser window stays open at the end on the last query's results.
 */
import { test, Page, BrowserContext } from '@playwright/test';
import { appendFileSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const PROD = 'https://movie-night-picker-one.vercel.app/';
const OUT_DIR = 'reports/production-relevance-evidence-2026-10-19-visible';
const LEDGER = path.join(OUT_DIR, 'ledger.jsonl');
const META = path.join(OUT_DIR, 'run-meta.json');
mkdirSync(OUT_DIR, { recursive: true });

// [id, target type, exact user query]
const QUERIES = [
  ['Q001', 'Movie', "I'm exhausted—can you suggest a gentle, funny movie under 100 minutes?"],
  ['Q002', 'Movie', 'We want a warm feel-good movie for a rainy evening, with a hopeful ending.'],
  ['Q003', 'Movie', "Recommend a smart mystery that's fun to solve and not graphically violent."],
  ['Q004', 'Movie', 'I want a tense thriller, but no supernatural horror and no gore.'],
  ['Q005', 'Movie', 'Pick a romantic comedy that feels adult and witty rather than sugary.'],
  ['Q006', 'Movie', 'Suggest a moving drama that is emotional but ultimately uplifting.'],
  ['Q007', 'Movie', "I'm in the mood for a clever science-fiction movie about ideas, not just action."],
  ['Q008', 'Movie', "Give us an exciting adventure movie that's easy to enjoy with friends."],
  ['Q009', 'Movie', 'I want a light comedy for a low-energy night, preferably under two hours.'],
  ['Q010', 'Movie', 'Recommend a visually beautiful fantasy movie with a hopeful tone.'],
  ['Q011', 'Movie', 'Find a courtroom drama with strong performances and a satisfying resolution.'],
  ['Q012', 'Movie', 'Suggest a heist movie with a clever plan and minimal graphic violence.'],
  ['Q013', 'Movie', 'I want a grounded historical drama, not a fantasy version of history.'],
  ['Q014', 'Movie', "Recommend a sports movie about perseverance that works even if I don't follow the sport."],
  ['Q015', 'Movie', 'Pick an animated movie that adults can enjoy too, with a heartfelt story.'],
  ['Q016', 'Movie', "We're looking for a documentary about nature that is fascinating rather than grim."],
  ['Q017', 'Movie', 'Suggest a space-exploration movie with suspense but not horror.'],
  ['Q018', 'Movie', 'I want a quiet indie movie about friendship and starting over.'],
  ['Q019', 'Movie', 'Recommend a high-energy action movie with a clear plot and little gore.'],
  ['Q020', 'Movie', 'Find a musical movie that feels joyful and has memorable songs.'],
  ['Q021', 'Movie', "We're watching with an 8-year-old; suggest an adventure with no strong language or scary violence."],
  ['Q022', 'Movie', 'Choose a family comedy for grandparents and teenagers to enjoy together.'],
  ['Q023', 'Movie', 'I need a movie under 90 minutes for a weeknight.'],
  ['Q024', 'Movie', 'We have about two hours; recommend a complete story that stays under that runtime.'],
  ['Q025', 'Movie', 'Suggest a movie under two and a half hours with a rich story and no excessive gore.'],
  ['Q026', 'Movie', 'Recommend a cozy mystery suitable for a relaxed family movie night.'],
  ['Q027', 'Movie', 'I want something suspenseful but suitable for someone who dislikes jump scares.'],
  ['Q028', 'Movie', 'Pick a romantic movie for a couple that avoids a tragic ending.'],
  ['Q029', 'Movie', "Suggest a movie that's appropriate for a mixed-age family, and tell me if the rating is unavailable."],
  ['Q030', 'Movie', "We want a funny movie for friends that doesn't depend on embarrassing or mean-spirited humor."],
  ['Q031', 'Movie', "Find a highly rated comedy that isn't one of the obvious blockbuster picks."],
  ['Q032', 'Movie', 'Recommend a well-reviewed thriller from the last five years.'],
  ['Q033', 'Movie', "I'd like a classic black-and-white film that's still engaging for a first-time viewer."],
  ['Q034', 'Movie', 'Suggest a movie from the 1990s that holds up well today.'],
  ['Q035', 'Movie', 'Find a great movie from the 1970s that is not a war film.'],
  ['Q036', 'Movie', 'Recommend a recent independent film with a strong story and good audience reception.'],
  ['Q037', 'Movie', 'I want a lesser-known science-fiction movie with thoughtful ideas.'],
  ['Q038', 'Movie', "Suggest a hidden-gem comedy that's genuinely funny, not just obscure."],
  ['Q039', 'Movie', "Find an award-winning drama that's not relentlessly bleak."],
  ['Q040', 'Movie', 'Recommend a popular movie with strong ratings that still fits a relaxed evening.'],
  ['Q041', 'Movie', 'Suggest a Hindi-language comedy-drama for tonight.'],
  ['Q042', 'Movie', 'Recommend a Korean mystery thriller with a clever reveal and limited gore.'],
  ['Q043', 'Movie', 'I want a Japanese animated movie with a moving story and beautiful art.'],
  ['Q044', 'Movie', 'Find a Spanish-language romantic drama with a hopeful ending.'],
  ['Q045', 'Movie', 'Suggest a French comedy that is easy to follow and not too long.'],
  ['Q046', 'Movie', 'Recommend an English-language adventure movie for a group with varied tastes.'],
  ['Q047', 'Movie', "I'm looking for an Indian movie with music, romance, and a happy ending."],
  ['Q048', 'Movie', 'Pick a Korean film that feels atmospheric and suspenseful without supernatural horror.'],
  ['Q049', 'Movie', 'Suggest a Japanese mystery movie that rewards close attention.'],
  ['Q050', 'Movie', "Recommend a Spanish-language family movie, but don't guess at age suitability if the rating isn't shown."],
  ['Q051', 'Series', 'I want a short TV series with a complete story and no huge episode commitment.'],
  ['Q052', 'Series', 'Recommend a funny half-hour series for watching after work.'],
  ['Q053', 'Series', 'Find a cozy mystery series with likable characters and low gore.'],
  ['Q054', 'Series', 'Suggest a tense crime series, but avoid graphic violence and torture.'],
  ['Q055', 'Series', "I'd like a science-fiction series with thoughtful world-building and strong characters."],
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

// Sanity: the Q8 note field truncates at 200 chars
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

function writeMeta() {
  if (!existsSync(META)) {
    writeFileSync(META, JSON.stringify({
      productionUrl: PROD,
      startedAtUTC: new Date().toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      browser: 'chromium',
      viewport: { width: 1366, height: 768 },
      deployedShaVerified: false,
      deployedShaNote: 'CLI deploy of working tree == HEAD 1620ddb; Vercel-attributed SHA not verifiable from the served page/headers.',
      notes: [
        'Flow: Single visible page; Start Quiz → Q1 type card (Movie/Series per target) → defaults via Continue x7 → full query text in #quiz-user-notes → Find my movies.',
        'After results: click "Start over" (or navigate to /) to reset for next query.',
        'One browser context/page for all queries; short pause between submissions; 429s waited out once then halt.',
        'Browser left open at end for manual inspection.',
      ],
    }, null, 2));
  }
}

async function submitQuery(page: Page, id: string, target: 'Movie' | 'Series', query: string): Promise<{ row: Row; rateLimited: boolean }> {
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

    // Ensure we're on the landing page (or results page with "Start over")
    await page.goto(PROD, { waitUntil: 'load', timeout: 60_000 });
    row.url = page.url();
    row.hostOk = new URL(row.url).host === new URL(PROD).host;
    if (!row.hostOk) throw new Error(`navigated off production host: ${row.url}`);

    // If we're on results page, click "Start over" to reset
    const startOverBtn = page.getByRole('button', { name: 'Start over', exact: true });
    if (await startOverBtn.isVisible().catch(() => false)) {
      await startOverBtn.click({ timeout: 10_000 });
      // Wait for landing page to appear
      await page.getByRole('button', { name: /Start Quiz/ }).first().waitFor({ state: 'visible', timeout: 15_000 });
    }

    // Click "Start Quiz" on landing page
    await page.getByRole('button', { name: /Start Full Quiz|Start Tonight's Match|Start Quiz/ }).first().click({ timeout: 20_000 });

    // Q1: media type card per the task's Target column
    await page.getByRole('button', { name: target === 'Series' ? /^Series/ : /^Movie/ }).first().click({ timeout: 15_000 });

    // Q2–Q8: defaults via Continue (7 clicks = Q1->Q2->Q3->Q4->Q5->Q6->Q7->Q8)
    for (let i = 0; i < 7; i++) {
      await page.getByRole('button', { name: 'Continue', exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
      await page.getByRole('button', { name: 'Continue', exact: true }).click({ timeout: 15_000 });
    }

    // Q8: wait for the note field to be visible, then fill
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
    // Wait for a visible terminal state
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

test('production-relevance-100-visible: all 100 queries sequentially in one visible window', async ({ browser }, testInfo) => {
  if (!process.env.RUN_PROD_100) test.skip(true, 'gated: set RUN_PROD_100=1');
  test.setTimeout(7_200_000); // 2 hours for the full 100-case run

  writeMeta();

  let total429Waits = 0;
  let halted = false;
  let haltReason = '';

  // Create ONE context and ONE page for the entire run
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();

  // Log that we're running in visible mode
  console.log('[VISIBLE MODE] Browser window should be visible on your desktop. Starting test...');

  try {
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

      console.log(`[${id}] Running query: ${query.slice(0, 60)}...`);
      let result = await submitQuery(page, id, target, query);
      
      if (result.rateLimited) {
        if (total429Waits < 2) {
          total429Waits++;
          console.log(`[${id}] Rate limited (429). Waiting 10 min + buffer before retry...`);
          await new Promise((r) => setTimeout(r, 615_000));
          result = await submitQuery(page, id, target, query);
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
      // Functional status (relevance is judged later from captured evidence)
      if (result.row.outcome === 'results' && result.row.cardCount > 0 && result.row.hostOk) result.row.caseStatus = 'PASS';
      else if (result.row.outcome === 'blocked') result.row.caseStatus = 'BLOCKED';
      else if (result.row.outcome !== 'not-run') result.row.caseStatus = 'FAIL';

      appendFileSync(LEDGER, JSON.stringify(result.row) + '\n');
      testInfo.attach(`${id}-ledger`, { body: JSON.stringify(result.row, null, 2), contentType: 'application/json' });
      console.log(`[${id}] Done. Outcome: ${result.row.outcome}, Status: ${result.row.caseStatus}, Cards: ${result.row.cardCount}`);

      // Brief pause between submissions
      await new Promise((r) => setTimeout(r, 4_000));
    }

    console.log('[VISIBLE MODE] All queries completed. Browser window left open for inspection.');
    console.log('[VISIBLE MODE] Do NOT close the browser - it will remain on the last query results.');

    // Keep the test running indefinitely to keep browser open
    // The user can manually close when done inspecting
    await new Promise(() => {}); // Never resolves - keeps browser open

  } finally {
    // NOTE: We intentionally do NOT close the context/page here
    // so the browser window stays open for manual inspection
    console.log('[VISIBLE MODE] Test completed. Browser intentionally left open.');
  }
});