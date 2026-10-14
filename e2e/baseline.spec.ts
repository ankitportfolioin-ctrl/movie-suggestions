import { test, expect } from '@playwright/test';

// Visual-regression baselines for key screens (future changes caught by diff).
test('baselines: landing, q1, results', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/');
  await page.evaluate(() => sessionStorage.clear());
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Movie Night/i })).toBeVisible();
  await expect(page).toHaveScreenshot('baseline-landing.png', { timeout: 30000 });
  await page.getByRole('button', { name: /Start Full Quiz|Start Tonight's Match/ }).click();
  await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible();
  await expect(page).toHaveScreenshot('baseline-q1.png', { timeout: 30000 });
});
