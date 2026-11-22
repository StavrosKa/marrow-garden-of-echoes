import { defineConfig, devices } from '@playwright/test';

const port = 5173;
const productionPort = 4173;

export default defineConfig({
  testDir: 'tests/e2e',
  reporter: 'list',
  use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${port}` },
  webServer: [
    {
      command: 'npm run dev',
      url: `http://localhost:${port}`,
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      // The production build under /garden/, on its own strict port. Reuse is off, so a server already on 4173
      // fails the run rather than being tested by mistake.
      command: 'node tests/e2e/serve-production.mjs',
      url: `http://localhost:${productionPort}/garden/`,
      reuseExistingServer: false,
      timeout: 240_000,
    },
  ],
});