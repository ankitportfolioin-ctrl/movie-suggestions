import { test, expect } from '@playwright/test';
import { recordFlow, assertClean, completeQuizToResults, shotName } from './helpers';

test('smoke: landing loads clean, quiz reaches results', async ({ page }) => {
  const art = recordFlow(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Movie Night/i })).toBeVisible();
  await page.screenshot({ path: shotName('1366x768', 'smoke', 'landing') });
  const resp = await completeQuizToResults(page);
  expect(resp.ok()).toBeTruthy();
  await page.screenshot({ path: shotName('1366x768', 'smoke', 'results') });
  // E5/E6/E11: no console errors, no failed requests, no direct TMDB from browser.
  // TEMPORARY whitelist (D-POSTER-01): posters still load direct from
  // image.tmdb.org — must move behind backend /img route (Phase 5/6).
  assertClean(art, [/favicon/i, /image\.tmdb\.org/i], [/image\.tmdb\.org/i]);
});
