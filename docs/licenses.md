# Licenses

Every dependency added to this repository, with its exact version and licence. Licences were read from each installed package's `package.json`.

## Direct dependencies

| Package | Version | Licence | Where | Purpose |
|---|---|---|---|---|
| react | 19.3.1 | MIT | app (`dependencies`) | UI |
| react-dom | 19.3.1 | MIT | app (`dependencies`) | UI |
| @types/react | 19.3.0 | MIT | root (`devDependencies`) | Types |
| @types/react-dom | 19.3.0 | MIT | root (`devDependencies`) | Types |
| @types/node | 24.19.2 | MIT | root (`devDependencies`) | Types for config files and tests |
| typescript | 6.0.3 | Apache-2.0 | root (`devDependencies`) | Language, type checking |
| vite | 8.3.8 | MIT | root (`devDependencies`) | Dev server and build |
| @vitejs/plugin-react | 6.3.0 | MIT | root (`devDependencies`) | React support in Vite |
| vitest | 5.1.0 | MIT | root (`devDependencies`) | Unit tests |
| fast-check | 4.10.2 | MIT | root (`devDependencies`) | Property-based tests |
| @playwright/test | 1.65.1 | Apache-2.0 | root (`devDependencies`) | End-to-end tests |
| eslint | 10.15.0 | MIT | root (`devDependencies`) | Linting |
| typescript-eslint | 8.72.2 | MIT | root (`devDependencies`) | TypeScript support for ESLint |
| @mediapipe/tasks-vision | 1.2.3 | Apache-2.0 | `packages/marrow` (`dependencies`) | Pose Landmarker (lite) for camera input; imported only in `src/input` |
| @testing-library/react | 16.3.3 | MIT | root (`devDependencies`) | Component tests for the React setup UI |
| @testing-library/dom | 10.4.2 | MIT | root (`devDependencies`) | Required peer of the Testing Library packages |
| @testing-library/user-event | 14.6.12 | MIT | root (`devDependencies`) | User-interaction simulation in component tests |
| @testing-library/jest-dom | 7.0.1 | MIT | root (`devDependencies`) | DOM matchers for Vitest |
| jsdom | 31.0.1 | MIT | root (`devDependencies`) | DOM environment for component tests |

All versions are pinned exactly in `package.json`, and `package-lock.json` is committed. The six packages added on 2026-11-16 (`@mediapipe/tasks-vision` plus the component-test stack) were approved in chat and installed with exact pins for the marrow-input spec.

## Browser binary (development only)

| Item | Licence | Notes |
|---|---|---|
| Chromium (with its headless shell and ffmpeg), downloaded by `npx playwright install chromium` | Chromium project licences (mostly BSD-3-Clause, plus third-party component licences, see https://www.chromium.org/chromium-os/licensing/) | Used only to run `npm run test:e2e`. Not shipped with the app. Playwright's other browsers are not installed. |

## Transitive dependencies

Scan of the installed `node_modules` tree (three levels deep) on 2026-11-15, counting packages by licence: MIT 103, Apache-2.0 17, ISC 6, BSD-2-Clause 6, BSD-3-Clause 2, BlueOak-1.0.0 2, MPL-2.0 2.

Rescan on 2026-11-16, after the six additions, counting every `node_modules` package manifest that has a name and version (whole tree, so not directly comparable with the three-level scan above): MIT 149, Apache-2.0 21, BSD-2-Clause 8, ISC 7, BlueOak-1.0.0 4, BSD-3-Clause 3, MPL-2.0 2 (194 manifests). Every licence is permissive and no new licence family appeared: `@mediapipe/tasks-vision` is Apache-2.0, and the component-test stack with its transitive dependencies is MIT, BSD, ISC and Apache-2.0.

The two MPL-2.0 packages are `lightningcss` and its Windows binary `lightningcss-win32-x64-msvc` (1.33.0), pulled in by Vite as a build tool. They are not modified and their code is not part of the app bundles.

`npm audit` reports 7 moderate findings, unchanged by the 2026-11-16 additions, all from `minimatch` inside `@typescript-eslint/typescript-estree`, a development-only linting dependency. The suggested fix is a downgrade of typescript-eslint, which is outside the approved versions, so it is not applied.

## Vendored runtime assets

None yet. `@mediapipe/tasks-vision` 1.2.3 is installed (Apache-2.0) and provides the Tasks Vision WASM files. Those WASM files and the `pose_landmarker_lite` model (float16) will be copied into `apps/garden-of-echoes/public/mediapipe/` and served from `BASE_PATH` when the camera source is built, and each vendored file recorded here with its source URL, download date, licence and SHA-256 (requirements 4.4, 4.5, 28.11).
