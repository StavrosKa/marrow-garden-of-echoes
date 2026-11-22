// Builds the garden app under the base path /garden/ and serves the build with `vite preview` on port 4173 (Req 26.2).
// Playwright starts this script as its own web server. The port is strict, so a port that is already taken fails the
// run instead of moving the server to another port. Playwright stops the process when the run ends.
import { fileURLToPath } from 'node:url';
import { build, preview } from 'vite';

const PORT = 4173;
const BASE = '/garden/';
const root = fileURLToPath(new URL('../../apps/garden-of-echoes', import.meta.url));

// The app's vite.config.ts reads BASE_PATH; the explicit base below is the same value.
process.env.BASE_PATH = BASE;

await build({ root, base: BASE, logLevel: 'warn' });
await preview({
  root,
  base: BASE,
  logLevel: 'warn',
  preview: { port: PORT, strictPort: true },
});
console.log(`garden build served at http://localhost:${PORT}${BASE}`);
