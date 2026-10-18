import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('axe: landing, q1, results, error', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => sessionStorage.clear());
  await page.goto('/');
  let r = await new AxeBuilder({ page }).analyze();
  console.log('AXE-landing: ' + JSON.stringify(r.violations.map((v) => `${v.impact}/${v.id}/${v.nodes.length}`)));
  await page.getByRole('button', { name: /Start Full Quiz|Start Tonight's Match/ }).click();
  r = await new AxeBuilder({ page }).analyze();
  console.log('AXE-q1: ' + JSON.stringify(r.violations.map((v) => `${v.impact}/${v.id}/${v.nodes.length}`)));
  for (let i = 0; i < 7; i++) await page.getByRole('button', { name: 'Continue' }).click();
  await page.route('**/api/recommend', (route) => route.abort('failed'));
  await page.getByRole('button', { name: 'Find my movies' }).click();
  await expect(page.getByText(/went wrong/i)).toBeVisible({ timeout: 10000 });
  r = await new AxeBuilder({ page }).analyze();
  console.log('AXE-error: ' + JSON.stringify(r.violations.map((v) => `${v.impact}/${v.id}/${v.nodes.length}`)));
  await page.unroute('**/api/recommend');
  const serious = (await new AxeBuilder({ page }).analyze()).violations.filter((v) =>
    ['serious', 'critical'].includes(v.impact || ''),
  );
  expect(`serious-critical: ${JSON.stringify(serious.map((v) => v.id))}`).toBe('serious-critical: []');
});
