// The garden-level play path in browser tests (garden-level tasks 12.1; requirements 3.1, 3.5, 9.3, 13.1, 13.2, 18.5,
// 20.1 to 20.5, 21.4, 24.1, 24.4, 24.5). Every test runs in simulated input. No test requests the camera: getUserMedia is
// replaced by a counter that refuses, and each test checks that the counter stayed at zero.
//
// The route test aims at the DOM marker of each target, reading its position on every pass, because head view moves the
// targets. Whisper spirits are told apart by their shape (data-shape) and by the instruction line: a select line says
// "Reach for", and a let-pass line says "pass". The pointer rests in a corner when nothing is to be selected.
import { expect, test, type Page } from '@playwright/test';
import { copy } from '../../apps/garden-of-echoes/src/copy';
import { GARDEN_COPY } from '../../apps/garden-of-echoes/src/copy/garden';

/** The whole route, Lantern Glade to the end card, with arrivals of 40 to 60 s of wall time each. */
const ROUTE_TIMEOUT_MS = 600_000;
/** The route loop gives up this long before the test timeout, so a stuck route fails with its last state. */
const ROUTE_LOOP_BUDGET_MS = 540_000;
/** The pointer is set again this often, so it follows a target that moves with the head view. */
const AIM_INTERVAL_MS = 50;
/** A short test, from load to an assertion on the stage. */
const SHORT_TIMEOUT_MS = 60_000;
/** The stage id a session passes through, in order. */
const ROUTE = ['lantern-glade', 'whisper-glade', 'whisper-hall', 'bloom'] as const;
/** The corners of the play area, as fractions of its box, where the pointer rests when no target is to be selected. */
const PARK_CORNERS = [
  { x: 0.02, y: 0.98 },
  { x: 0.98, y: 0.98 },
  { x: 0.02, y: 0.02 },
  { x: 0.98, y: 0.02 },
] as const;
/** The settings key of the app: the store's prefix, then the store's key name (garden-of-echoes/settings). */
const SETTINGS_KEY = 'garden-of-echoes.settings';

/** A target marker as the DOM shows it, with its centre and size in CSS pixels. */
interface Marker {
  readonly id: string;
  readonly shape: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** What the route loop reads from the page on one pass. */
interface Snapshot {
  readonly stage: string;
  readonly instruction: string;
  readonly markers: readonly Marker[];
  readonly endCard: boolean;
  readonly paused: boolean;
  readonly play: { readonly x: number; readonly y: number; readonly w: number; readonly h: number } | null;
}

/**
 * Before the page loads: the camera is replaced by a counter that refuses, and the audio is muted in the stored settings
 * (requirement 18.5). Each test has a fresh browser context, so the stored settings start empty.
 */
async function prepare(page: Page): Promise<void> {
  await page.addInitScript((settingsKey: string) => {
    const probe = globalThis as unknown as { __cameraRequests: number; __cameraSpy: boolean };
    probe.__cameraRequests = 0;
    probe.__cameraSpy = false;
    const devices = navigator.mediaDevices;
    if (devices !== undefined) {
      devices.getUserMedia = () => {
        probe.__cameraRequests += 1;
        return Promise.reject(new DOMException('The camera is blocked in this test.', 'NotAllowedError'));
      };
      probe.__cameraSpy = true;
    }
    globalThis.localStorage.setItem(settingsKey, JSON.stringify({ version: 1, mute: true }));
  }, SETTINGS_KEY);
}

/** The camera counter, read from the page. The spy must be installed, or the count means nothing. */
async function cameraRequests(page: Page): Promise<number> {
  const probe = await page.evaluate(() => {
    const state = globalThis as unknown as { __cameraRequests: number; __cameraSpy: boolean };
    return { spy: state.__cameraSpy, count: state.__cameraRequests };
  });
  expect(probe.spy, 'the camera spy is installed').toBe(true);
  return probe.count;
}

/** Reads the stage, the instruction, the active markers and the end card in one page call. */
async function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => {
    const main = document.querySelector('main.garden-stage');
    const play = document.querySelector('.garden-play');
    const markers = [...document.querySelectorAll<HTMLElement>('[data-target][data-active="yes"]')].map((el) => {
      const r = el.getBoundingClientRect();
      return { id: el.dataset.target ?? '', shape: el.dataset.shape ?? '', x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height };
    });
    const box = play?.getBoundingClientRect();
    return {
      stage: main?.getAttribute('data-stage') ?? '',
      instruction: document.querySelector('.garden-instruction')?.textContent ?? '',
      markers,
      endCard: document.querySelector('[data-testid="end-card"]') !== null,
      paused: document.querySelector('[role="dialog"]') !== null,
      play: box === undefined ? null : { x: box.x, y: box.y, w: box.width, h: box.height },
    };
  });
}

