// End-to-end tests of the input playground in simulated-input mode (Req 28.10). The tests use the mouse and the
// keyboard only. An init script replaces getUserMedia with a recorder that rejects, and every test checks that the
// recorder was never called, so no camera is requested on this path. Playwright never uses a camera.
import { expect, test, type Page } from '@playwright/test';

/** The comfort grid of the shipped tuning (16 columns, 12 rows) and the play aspect (8:5). */
const GRID_COLS = 16;
const GRID_ROWS = 12;
const PLAY_ASPECT = 1.6;
/** Animation frames the pointer rests on each grid point while painting. Four frames give four samples a pass. */
const PAINT_HOLD_FRAMES = 4;
/** The longest time the painting sweep may run before the test fails. */
const PAINT_TIMEOUT_MS = 90_000;
/** The longest time a target may take to complete once the pointer is on it: the dwell is 1500 ms of presence time. */
const COMPLETE_TIMEOUT_MS = 10_000;
/** The longest time one test may run. Painting and dwelling take tens of seconds. */
const TEST_TIMEOUT_MS = 180_000;

interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * Replaces getUserMedia with a recorder that rejects. The count is kept in window.cameraRequests. A string, so the
 * script runs in the page without the test compiler's help.
 */
const CAMERA_RECORDER = `
  window.cameraRequests = 0;
  const refuse = () => {
    window.cameraRequests += 1;
    return Promise.reject(new DOMException('The camera is not used in these tests.', 'NotAllowedError'));
  };
  if (!navigator.mediaDevices) {
    Object.defineProperty(navigator, 'mediaDevices', { value: {}, configurable: true });
  }
  Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: refuse, configurable: true });
`;

test.beforeEach(async ({ page }) => {
  test.setTimeout(TEST_TIMEOUT_MS);
  await page.addInitScript(CAMERA_RECORDER);
});

async function cameraRequests(page: Page): Promise<number> {
  const count: number = await page.evaluate('window.cameraRequests');
  return count;
}

/** Opens the playground, presses Start and chooses "Try without camera": the simulated-input path. */
async function startWithoutCamera(page: Page): Promise<void> {
  await page.goto('/?playground=1');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.getByRole('button', { name: 'Try without camera', exact: true }).click();
}

async function fieldBox(page: Page): Promise<{ x: number; y: number; height: number }> {
  const box = await page.locator('.playground-field').boundingBox();
  if (box === null) throw new Error('the play field has no box');
  return { x: box.x, y: box.y, height: box.height };
}

/**
 * The client point of a play-area point. The pointer source reads screen x and y in units of the field's height
 * (glossary), so a point at (x, y) lies at client (box.x + x * height, box.y + y * height).
 */
function clientPoint(box: { x: number; y: number; height: number }, point: Point): Point {
  return { x: box.x + point.x * box.height, y: box.y + point.y * box.height };
}

/** Waits for the given number of animation frames, so the pointer rests on one point for that long. */
async function waitFrames(page: Page, frames: number): Promise<void> {
  await page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        let left = count;
        const tick = () => {
          left -= 1;
          if (left <= 0) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    frames,
  );
}

/**
 * Paints with the mouse: the pointer rests on the centre of every comfort cell in turn, row by row, until the targets
 * appear. A cell needs 4 samples, so a pass gives each cell about 4 frames of samples.
 */
async function paintUntilTargets(page: Page): Promise<void> {
  const targets = page.locator('[data-target]');
  const deadline = Date.now() + PAINT_TIMEOUT_MS;
  while ((await targets.count()) === 0) {
    if (Date.now() > deadline) throw new Error(`calibration did not end within ${PAINT_TIMEOUT_MS} ms`);
    const box = await fieldBox(page);
    for (let row = 0; row < GRID_ROWS; row += 1) {
      for (let col = 0; col < GRID_COLS; col += 1) {
        const point = clientPoint(box, {
          x: ((col + 0.5) / GRID_COLS) * PLAY_ASPECT,
          y: (row + 0.5) / GRID_ROWS,
        });
        await page.mouse.move(point.x, point.y);
        await waitFrames(page, PAINT_HOLD_FRAMES);
        if ((await targets.count()) > 0) return;
      }
    }
  }
}

/** The ids of the target groups on the page, in document order. */
async function targetIds(page: Page): Promise<string[]> {
  return page.locator('[data-target]').evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('data-target') ?? ''),
  );
}

