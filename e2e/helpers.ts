import { Page, expect } from '@playwright/test';

export interface FlowArtifacts {
  consoleErrors: string[];
  consoleWarnings: string[];
  pageErrors: string[];
  failedRequests: string[];
  allUrls: string[];
}

/** Attach recorders for E5/E6. Returns artifacts object filled during the test. */
export function recordFlow(page: Page): FlowArtifacts {
  const art: FlowArtifacts = {
    consoleErrors: [],
    consoleWarnings: [],
    pageErrors: [],
    failedRequests: [],
    allUrls: [],
  };
  page.on('console', (msg) => {
    const type = msg.type();
    const text = `[${type}] ${msg.text()}`;
    if (type === 'error') art.consoleErrors.push(text);
    else if (type === 'warning') art.consoleWarnings.push(text);
  });
  page.on('pageerror', (err) => art.pageErrors.push(String(err?.message ?? err)));
  page.on('requestfailed', (req) => {
    art.failedRequests.push(`FAILED ${req.method()} ${req.url()} :: ${req.failure()?.errorText}`);
  });
  page.on('response', (res) => {
    art.allUrls.push(`${res.status()} ${res.request().method()} ${res.url()}`);
    if (res.status() >= 400) {
      art.failedRequests.push(`${res.status()} ${res.request().method()} ${res.url()}`);
    }
  });
  return art;
}

const THIRD_PARTY_HOSTS = ['api.themoviedb.org', 'image.tmdb.org', 'api.themoviedb', 'tmdb.org'];

export function thirdPartyCalls(allUrls: string[]): string[] {
  return allUrls.filter((u) =>
    THIRD_PARTY_HOSTS.some((h) => u.includes(h)),
  );
}

/** Fail on any console error / pageerror / failed request not explicitly whitelisted. */
export function assertClean(
  art: FlowArtifacts,
  whitelist: RegExp[] = [],
  thirdPartyWhitelist: RegExp[] = [],
) {
  const unlisted = (items: string[]) => items.filter((t) => !whitelist.some((w) => w.test(t)));
  const ce = unlisted(art.consoleErrors);
  const pe = unlisted(art.pageErrors);
  const fr = unlisted(art.failedRequests);
  const tp = thirdPartyCalls(art.allUrls).filter(
    (t) => !thirdPartyWhitelist.some((w) => w.test(t)),
  );
  expect(`consoleErrors: ${JSON.stringify(ce)}`).toBe('consoleErrors: []');
  expect(`pageErrors: ${JSON.stringify(pe)}`).toBe('pageErrors: []');
  expect(`failedRequests: ${JSON.stringify(fr)}`).toBe('failedRequests: []');
  expect(`thirdPartyDirect: ${JSON.stringify(tp)}`).toBe('thirdPartyDirect: []');
}

/** Walk the full quiz to results with defaults, returning recommend response. */
export async function completeQuizToResults(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /Start Tonight's Match|Start Quiz/ }).first().click();
  // Q1..Q6: keep defaults, click Continue 6 times
  for (let i = 0; i < 6; i++) {
    await page.getByRole('button', { name: 'Continue' }).click();
  }
  // Q7: submit
  const [resp] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/api/recommend') && r.request().method() === 'POST',
    ),
    page.getByRole('button', { name: 'Find my movies' }).click(),
  ]);
  await page.waitForTimeout(500);
  return resp;
}

export function shotName(viewport: string, flow: string, step: string) {
  return `release-report/screens/${viewport}-${flow}-${step}.png`;
}
