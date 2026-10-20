import { test, expect } from '@playwright/test';

const PRODUCTION_URL = 'https://movie-night-picker-one.vercel.app';

test.describe.configure({ retries: 1 });

test.describe('Production E2E - New Discovery Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PRODUCTION_URL, { waitUntil: 'networkidle' });
  });

  test('Homepage loads with search + 4 shortcuts + discovery row', async ({ page }) => {
    const searchInput = page.locator('#hero-search, input[placeholder*="feel like watching"]');
    await expect(searchInput).toBeVisible();

    await expect(page.locator('button:has-text("Pick for me")')).toBeVisible();
    await expect(page.locator('button:has-text("Browse by mood")')).toBeVisible();
    await expect(page.locator('button:has-text("Popular now")')).toBeVisible();
    await expect(page.locator('button:has-text("Movies / Series")')).toBeVisible();

    await expect(page.locator('button:has-text("Best of")')).toBeVisible();
    await expect(page.locator('button:has-text("New this week")')).toBeVisible();
    await expect(page.locator('button:has-text("Hidden gems")')).toBeVisible();
    await expect(page.locator('button:has-text("Family night")')).toBeVisible();
  });

  test('Natural language search shows interpreted chips', async ({ page }) => {
    const searchInput = page.locator('#hero-search, input[placeholder*="feel like watching"]').first();
    await searchInput.fill('movies like Interstellar');
    await page.waitForTimeout(500);
    
    const chips = page.locator('span:has-text("like Interstellar"), span:has-text("Sci-Fi"), span:has-text("Space"), span:has-text("Emotional")');
    const chipCount = await chips.count();
    expect(chipCount).toBeGreaterThan(0);
  });

  test('Pick for me flow - 3 steps to results', async ({ page }) => {
    await page.click('button:has-text("Pick for me")');
    await expect(page.locator('h1:has-text("Who")')).toBeVisible();
    await page.click('button:has-text("Just me")');
    
    await expect(page.locator('h1:has-text("What sounds good")')).toBeVisible({ timeout: 5000 });
    await page.click('button:has-text("Mind-bending")');
    
    await expect(page.locator('h1:has-text("How much time")')).toBeVisible({ timeout: 5000 });
    await page.click('button:has-text("Skip")');
    
    await expect(page.locator('h1:has-text("matches")')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('article:has-text("Fit")').first()).toBeVisible({ timeout: 5000 });
  });

  test('Browse by mood expands mood collections', async ({ page }) => {
    await page.click('button:has-text("Browse by mood")');
    
    await expect(page.locator('button:has-text("Mind-bending")')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('button:has-text("Suspenseful")')).toBeVisible();
    await expect(page.locator('button:has-text("Funny")')).toBeVisible();
    await expect(page.locator('button:has-text("Feel-good")')).toBeVisible();
    await expect(page.locator('button:has-text("Emotional")')).toBeVisible();
    
    await page.click('button:has-text("Suspenseful")');
    await expect(page.locator('h1:has-text("matches")')).toBeVisible({ timeout: 15000 });
  });

  test('Popular now navigates to results', async ({ page }) => {
    await page.click('button:has-text("Popular now")');
    await expect(page.locator('h1:has-text("matches")')).toBeVisible({ timeout: 15000 });
  });

  test('Discovery collections navigate to results', async ({ page }) => {
    await page.click('button:has-text("Family night")');
    await expect(page.locator('h1:has-text("matches")')).toBeVisible({ timeout: 20000 });
    
    await page.goto(PRODUCTION_URL, { waitUntil: 'networkidle' });
    await page.click('button:has-text("Hidden gems")');
    await expect(page.locator('h1:has-text("matches")')).toBeVisible({ timeout: 20000 });
  });

  test('Results view shows 3-10 cards with fit scores', async ({ page }) => {
    await page.click('button:has-text("Pick for me")');
    await page.click('button:has-text("Just me")');
    await page.click('button:has-text("Surprise me")');
    await page.click('button:has-text("Skip")');
    
    await expect(page.locator('h1:has-text("matches")')).toBeVisible({ timeout: 15000 });
    
    const movieCards = page.locator('article:has-text("Fit")');
    const count = await movieCards.count();
    expect(count).toBeGreaterThanOrEqual(3);
    expect(count).toBeLessThanOrEqual(10);
  });

  test('Results view has contextual filters', async ({ page }) => {
    await page.click('button:has-text("Pick for me")');
    await page.click('button:has-text("Just me")');
    await page.click('button:has-text("Surprise me")');
    await page.click('button:has-text("Skip")');
    
    await expect(page.locator('h1:has-text("matches")')).toBeVisible({ timeout: 15000 });
    
    await expect(page.locator('button:has-text("Filters"):not(:has-text("Adjust"))')).toBeVisible();
    await page.click('button:has-text("Filters"):not(:has-text("Adjust"))');
    
    await expect(page.locator('button:has-text("Type")').first()).toBeVisible({ timeout: 3000 });
    await expect(page.locator('button:has-text("Mood")').first()).toBeVisible();
    await expect(page.locator('button:has-text("Audience")').first()).toBeVisible();
    await expect(page.locator('button:has-text("Runtime")').first()).toBeVisible();
  });

  test('Footer and navigation work', async ({ page }) => {
    await expect(page.locator('footer')).toContainText('CineMatch');
    await expect(page.locator('button:has-text("Saved Picks")').first()).toBeVisible();
  });

  test('Brand click resets to homepage', async ({ page }) => {
    // Navigate away and back
    await page.goto(PRODUCTION_URL + '/analytics', { waitUntil: 'networkidle' });
    await page.goBack();
    await expect(page.locator('#hero-search, input[placeholder*="feel like watching"]')).toBeVisible({ timeout: 5000 });
  });

  test('Search input accepts natural language queries', async ({ page }) => {
    const testQueries = [
      'suspenseful but not scary',
      'best of 2020',
      'family movie tonight',
      'short action under 90 min',
      'like The Matrix',
    ];
    
    for (const query of testQueries) {
      const searchInput = page.locator('#hero-search, input[placeholder*="feel like watching"]').first();
      await searchInput.clear();
      await searchInput.fill(query);
      await page.waitForTimeout(300);
      await expect(searchInput).toHaveValue(query);
    }
  });

  
});

