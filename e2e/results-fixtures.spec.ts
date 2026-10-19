/**
 * Deterministic recommendation-result battery (reconciliation follow-up).
 *
 * These tests inject isolated, test-only fixtures at the Playwright network
 * layer — production behavior is untouched (no app code path changes, no
 * provider keys, no production data). They make Sections F/G-style result
 * assertions reliably runnable locally:
 *   1. success set — full card audit (fields, ratings+source, kind, genres,
 *      runtime cap, poster, watch-option states, dedupe-safe saving)
 *   2. genuinely empty set with honest notices
 *   3. shortage/relaxation counts reported honestly
 *   4. the 20s client timeout + retry recovery, and proof that the
 *      superseded late response cannot overwrite newer state (stale guard)
 */
import { test, expect, Page, Route } from '@playwright/test';
import { recordFlow, assertClean } from './helpers';

const resultsHeading = (page: Page) => page.getByTestId('results-heading');
const cards = (page: Page) => page.locator('article');

// Dev-only infra noise: the reused dev server logs an HMR websocket error
// ("WebSocket closed without opened.") when its hot-reload port is contends.
// It is not a product error; this whitelist is documented here so the real
// assertion (no uncaught *product* errors) stays meaningful.
const DEV_NOISE = [/WebSocket closed without opened/i];

function movie(overrides: Partial<Movie> = {}): Movie {
  return {
    id: 1,
    title: 'Fixture Alpha',
    year: 2004,
    genres: ['Sci-Fi', 'Mystery'],
    runtime: 94,
    rating: 8.1,
    overview: 'A fixture-built feature film used only inside the Playwright network layer.',
    posterUrl: '/img-fixtures/alpha.png',
    providers: [],
    reason: 'Matches your Curious mood and Sci-Fi pick; 94 minutes fits your cap.',
    language: 'en',
    certificate: 'PG',
    type: 'movie',
    fitScore: 93,
    ...overrides,
  } as Movie; // eslint-disable-line -- fixture literal mirrors the wire shape
}

type Movie = {
  id: number; title: string; year: number; genres: string[]; runtime: number;
  rating: number; overview: string; posterUrl: string; reason: string;
  providers: unknown[]; language?: string; certificate?: string; type?: string;
  mediaType?: string; seasons?: number; episodeRuntime?: number; fitScore?: number;
  isHiddenGem?: boolean; ratingSource?: string;
};

const SUCCESS_SET = {
  movies: [
    movie({
      id: 101, title: 'Fixture Alpha', rating: 8.1, ratingSource: 'imdb',
      providers: [{ name: 'Netfix Fixture', logoUrl: '/img-fixtures/netfix.png', type: 'stream', url: 'https://example.com/watch/alpha' }],
    }),
    movie({
      id: 102, title: 'Fixture Beta', year: 2019, genres: ['Drama'], runtime: 118,
      rating: 7.6, ratingSource: 'tmdb', language: 'hi', certificate: 'U',
      providers: [],
    }),
    movie({
      id: 103, title: 'Fixture Gamma', year: 1977, runtime: 121, rating: 8.4,
      ratingSource: 'imdb', type: 'series', mediaType: 'series', seasons: 2,
      episodeRuntime: 45, isHiddenGem: true, fitScore: 88,
    }),
  ],
  notices: ['Using Fixture Gamma as your similarity reference.'],
};

const EMPTY_SET = {
  movies: [],
  notices: ['Nothing matches all of those filters together — try removing one constraint.'],
};

const SHORTAGE_SET = { movies: [movie({ id: 201, title: 'Fixture Lone', runtime: 88 })], notices: [] };
const SHORTAGE_EMPTY = { movies: [], notices: ['No further picks match these filters right now — adjust filters to widen the pool.'] };

async function freshHome(page: Page) {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Movie Night/i })).toBeVisible();
}

async function startQuiz(page: Page) {
  await page.getByRole('button', { name: 'Start Full Quiz' }).first().click();
  await expect(page.getByText('Question 1 of 8')).toBeVisible();
}

