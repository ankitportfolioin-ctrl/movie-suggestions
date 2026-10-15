import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  fullyParallel: false,
  retries: 0,
  reporter: [['line']],
  use: {
    baseURL: 'http://localhost:3101',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 768 } } },
  ],
  webServer: {
    command: 'cross-env PORT=3101 npm run dev',
    url: 'http://localhost:3101',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // Test-only: raise the in-memory rate limit so parallel workers sharing
    // one loopback IP don't 429 each other. Production default (30) unchanged.
    env: { RATE_LIMIT_MAX_REQUESTS: '1000' },
  },
});
