import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Registers the jest-dom matchers for every test file. Component tests choose jsdom with a
    // `// @vitest-environment jsdom` docblock; the default environment stays node.
    setupFiles: ['tests/setup/testing-library.ts'],
    include: [
      'packages/*/src/**/*.test.{ts,tsx}',
      'apps/*/src/**/*.test.{ts,tsx}',
      'tests/**/*.test.ts',
    ],
  },
});
