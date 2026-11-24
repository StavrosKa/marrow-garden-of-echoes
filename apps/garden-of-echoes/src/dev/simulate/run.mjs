// The simulator's script (garden-level design 5.3). It starts Vite's SSR loader for the app and runs cli.ts through it,
// because the packages import each other without file extensions, which Node's type stripping cannot resolve. The app
// root is found from this file's location, so the script works from the repository root (npm run simulate) and from
// the app package (npm run simulate -w garden-of-echoes). Vite is already a dependency, so nothing is added.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const server = await createServer({
  root: appRoot,
  configFile: path.join(appRoot, 'vite.config.ts'),
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false },
});

try {
  const cli = await server.ssrLoadModule('/src/dev/simulate/cli.ts');
  process.exitCode = cli.main(process.argv.slice(2));
} finally {
  await server.close();
}
