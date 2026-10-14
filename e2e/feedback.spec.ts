import { test, expect, Page } from '@playwright/test';
import { recordFlow, assertClean, completeQuizToResults, shotName } from './helpers';

interface CapturedEvent {
  action: string;
  status: number;
  ok: boolean;
  duplicate: boolean;
  hasToken: boolean;
}

function watchEvents(page: Page): CapturedEvent[] {
  const out: CapturedEvent[] = [];
  page.on('response', async (res) => {
    if (!res.url().includes('/api/event') || res.request().method() !== 'POST') return;
    let body: { action?: unknown } = {};
    try {
      body = res.request().postDataJSON() ?? {};
    } catch {
      body = {};
    }
    let json: { ok?: unknown; duplicate?: unknown } = {};
    try {
      json = await res.json();
    } catch {
      json = {};
    }
    out.push({
      action: typeof body.action === 'string' ? body.action : '?',
      status: res.status(),
      ok: json.ok === true,
      duplicate: json.duplicate === true,
      hasToken:
        typeof (body as { token?: unknown }).token === 'string' &&
        ((body as { token: string }).token?.length ?? 0) > 32,
    });
  });
  return out;
}

/** Click, then wait for exactly the events it should produce. */
async function clickExpectEvents(
  page: Page,
  captured: CapturedEvent[],
  click: () => Promise<void>,
  expectedActions: string[],
) {
  const before = captured.length;
  await Promise.all([
    page
      .waitForResponse(
        (r) => r.url().includes('/api/event') && r.request().method() === 'POST',
        { timeout: 15000 },
      )
      .catch(() => null),
    click(),
  ]);
  await page.waitForTimeout(800);
  const fresh = captured.slice(before);
  expect(fresh.map((e) => e.action).sort()).toEqual([...expectedActions].sort());
  for (const e of fresh) {
    // Server 200 + ok:true proves the HMAC token verified.
    expect(e.status).toBe(200);
    expect(e.ok).toBe(true);
    expect(e.duplicate).toBe(false);
    expect(e.hasToken).toBe(true);
  }
}

test('feedback: every card action sends exactly one valid event', async ({ page }) => {
  test.setTimeout(180_000);
  const art = recordFlow(page);
  const captured = watchEvents(page);
  const resp = await completeQuizToResults(page);
  expect(resp.ok()).toBeTruthy();
  await expect(page.locator('article').first()).toBeVisible();

  // Card 1: Not for me (excludes from future picks, no refetch).
  await clickExpectEvents(page, captured, () =>
    page.locator('article').nth(0).getByRole('button', { name: 'Not for me' }).click().then(() => {}),
    ['not_for_me'],
  );
  // Card 2: Seen it.
  await clickExpectEvents(page, captured, () =>
    page.locator('article').nth(1).getByRole('button', { name: 'Seen it' }).click().then(() => {}),
    ['seen_it'],
  );
  // Card 3: Save pick.
  await clickExpectEvents(page, captured, () =>
    page.locator('article').nth(2).getByRole('button', { name: 'Save pick' }).click().then(() => {}),
    ['save'],
  );
  // Card 3: Watch options (opens a popup; event fires regardless).
  {
    const before = captured.length;
    const [popup] = await Promise.all([
      page.waitForEvent('popup').catch(() => null),
      page.locator('article').nth(2).getByRole('button', { name: 'Watch options' }).click(),
    ]);
    await page.waitForTimeout(800);
    if (popup) await popup.close().catch(() => {});
    const fresh = captured.slice(before);
    expect(fresh.map((e) => e.action)).toEqual(['provider_click']);
    expect(fresh[0].status).toBe(200);
    expect(fresh[0].ok).toBe(true);
  }
  // Card 3: More like this (refetches with seeded genres).
  {
    const before = captured.length;
    await Promise.all([
      page
        .waitForResponse(
          (r) => r.url().includes('/api/recommend') && r.request().method() === 'POST',
          { timeout: 30000 },
        )
        .catch(() => null),
      page.locator('article').nth(2).getByRole('button', { name: 'More like this' }).click(),
    ]);
    await page.waitForTimeout(800);
    const fresh = captured.slice(before);
    expect(fresh.map((e) => e.action)).toEqual(['more_like_this']);
    expect(fresh[0].status).toBe(200);
    expect(fresh[0].ok).toBe(true);
  }
  // Page-level: Cycle 3 Alternates = one different_picks per shown pick.
  {
    const nCards = await page.locator('article').count();
    const before = captured.length;
    await Promise.all([
      page
        .waitForResponse(
          (r) => r.url().includes('/api/recommend') && r.request().method() === 'POST',
          { timeout: 30000 },
        )
        .catch(() => null),
      page.getByRole('button', { name: 'Cycle 3 Alternates' }).click(),
    ]);
    await page.waitForTimeout(800);
    const fresh = captured.slice(before);
    expect(fresh.map((e) => e.action)).toEqual(Array(nCards).fill('different_picks'));
    for (const e of fresh) {
      expect(e.status).toBe(200);
      expect(e.ok).toBe(true);
    }
  }

  // Privacy note + reset control are visible.
  await expect(page.getByText(/anonymous preferences on your device/i)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reset my taste' })).toBeVisible();

  // Screenshots at both sizes.
  await page.screenshot({ path: shotName('1366x768', 'feedback', 'results') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  await page.locator('article').first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: shotName('390x844', 'feedback', 'results') });

  assertClean(art, [/favicon/i, /image\.tmdb\.org/i, /google\.com/i], [/image\.tmdb\.org/i]);
});