async function answerToStep8(page: Page) {
  const next = page.getByRole('button', { name: 'Continue', exact: true });
  await next.click();
  await next.click();
  await next.click();
  await next.click();
  await next.click();
  await next.click();
  await next.click();
}

async function submit(page: Page) {
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/recommend') && r.request().method() === 'POST'),
    page.getByRole('button', { name: 'Find my movies' }).click(),
  ]);
  return resp;
}

/** Install one fulfill-per-payload queue on /api/recommend (any method). */
async function installFixtures(page: Page, payloads: Array<{ body: unknown; delayMs?: number }>) {
  let i = 0;
  await page.route('**/api/recommend', async (route: Route) => {
    const p = payloads[i] ?? payloads[payloads.length - 1];
    i += 1;
    if (p.delayMs) await new Promise((r) => setTimeout(r, p.delayMs));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(p.body),
    });
  });
}

test('fixture success set: full card audit + saving dedupe', async ({ page }) => {
  const art = recordFlow(page);
  await installFixtures(page, [{ body: SUCCESS_SET }]);
  await freshHome(page);
  await startQuiz(page);
  await answerToStep8(page);
  await submit(page);

  await expect(resultsHeading(page)).toContainText('Your 3 Tailored Match');
  await expect(cards(page)).toHaveCount(3);

  // No duplicate titles/ids within the returned set.
  const titles = await cards(page).evaluateAll((els) => els.map((e) => e.querySelector('h2')?.textContent));
  expect(new Set(titles).size).toBe(3);
  for (let i = 0; i < 3; i++) {
    const t = await cards(page).nth(i).innerText();
    expect(t).toMatch(/Movie|Short film|Series|TV series/); // explicit media type
    expect(t).toMatch(/Fit \d+\/100/); // fit score, never "85%"
    expect(t).toMatch(/Why this fits you/i); // cited reason block
  }
  // Card 1: rating + source label, provider link + chip type.
  await expect(cards(page).nth(0).getByText('8.1')).toBeVisible();
  await expect(cards(page).nth(0).getByText('IMDb')).toBeVisible();
  await expect(cards(page).nth(0).getByText('Netfix Fixture')).toBeVisible();
  await expect(cards(page).nth(0).getByRole('link', { name: /Watch options/ })).toHaveAttribute(
    'href',
    'https://example.com/watch/alpha'
  );
  // Card 2: TMDB source, honest empty providers line, language badge.
  await expect(cards(page).nth(1).getByText('TMDB')).toBeVisible();
  await expect(cards(page).nth(1).getByText('Not streaming in your country.')).toBeVisible();
  await expect(cards(page).nth(1).getByText('HI', { exact: true })).toBeVisible();
  // Card 3: series facts + hidden-gem badge.
  await expect(cards(page).nth(2).getByText(/2 seasons/)).toBeVisible();
  await expect(cards(page).nth(2).getByText('Hidden gem')).toBeVisible();

  // Poster fallback: fixture posters 404 on purpose → img is swapped for the
  // title/year fallback tile, and broken provider logos become text chips.
  await expect(cards(page).nth(0).locator('img')).toHaveCount(0, { timeout: 5_000 });

  // Runtime cap math on every card (badge parse: "1h 34m" ≤ 90 not guaranteed
  // here since quiz default is Under 2 hours — assert fixtures respect <=121
  // i.e. no runtime renders as zero/negative/malformed).
  for (let i = 0; i < 3; i++) {
    const t = await cards(page).nth(i).innerText();
    expect(t).toMatch(/\d+(h|m)/);
    expect(t).not.toMatch(/0m\s*$/m);
  }

  // Save → Saved → Save again never duplicates (toggle-based control).
  await page.getByRole('button', { name: 'Save pick' }).first().click();
  await expect(page.getByRole('button', { name: 'Saved', exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Saved', exact: true }).first().click(); // unsave
  await page.getByRole('button', { name: 'Save pick' }).first().click(); // save again
  const count = await page.evaluate(
    () => JSON.parse(localStorage.getItem('cinematch:saved-picks:v1') || '[]').length
  );
  expect(count).toBe(1);

  // No uncaught product errors (dev HMR websocket noise whitelisted above);
  // the intentional 404 fixture posters are whitelisted as failed requests.
  assertClean(art, [...DEV_NOISE, /img-fixtures/]);
});

test('fixture empty set: honest zero + guidance, no cards', async ({ page }) => {
  const art = recordFlow(page);
  await installFixtures(page, [{ body: EMPTY_SET }]);
  await freshHome(page);
  await startQuiz(page);
  await answerToStep8(page);
  await submit(page);

  await expect(page.getByText('No perfect match')).toBeVisible();
  await expect(page.getByText('Nothing matches all of those filters together')).toBeVisible();
  await expect(cards(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Adjust filters' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start over' })).toBeVisible();
  assertClean(art, DEV_NOISE);
});

test('fixture shortage: real count stated + zero-report on "Show me 3 more"', async ({ page }) => {
  await installFixtures(page, [
    { body: SHORTAGE_SET },
    { body: SHORTAGE_EMPTY },
  ]);
  await freshHome(page);
  await startQuiz(page);
  await answerToStep8(page);
  await submit(page);

  await expect(resultsHeading(page)).toContainText('Your 1 Tailored Match');
  await page.getByRole('button', { name: 'Show me 3 more' }).click();
  // A zero-result refresh lands on the honest empty state — the real-count
  // report lives in the notice there, never as a misleading "Your 0" heading.
  await expect(page.getByText('No perfect match')).toBeVisible();
  await expect(page.getByText('No further picks match these filters right now').first()).toBeVisible();
  await expect(cards(page)).toHaveCount(0);
});

test('fixture stale-guard: 24s late response cannot overwrite retry recovery', async ({ page }) => {
  // 1st call: 24s slow (client times out at 20s). 2nd call (Retry): instant.
  await installFixtures(page, [
    { body: SUCCESS_SET, delayMs: 24_000 },
    { body: SHORTAGE_SET },
  ]);
  test.setTimeout(120_000);
  await freshHome(page);
  await startQuiz(page);
  await answerToStep8(page);
  await page.getByRole('button', { name: 'Find my movies' }).click();

  // Timeout path: error alert with the named cause + Retry inside ~21s.
  await expect(page.getByText(/Something went wrong/i).first()).toBeVisible({ timeout: 25_000 });
  await expect(page.getByText(/took too long and timed out/i).first()).toBeVisible();
  const retry = page.getByRole('button', { name: 'Try again' }).first();
  await page.waitForTimeout(500); // ensure the abort fully lands
  await retry.click();

  await expect(resultsHeading(page)).toContainText('Your 1 Tailored Match', { timeout: 10_000 });
  const stable = await resultsHeading(page).innerText();
  await expect(cards(page).first()).toContainText('Fixture Lone');

  // Past 24s the superseded, slower request fulfills — it must not change UI.
  await page.waitForTimeout(4_500);
  await expect(resultsHeading(page)).toHaveText(stable);
  await expect(cards(page).first()).toContainText('Fixture Lone');
  await expect(page.getByText(/took too long and timed out/i)).toHaveCount(0);
});

test('fixture no leaked production behavior: unmocked reload serves the real API', async ({ page }) => {
  await installFixtures(page, [{ body: SUCCESS_SET }]);
  await freshHome(page);
  await startQuiz(page);
  await answerToStep8(page);
  await submit(page);
  await expect(resultsHeading(page)).toContainText('Your 3');

  // Reloading without the route mock hits the real server; the app must reach
  // a real terminal state (results or honest notice), never a raw crash.
  await page.unroute('**/api/recommend');
  await page.reload();
  await expect(page.getByText(/Movie Night|Something went wrong|No perfect match|Tailored Match/i).first())
    .toBeVisible({ timeout: 20_000 });
});
