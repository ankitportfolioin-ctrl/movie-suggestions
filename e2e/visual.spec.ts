import { test, expect, Page } from '@playwright/test';
import { recordFlow, shotName } from './helpers';

const VIEWPORTS = [
  { name: '360x740', w: 360, h: 740 },
  { name: '390x844', w: 390, h: 844 },
  { name: '768x1024', w: 768, h: 1024 },
  { name: '1366x768', w: 1366, h: 768 },
  { name: '1920x1080', w: 1920, h: 1080 },
];

const MOODS = ['Happy', 'Relaxed', 'Tired', 'Stressed', 'Romantic', 'Adventurous', 'Curious', 'Sad'];
const AUDIENCES = ['Just me', 'Partner', 'Friends', 'Family with kids'];
const RUNTIMES = ['Under 90 min', 'Under 2 hours', 'Under 2.5 hours', 'Any length'];
const LANGS = ['Any', 'English', 'Hindi', 'Tamil', 'Telugu', 'Korean', 'Japanese', 'Spanish', 'French'];

async function startQuiz(page: Page) {
  await page.goto('/');
  await page.evaluate(() => sessionStorage.clear());
  await page.goto('/');
  await page.getByRole('button', { name: /Start Full Quiz|Start Tonight's Match/ }).click();
  await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible();
}

async function shot(page: Page, vp: string, step: string) {
  await page.screenshot({ path: shotName(vp, 'visual', step) });
  const overflow = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    innerW: window.innerWidth,
    hScroll: document.documentElement.scrollWidth > window.innerWidth + 1,
  }));
  return overflow;
}

test('visual matrix: every state x every viewport', async ({ page }) => {
  const art = recordFlow(page);
  const layoutIssues: string[] = [];
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await page.goto('/');
    await page.evaluate(() => sessionStorage.clear());
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Movie Night/i })).toBeVisible();
    const check = async (step: string) => {
      const o = await shot(page, vp.name, step);
      if (o.hScroll) layoutIssues.push(`${vp.name} ${step} h-scroll ${o.scrollW}>${o.innerW}`);
    };
    await check('landing');
    await page.getByRole('button', { name: /Start Full Quiz|Start Tonight's Match/ }).click();
    await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible();
    await check('q1-type');
    await page.getByRole('button', { name: 'Continue' }).click();
    await check('q2-mood');
    await page.getByRole('button', { name: 'Continue' }).click();
    await check('q3-genre');
    await page.getByRole('button', { name: 'Continue' }).click();
    await check('q4-company');
    await page.getByRole('button', { name: 'Continue' }).click();
    await check('q5-runtime');
    await page.getByRole('button', { name: 'Continue' }).click();
    await check('q6-language');
    await page.getByRole('button', { name: 'Continue' }).click();
    await check('q7-refinements-top');
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await check('q7-refinements-bottom');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByRole('button', { name: 'Continue' }).click();
    await check('q8-note');
    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/recommend')),
      page.getByRole('button', { name: 'Find my movies' }).click(),
    ]);
    expect(resp.ok()).toBeTruthy();
    await expect(page.getByText(/Tailored Match|perfect match|went wrong/i).first()).toBeVisible({
      timeout: 15000,
    });
    await check('results');
  }
  console.log('LAYOUT:' + JSON.stringify(layoutIssues));
  console.log(
    'CONSOLE_ERRORS:' + JSON.stringify(art.consoleErrors) + ' PAGEERRORS:' + JSON.stringify(art.pageErrors),
  );
});