/**
 * The target to hold now, or null. A lantern, a path option, and the Hall and Bloom targets are held at once. A whisper
 * spirit is held only in a select presentation, and only the spirit that the line names: a blue drop or a gold leaf.
 */
function aimOf(snap: Snapshot): Marker | null {
  const selecting = snap.instruction.includes('Reach for');
  const wanted = snap.instruction.includes('blue drop') ? 'drop' : 'leaf';
  for (const marker of snap.markers) {
    if (marker.shape === 'drop' || marker.shape === 'leaf') {
      if (selecting && marker.shape === wanted) return marker;
      continue;
    }
    return marker;
  }
  return null;
}

/** A corner of the play area with no active marker near it, so the resting pointer does not dwell on a target. */
function parkOf(snap: Snapshot): { x: number; y: number } | null {
  if (snap.play === null) return null;
  const { x, y, w, h } = snap.play;
  const free = PARK_CORNERS.map((corner) => ({ x: x + w * corner.x, y: y + h * corner.y })).find(
    (point) => !snap.markers.some((m) => Math.abs(m.x - point.x) < m.w / 2 + 20 && Math.abs(m.y - point.y) < m.h / 2 + 20),
  );
  return free ?? { x: x + w * PARK_CORNERS[0].x, y: y + h * PARK_CORNERS[0].y };
}

/**
 * Plays the route until the end card shows. Each pass reads the page, then moves the pointer to the target to hold, or to
 * a free corner. It returns the stages in the order the session reached them.
 */
async function playToEndCard(page: Page): Promise<string[]> {
  const seen: string[] = [];
  const deadline = Date.now() + ROUTE_LOOP_BUDGET_MS;
  let last: Snapshot | null = null;
  for (;;) {
    const snap = await snapshot(page);
    last = snap;
    if (snap.stage !== '' && seen[seen.length - 1] !== snap.stage) seen.push(snap.stage);
    if (snap.endCard) return seen;
    if (snap.paused) throw new Error('the Pause screen opened during the route');
    if (Date.now() > deadline) {
      throw new Error(`no end card within ${ROUTE_LOOP_BUDGET_MS} ms; stages ${seen.join(' > ')}; last ${JSON.stringify(last)}`);
    }
    const aim = aimOf(snap) ?? parkOf(snap);
    if (aim !== null) await page.mouse.move(aim.x, aim.y);
    await page.waitForTimeout(AIM_INTERVAL_MS);
  }
}

test.describe('Home to the end card in simulated input (requirements 9.3, 18.5, 21.4)', () => {
  test.use({ reducedMotion: 'reduce' });

  test('Home, Lantern Glade, Whisper Glade, Whisper Hall and Bloom reach the end card, with no camera request', async ({ page }) => {
    test.setTimeout(ROUTE_TIMEOUT_MS);
    await prepare(page);
    await page.goto('/');
    await page.getByRole('button', { name: GARDEN_COPY.home.noCamera }).click();
    await expect(page.locator('main.garden-stage')).toBeVisible({ timeout: SHORT_TIMEOUT_MS });
    await expect(page.getByText(GARDEN_COPY.label.simulated)).toBeVisible();

    const seen = await playToEndCard(page);

    await expect(page.getByTestId('end-card')).toBeVisible();
    expect(seen).toEqual([...ROUTE]);
    expect(await cameraRequests(page), 'camera requests').toBe(0);
  });
});

