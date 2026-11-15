import { defineConfig, devices } from '@playwright/test';

const port = 5173;

export default defineConfig({
  testDir: 'tests/e2e',
  reporter: 'list',
  use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${port}` },
  webServer: {
    command: 'npm run dev',
    url: `http://localhost:${port}`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});