// Full option-by-option walk on laptop viewport (representative deep pass).
test('visual options deep pass (1366x768)', async ({ page }) => {
  const art = recordFlow(page);
  await page.setViewportSize({ width: 1366, height: 768 });
  await startQuiz(page);
  // Q1: each of 4 media types (Series also enables the miniseries runtime)
  for (const t of ['Movie', 'Short film', 'Series', 'Any']) {
    await page.getByRole('button', { name: new RegExp(`^${t}`) }).first().click();
    await page.screenshot({ path: shotName('1366x768', 'visual', `q1-type-${t.toLowerCase().replace(/[^a-z]+/g, '-')}`) });
  }
  await page.getByRole('button', { name: 'Continue' }).click();
  // Q2: each of 8 moods
  for (const m of MOODS) {
    await page.getByRole('button', { name: new RegExp(`^${m}`) }).first().click();
    await page.screenshot({ path: shotName('1366x768', 'visual', `q2-mood-${m.toLowerCase()}`) });
  }
  await page.getByRole('button', { name: 'Continue' }).click();
  // Q3: surprise, 3 genres, attempt 4th
  await page.screenshot({ path: shotName('1366x768', 'visual', 'q3-surprise') });
  for (const g of ['Comedy', 'Drama', 'Sci-Fi']) {
    await page.getByRole('button', { name: new RegExp(`^${g}`) }).click();
  }
  await page.screenshot({ path: shotName('1366x768', 'visual', 'q3-3genres') });
  await page.getByRole('button', { name: /^Horror/ }).click();
  await page.screenshot({ path: shotName('1366x768', 'visual', 'q3-attempt-4th') });
  await page.getByRole('button', { name: 'Continue' }).click();
  // Q4: 4 audiences
  for (const a of AUDIENCES) {
    await page.getByRole('button', { name: new RegExp(a) }).first().click();
    await page.screenshot({
      path: shotName('1366x768', 'visual', `q4-${a.toLowerCase().replace(/[^a-z]+/g, '-')}`),
    });
  }
  await page.getByRole('button', { name: 'Continue' }).click();
  // Q5: 4 runtimes (5 options when Series is in the mix)
  for (const r of RUNTIMES) {
    await page.getByRole('button', { name: new RegExp(r) }).first().click();
    await page.screenshot({
      path: shotName('1366x768', 'visual', `q5-${r.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`),
    });
  }
  await page.getByRole('button', { name: 'Continue' }).click();
  // Q6: 9 languages
  for (const l of LANGS) {
    await page.getByRole('button', { name: new RegExp(`^${l}$`) }).click();
    await page.screenshot({ path: shotName('1366x768', 'visual', `q6-${l.toLowerCase()}`) });
  }
  await page.getByRole('button', { name: 'Continue' }).click();
  // Q7: top, scroll bottom, toggles ON
  await page.screenshot({ path: shotName('1366x768', 'visual', 'q7-top') });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.screenshot({ path: shotName('1366x768', 'visual', 'q7-bottom-off') });
  for (const t of ['Highly rated only', 'Hidden gems', 'Recent \\(last 5 years\\)', 'Classics \\(before 2000\\)']) {
    await page.getByRole('switch', { name: new RegExp(t) }).click();
  }
  await page.screenshot({ path: shotName('1366x768', 'visual', 'q7-bottom-on') });
  // Note: Recent+Classics are mutually exclusive by design (last wins).
  await page.getByRole('button', { name: 'Continue' }).click();
  // Q8 variants
  await page.screenshot({ path: shotName('1366x768', 'visual', 'q8-empty') });
  await page.locator('#quiz-user-notes').fill('a'.repeat(200));
  await page.screenshot({ path: shotName('1366x768', 'visual', 'q8-200chars') });
  await page.locator('#quiz-user-notes').fill('मुझे कोई हल्की-फुल्की कॉमेडी दिखाओ 🎬🍿');
  await page.screenshot({ path: shotName('1366x768', 'visual', 'q8-hindi-emoji') });
  await page.locator('#quiz-user-notes').fill('');
  // Loading state (delay recommend 2s)
  await page.route('**/api/recommend', async (route) => {
    await new Promise((r) => setTimeout(r, 2000));
    await route.continue();
  });
  const findP = page.getByRole('button', { name: 'Find my movies' }).click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: shotName('1366x768', 'visual', 'loading') });
  await findP;
  await expect(page.getByText(/Tailored Match|perfect match|went wrong/i).first()).toBeVisible({
    timeout: 15000,
  });
  await page.screenshot({ path: shotName('1366x768', 'visual', 'results') });
  await page.unroute('**/api/recommend');
  console.log('ERRORS:' + JSON.stringify({ ce: art.consoleErrors, pe: art.pageErrors }));
});

// Error state: block /api/recommend.
test('visual error state (1366x768)', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await startQuiz(page);
  await page.route('**/api/recommend', (route) => route.abort('failed'));
  for (let i = 0; i < 7; i++) await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Find my movies' }).click();
  await expect(page.getByText(/went wrong/i)).toBeVisible({ timeout: 10000 });
  await page.screenshot({ path: shotName('1366x768', 'visual', 'error-blocked-api') });
});

// No-matches attempt with genuinely restrictive real filters.
test('visual no-matches attempt (1366x768)', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await startQuiz(page);
  // Q1 media type: keep the default Movie
  await page.getByRole('button', { name: 'Continue' }).click();
  // Q2 default Relaxed -> Q3 Documentary
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /^Documentary/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /Family with kids/ }).first().click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /^Under 90 min/ }).first().click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: /^Spanish$/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('switch', { name: /Highly rated/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/recommend')),
    page.getByRole('button', { name: 'Find my movies' }).click(),
  ]);
  const body = await resp.json();
  console.log('NOMATCH count=' + (body.movies?.length ?? -1) + ' notices=' + JSON.stringify(body.notices));
  await page.screenshot({ path: shotName('1366x768', 'visual', 'no-matches') });
});
