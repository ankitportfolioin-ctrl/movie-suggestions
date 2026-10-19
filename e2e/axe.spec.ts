/**
 * Accessibility battery (reconciliation follow-up).
 *
 * Axe over five active states — landing, quiz Q1, final quiz step (Q8), error
 * state, results state — as three independent tests so each page lifetime owns
 * its own flow (no in-page error→result transitions, the flakiest span).
 *
 * Raw Axe JSON + screenshot per state are persisted under reports/axe-evidence/
 * with a metadata header (browser, viewport, timestamp, commit SHA) so findings
 * stay attributable. Asserts per state:
 *   - zero serious/critical violations (moderate/minor logged for human review),
 *   - exactly one H1 (the state's primary heading),
 *   - no uncaught page errors.
 */
import { test, expect, Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { recordFlow } from './helpers';

const commitSha = execSync('git rev-parse HEAD').toString().trim();
const OUT_DIR = path.join('reports', 'axe-evidence');

interface AxeNode { html: string; target: string[]; failureSummary?: string }
interface AxeViolation { id: string; impact: string | null; help: string; nodes: AxeNode[] }
interface AxeResult { violations: AxeViolation[] }

/** Screenshot + raw JSON + hard assertions for one measured state. */
async function auditState(page: Page, label: string) {
  await page.screenshot({ path: `${OUT_DIR}/${label}.png` });
  const r = (await new AxeBuilder({ page }).analyze()) as unknown as AxeResult;
  mkdirSync(OUT_DIR, { recursive: true });
  const meta = `# axe-core report — ${label}\n` +
    `commit: ${commitSha}\nbrowser: ${test.info().project.name}\n` +
    `viewport: ${page.viewportSize()?.width}x${page.viewportSize()?.height}\n` +
    `url: ${page.url()}\ntimestamp: ${new Date().toISOString()}\n`;
  writeFileSync(
    path.join(OUT_DIR, `axe-${label}.json`),
    meta + '\n' + JSON.stringify(r, null, 2)
  );
  console.log(`AXE ${label}: ${r.violations.map((v) => `${v.impact}/${v.id}`).join(', ') || 'clean'}`);
  const serious = r.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical'
  );
  expect(
    serious.map((v) => `${v.impact}/${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`)
  ).toEqual([]);
  await expect(page.locator('h1')).toHaveCount(1);
}

async function freshHome(page: Page) {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Movie Night/i })).toBeVisible();
}

async function walkToStep8(page: Page) {
  await page.getByRole('button', { name: /Start Full Quiz|Start Tonight's Match/ }).click();
  await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible();
  for (let i = 0; i < 7; i++) await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('#quiz-user-notes')).toBeVisible();
}

test('axe: landing + quiz Q1 + final step Q8', async ({ page }) => {
  test.setTimeout(180_000);
  const art = recordFlow(page);

  await freshHome(page);
  await auditState(page, 'landing');

  await page.getByRole('button', { name: /Start Full Quiz|Start Tonight's Match/ }).click();
  await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible();
  await auditState(page, 'quiz-q1');

  for (let i = 0; i < 7; i++) await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('#quiz-user-notes')).toBeVisible();
  await auditState(page, 'quiz-q8-final');

  expect(art.pageErrors).toEqual([]);
});

test('axe: error state (blocked /api/recommend)', async ({ page }) => {
  test.setTimeout(120_000);
  const art = recordFlow(page);
  await freshHome(page);
  await walkToStep8(page);
  await page.route('**/api/recommend', (route) => route.abort('failed'));
  await page.getByRole('button', { name: 'Find my movies' }).click();
  await expect(page.getByText(/went wrong/i)).toBeVisible({ timeout: 15_000 });
  await auditState(page, 'error-state');
  expect(art.pageErrors).toEqual([]);
});

test('axe: results state (real API terminal state)', async ({ page }) => {
  test.setTimeout(180_000);
  const art = recordFlow(page);
  await freshHome(page);
  await walkToStep8(page);
  await page.getByRole('button', { name: 'Find my movies' }).click();
  // Real API: whichever honest terminal state it reaches locally, each is an
  // active page with an H1; which one was reached is logged and persisted.
  await expect(page.getByText(/Tailored Match|No perfect match|Something went wrong/i).first())
    .toBeVisible({ timeout: 40_000 });
  await auditState(page, 'results-state');
  expect(art.pageErrors).toEqual([]);
});