/** The centre of a target in play-area units, read from its circle's attributes, or null before the first frame. */
async function targetCentre(page: Page, id: string): Promise<Point | null> {
  return page.locator(`[data-target="${id}"] circle.playground-target-shape`).evaluate((element) => {
    const cx = element.getAttribute('cx');
    const cy = element.getAttribute('cy');
    return cx === null || cy === null ? null : { x: Number(cx), y: Number(cy) };
  });
}

/** Holds the pointer on one target until it shows as completed. */
async function completeTarget(page: Page, id: string): Promise<void> {
  await expect.poll(() => targetCentre(page, id)).not.toBeNull();
  const centre = await targetCentre(page, id);
  if (centre === null) throw new Error(`target ${id} has no centre`);
  const point = clientPoint(await fieldBox(page), centre);
  await page.mouse.move(point.x, point.y);
  await expect(page.locator(`[data-target="${id}"]`)).toHaveClass(/playground-target--completed/, {
    timeout: COMPLETE_TIMEOUT_MS,
  });
}

/** Completes the three targets of the round, then checks that a new round starts with new ids. */
async function completeRound(page: Page): Promise<void> {
  const first = await targetIds(page);
  expect(first).toHaveLength(3);
  for (const id of first) {
    await completeTarget(page, id);
  }
  const openNow = page.locator('[data-target]:not(.playground-target--completed)');
  await expect(openNow).toHaveCount(3, { timeout: COMPLETE_TIMEOUT_MS });
  const next = await targetIds(page);
  for (const id of next) {
    expect(first).not.toContain(id);
  }
}

test('(a) paint with the mouse, see three targets, complete them and see a new round', async ({ page }) => {
  await startWithoutCamera(page);
  await paintUntilTargets(page);
  await expect(page.locator('[data-target]')).toHaveCount(3);
  await completeRound(page);
  expect(await cameraRequests(page)).toBe(0);
});

test('(b) the same through "Use the whole screen"', async ({ page }) => {
  await startWithoutCamera(page);
  await page.getByRole('button', { name: 'Use the whole screen', exact: true }).click();
  await expect(page.locator('[data-target]')).toHaveCount(3, { timeout: COMPLETE_TIMEOUT_MS });
  await completeRound(page);
  expect(await cameraRequests(page)).toBe(0);
});

test('(c) Escape opens Pause and Resume closes it', async ({ page }) => {
  await startWithoutCamera(page);
  const pause = page.getByRole('dialog', { name: 'Pause', exact: true });
  await expect(pause).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(pause).toBeVisible();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(pause).toHaveCount(0);
});

test('(d) the camera is never requested on the simulated path', async ({ page }) => {
  await startWithoutCamera(page);
  await page.getByRole('button', { name: 'Use the whole screen', exact: true }).click();
  await expect(page.locator('[data-target]')).toHaveCount(3, { timeout: COMPLETE_TIMEOUT_MS });
  expect(await cameraRequests(page)).toBe(0);
});

test('(e) without playground=1 the page is unchanged: no playground, no simulated-input label', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Garden of Echoes' })).toBeVisible();
  await expect(page.locator('.playground-root')).toHaveCount(0);
  await expect(page.getByText('Simulated input')).toHaveCount(0);
});

test('Tab reaches Start with a solid 3 px focus ring', async ({ page }) => {
  await page.goto('/?playground=1');
  const start = page.getByRole('button', { name: 'Start', exact: true });
  for (let presses = 0; presses < 10; presses += 1) {
    if (await start.evaluate((element) => element === document.activeElement)) break;
    await page.keyboard.press('Tab');
  }
  await expect(start).toBeFocused();
  const ring = await start.evaluate((element) => {
    const style = getComputedStyle(element);
    return { style: style.outlineStyle, width: style.outlineWidth };
  });
  expect(ring).toEqual({ style: 'solid', width: '3px' });
});

test('ArrowRight in Pause raises the volume by a small step', async ({ page }) => {
  await startWithoutCamera(page);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  // The chrome has a Volume range too, so the range is read inside the Pause dialog.
  const volume = page
    .getByRole('dialog', { name: 'Pause', exact: true })
    .getByRole('slider', { name: 'Volume', exact: true });
  await expect(volume).toBeVisible();
  await volume.focus();
  const before = Number(await volume.inputValue());
  await page.keyboard.press('ArrowRight');
  const after = Number(await volume.inputValue());
  expect(after).toBeGreaterThan(before);
  expect(after - before).toBeLessThan(0.1);
});
