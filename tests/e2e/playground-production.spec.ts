// The production build under BASE_PATH=/garden/, served by `vite preview` on its own port 4173 (serve-production.mjs).
// The playground loads there, and the vendored MediaPipe files are served under the base path (Req 4.4, 26.2).
// Simulated input only: nothing here requests a camera.
import { expect, test } from '@playwright/test';

const BASE = 'http://localhost:4173/garden/';

/** The files the Camera Source loads from the app's own public folder (mediapipeUrls.ts, docs/licenses.md). */
const VENDORED_FILES = [
  'mediapipe/wasm/vision_wasm_internal.js',
  'mediapipe/wasm/vision_wasm_internal.wasm',
  'mediapipe/models/pose_landmarker_lite.task',
];

test('the production build loads the playground under /garden/', async ({ page }) => {
  await page.goto(`${BASE}?playground=1`);
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeVisible();
});

test('the production build serves the vendored MediaPipe files under /garden/', async ({ request }) => {
  for (const path of VENDORED_FILES) {
    const response = await request.get(`${BASE}${path}`);
    expect(response.status(), path).toBe(200);
    // vite preview answers an unknown path with index.html and status 200, so the type is checked too.
    expect(response.headers()['content-type'] ?? '', path).not.toContain('text/html');
    expect((await response.body()).length, path).toBeGreaterThan(1000);
  }
});