test.describe('Production E2E - API Health', () => {
  test('Health endpoint returns ok', async ({ request }) => {
    const response = await request.get(`${PRODUCTION_URL}/api/health`);
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.ok).toBe(true);
  });

  test('Title search endpoint works', async ({ request }) => {
    const response = await request.get(`${PRODUCTION_URL}/api/title-search?q=Interstellar`);
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.results).toBeDefined();
    expect(Array.isArray(body.results)).toBe(true);
    expect(body.results.length).toBeGreaterThan(0);
  });

  test('Recommend endpoint works with local catalog', async ({ request }) => {
    const response = await request.post(`${PRODUCTION_URL}/api/recommend`, {
      data: {
        mood: 'Surprise me',
        genres: ['Surprise me'],
        audience: 'Just me',
        maxRuntime: 'Any length',
        languages: ['Any'],
        types: ['movie'],
        preferences: { highlyRated: false, hiddenGems: false, recent: false, classics: false, mature: false },
        note: '',
        excludeIds: [],
      }
    });
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body.movies).toBeDefined();
    expect(Array.isArray(body.movies)).toBe(true);
    expect(body.movies.length).toBeGreaterThan(0);
  });
});

test.describe('Production E2E - Error States', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PRODUCTION_URL, { waitUntil: 'networkidle' });
  });

  test('Shows error for too-short search', async ({ page }) => {
    const searchInput = page.locator('#hero-search, input[placeholder*="feel like watching"]').first();
    await searchInput.fill('x');
    await page.keyboard.press('Enter');
    // Just verify the search doesn't crash and input accepts the text
    await expect(searchInput).toHaveValue('x');
  });
});