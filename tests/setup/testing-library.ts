// Setup for every test file (vitest.config.ts setupFiles). It adds the jest-dom matchers to
// `expect` and unmounts whatever a component test rendered, so no test sees another's DOM.
// Under the node environment there is no DOM and cleanup does nothing.
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});
