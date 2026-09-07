import { defineConfig, devices } from '@playwright/test';

// stores.spec.ts hits the real Brønnøysund (data.brreg.no) orgnr lookup — an
// external dependency CI can't rely on. CI sets PW_SKIP_EXTERNAL=1 so it can run
// EVERY other spec by auto-discovery (no hand-maintained allowlist that goes
// stale). Locally, `npx playwright test` still runs everything.
const skipExternal = process.env.PW_SKIP_EXTERNAL === '1';

// Default targets the standard dev server (4321). A worktree/parallel dev
// server can point the suite elsewhere with E2E_BASE_URL (e.g. :4335) without
// touching CI, which leaves it unset.
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:4321';

export default defineConfig({
  testDir: './e2e',
  testIgnore: ['**/._*', ...(skipExternal ? ['**/stores.spec.ts'] : [])],
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
