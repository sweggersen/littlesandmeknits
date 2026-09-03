import { defineConfig, devices } from '@playwright/test';

// stores.spec.ts hits the real Brønnøysund (data.brreg.no) orgnr lookup — an
// external dependency CI can't rely on. CI sets PW_SKIP_EXTERNAL=1 so it can run
// EVERY other spec by auto-discovery (no hand-maintained allowlist that goes
// stale). Locally, `npx playwright test` still runs everything.
const skipExternal = process.env.PW_SKIP_EXTERNAL === '1';

export default defineConfig({
  testDir: './e2e',
  testIgnore: ['**/._*', ...(skipExternal ? ['**/stores.spec.ts'] : [])],
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4321',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:4321',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
