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
| pixi.js | 8.22.0 | MIT | `packages/world-view` (`dependencies`) | Renderer for the world-view Scene Manager; imported only in `packages/world-view/src/pixi` |

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

On 2026-11-20, `pixi.js` 8.22.0 (MIT) was added to `packages/world-view` with `npm install pixi.js@8.22.0 --save-exact -w world-view`, as Requirement 16.1 approves. The lockfile gained 12 entries: `pixi.js` and 11 transitive packages, which are listed below. Their licences were read from each installed `package.json` under `node_modules`, not from the registry metadata. The install also rewrote the root lockfile entry's `engines` field to match the root `package.json` (`^22.22.2 || ^24.15.0 || >=26.0.0`); no other existing entry changed. The install output printed `found 0 vulnerabilities`, which differs from the 7 moderate findings in the note above; that difference is not investigated here.

| Package | Version | Licence | Source URL (tarball in the lockfile) |
|---|---|---|---|
| `@pixi/colord` | 2.9.6 | MIT | https://registry.npmjs.org/@pixi/colord/-/colord-2.9.6.tgz |
| `@types/earcut` | 3.0.0 | MIT | https://registry.npmjs.org/@types/earcut/-/earcut-3.0.0.tgz |
| `@webgpu/types` | 0.1.74 | BSD-3-Clause | https://registry.npmjs.org/@webgpu/types/-/types-0.1.74.tgz |
| `@xmldom/xmldom` | 0.8.15 | MIT | https://registry.npmjs.org/@xmldom/xmldom/-/xmldom-0.8.15.tgz |
| `earcut` | 3.2.4 | ISC | https://registry.npmjs.org/earcut/-/earcut-3.2.4.tgz |
| `eventemitter3` | 5.0.4 | MIT | https://registry.npmjs.org/eventemitter3/-/eventemitter3-5.0.4.tgz |
| `gifuct-js` | 2.1.2 | MIT | https://registry.npmjs.org/gifuct-js/-/gifuct-js-2.1.2.tgz |
| `ismobilejs` | 1.1.1 | MIT | https://registry.npmjs.org/ismobilejs/-/ismobilejs-1.1.1.tgz |
| `js-binary-schema-parser` | 2.0.3 | MIT | https://registry.npmjs.org/js-binary-schema-parser/-/js-binary-schema-parser-2.0.3.tgz |
| `parse-svg-path` | 0.2.0 | MIT | https://registry.npmjs.org/parse-svg-path/-/parse-svg-path-0.2.0.tgz |
| `tiny-lru` | 11.4.7 | BSD-3-Clause | https://registry.npmjs.org/tiny-lru/-/tiny-lru-11.4.7.tgz |

All eleven licences are permissive (MIT, BSD-3-Clause, ISC). `js-binary-schema-parser` is a dependency of `gifuct-js`, so it is not among the ten direct dependencies of `pixi.js` that design section 10 lists.

## Vendored runtime assets

Four files are copied into `apps/garden-of-echoes/public/mediapipe/` and served from `BASE_PATH`, never from a third-party host (requirements 4.4, 4.5, 28.11). The test `vendored_assets_match_licenses` (`tests/vendored-assets.test.ts`) recomputes the SHA-256 of every file below and fails if a file is missing from this table, listed here but absent, or has another hash. Hashes are lowercase hexadecimal.

| File | Source URL | Downloaded | Licence | SHA-256 |
|---|---|---|---|---|
| `apps/garden-of-echoes/public/mediapipe/wasm/vision_wasm_internal.js` | https://registry.npmjs.org/@mediapipe/tasks-vision/-/tasks-vision-1.2.3.tgz | 2026-11-18 | Apache-2.0 | 2aa5fd3fdd3d8208cd7587df0bb19fb6925c4ea16a76dd025aedc1f64d6a6309 |
| `apps/garden-of-echoes/public/mediapipe/wasm/vision_wasm_internal.wasm` | https://registry.npmjs.org/@mediapipe/tasks-vision/-/tasks-vision-1.2.3.tgz | 2026-11-18 | Apache-2.0 | 225bc06c0f51a9cf31fea0e9e0b0243e9e01fb5ef332cc1a7fa6656dbdfdaabf |
| `apps/garden-of-echoes/public/mediapipe/models/pose_landmarker_lite.task` | https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task | 2026-11-18 | Apache-2.0 | 59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a |
| `apps/garden-of-echoes/public/mediapipe/LICENSE` | https://www.apache.org/licenses/LICENSE-2.0.txt | 2026-11-18 | Apache-2.0 | cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30 |

Notes:

- The two files from the npm package were copied on 2026-11-18 from `node_modules/@mediapipe/tasks-vision/wasm/` (package 1.2.3, installed on 2026-11-16 from the tarball above, whose integrity hash is in `package-lock.json`). Their licence is the `license` field of the package's `package.json`: `Apache-2.0`. The package ships no separate licence file.
- `FilesetResolver.forVisionTasks(basePath)` builds exactly two URLs, `<basePath>/vision_wasm_internal.js` and `<basePath>/vision_wasm_internal.wasm`. The `vision_wasm_module_internal` pair in the package is used only when a second argument `true` is passed, which the camera source does not do, so those two files are not vendored. Chromium 159, Chrome 158 and Edge 157 requested only the two vendored files (task 15.3 in the journal).
- The model was downloaded on 2026-11-18 from the versioned path `float16/1/`. The `latest` path reported the same size (5,777,746 bytes) and the same MD5 (`04a75ddf7c811ac7a1a4523266dd7d88`) in the server's headers at that date. Its licence is read from Google's official model card for the Pose Landmarker models, "Model Card BlazePose GHUM 3D" (https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf), the card the Pose Landmarker documentation links for the lite model. The card states "LICENSED UNDER Apache License, Version 2.0".
- `LICENSE` is the full, unmodified Apache License 2.0 text from the URL in its row, added on 2026-11-18 because section 4(a) requires a copy of the licence with every redistribution of the two WASM files and the model. `vite build` copies it to `dist/mediapipe/LICENSE`. The npm package 1.2.3 has no NOTICE file (its file list is the bundles, `package.json`, `README.md`, `vision.d.ts` and the four WASM files; the README only mentions a "Privacy Notice"), and the model card names none, so no NOTICE file is vendored.