test.describe('Keyboard and Pause (requirements 3.5, 24.1, 24.4)', () => {
  test.setTimeout(SHORT_TIMEOUT_MS);

  test('Escape opens Pause, and a second Escape closes it', async ({ page }) => {
    await prepare(page);
    await page.goto('/?start=lantern-glade');
    await expect(page.locator('main.garden-stage')).toBeVisible({ timeout: SHORT_TIMEOUT_MS });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await cameraRequests(page)).toBe(0);
  });

  test('Enter on Start shows the camera permission screen, and does not request the camera yet', async ({ page }) => {
    await prepare(page);
    await page.goto('/');
    await page.keyboard.press('Tab');
    const start = page.getByRole('button', { name: GARDEN_COPY.home.start });
    await expect(start).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: copy.marrow.camera.useCamera })).toBeVisible({ timeout: SHORT_TIMEOUT_MS });
    await expect(start).toHaveCount(0);
    expect(await cameraRequests(page), 'camera requests after Start').toBe(0);
  });

  test('Space on "Try without camera" enters the stage in simulated input', async ({ page }) => {
    await prepare(page);
    await page.goto('/');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    const noCamera = page.getByRole('button', { name: GARDEN_COPY.home.noCamera });
    await expect(noCamera).toBeFocused();
    await page.keyboard.press('Space');
    await expect(page.locator('main.garden-stage')).toBeVisible({ timeout: SHORT_TIMEOUT_MS });
    await expect(page.getByText(GARDEN_COPY.label.simulated)).toBeVisible();
    expect(await cameraRequests(page)).toBe(0);
  });
});

test.describe('Touch on the play area (requirements 13.1, 13.2)', () => {
  test.use({ hasTouch: true });
  test.setTimeout(SHORT_TIMEOUT_MS);

  test('the play area has touch-action none, and a touch move neither pans the page nor cancels the pointer', async ({ page }) => {
    await prepare(page);
    await page.goto('/?start=lantern-glade');
    await expect(page.locator('.garden-play')).toBeVisible({ timeout: SHORT_TIMEOUT_MS });
    const touchAction = await page.locator('.garden-play').evaluate((el) => getComputedStyle(el).touchAction);
    expect(touchAction).toBe('none');

    // A tall spacer below the stage, so a pan would move the page. The listeners record the touch pointer events.
    await page.evaluate(() => {
      const spacer = document.createElement('div');
      spacer.setAttribute('data-test', 'spacer');
      spacer.style.height = '4000px';
      document.body.appendChild(spacer);
      const probe = globalThis as unknown as { __touch: { moves: number; cancels: number } };
      probe.__touch = { moves: 0, cancels: 0 };
      const area = document.querySelector('.garden-play');
      area?.addEventListener('pointermove', (event) => {
        if ((event as PointerEvent).pointerType === 'touch') probe.__touch.moves += 1;
      });
      area?.addEventListener('pointercancel', () => {
        probe.__touch.cancels += 1;
      });
    });
    const box = await page.locator('.garden-play').boundingBox();
    if (box === null) throw new Error('the play area has no box');
    const cdp = await page.context().newCDPSession(page);
    const x = box.x + box.width / 2;
    const startY = box.y + box.height * 0.8;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: startY }] });
    for (let step = 1; step <= 10; step++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: startY - step * 8 }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(AIM_INTERVAL_MS * 6);

    const result = await page.evaluate(() => ({
      scrollY: window.scrollY,
      touch: (globalThis as unknown as { __touch: { moves: number; cancels: number } }).__touch,
    }));
    expect(result.touch.moves, 'touch pointer moves seen on the play area').toBeGreaterThan(0);
    expect(result.touch.cancels, 'pointer cancels on the play area').toBe(0);
    expect(result.scrollY, 'page scroll after the touch move').toBe(0);
    expect(await cameraRequests(page)).toBe(0);
  });
});

test.describe('The ?start shortcut (requirements 20.1 to 20.5)', () => {
  test('?start=bloom starts Bloom in simulated input, with the label and no camera request', async ({ page }) => {
    await prepare(page);
    await page.goto('/?start=bloom');
    await expect(page.locator('main.garden-stage')).toHaveAttribute('data-stage', 'bloom', { timeout: SHORT_TIMEOUT_MS });
    await expect(page.getByText(GARDEN_COPY.label.simulated)).toBeVisible();
    await expect(page.locator('[data-target]')).toHaveCount(1);
    expect(await cameraRequests(page)).toBe(0);
  });

  test('an unknown ?start id shows the Home screen, and no stage', async ({ page }) => {
    await prepare(page);
    await page.goto('/?start=not-a-stage');
    await expect(page.getByRole('heading', { level: 1, name: copy.appName })).toBeVisible({ timeout: SHORT_TIMEOUT_MS });
    await expect(page.getByRole('button', { name: GARDEN_COPY.home.start })).toBeVisible();
    await expect(page.getByRole('button', { name: GARDEN_COPY.home.noCamera })).toBeVisible();
    await expect(page.locator('main.garden-stage')).toHaveCount(0);
    expect(await cameraRequests(page)).toBe(0);
  });
});
