// The Lantern Glade scene and the stage's logical frame share one frame (garden-level 6.8, design 2.8). The drawn
// lantern (its Pixi container, in screen units) and the hit centre the stage driver uses (drawnTargetsOf, shown as
// the DOM marker of each lantern) must be the same point on the host box, within one pixel, at a wide and a tall
// window. The host box itself must be 16:9.
import { expect, test, type Page } from '@playwright/test';
import { TUNING } from 'marrow/core';
import { TUNING as WORLD_TUNING } from 'world-view';

/** The part of Pixi's Application that this test reads. The hook below stores it; no app code does. */
interface PixiAppLike {
  readonly canvas: HTMLCanvasElement;
  readonly stage: unknown;
}

declare global {
  var __pixiApp: PixiAppLike | undefined;
}

/** The logical aspect of the play area (GardenStage.tsx ASPECT). */
const ASPECT = 16 / 9;
/** The largest allowed gap in CSS pixels between a drawn lantern and its hit centre. */
const ONE_PIXEL = 1;
const SIZES = [
  { name: 'wide', width: 1280, height: 720 },
  { name: 'tall', width: 800, height: 1200 },
] as const;

interface FrameReport {
  readonly host: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly drawn: readonly { readonly x: number; readonly y: number }[];
  readonly hitCentres: readonly { readonly x: number; readonly y: number }[];
}

async function readFrame(page: Page): Promise<FrameReport> {
  await page.waitForFunction(() => globalThis.__pixiApp !== undefined, null, { timeout: 20000 });
  await page.waitForFunction(() => document.querySelectorAll('[data-target]').length === 4, null, { timeout: 20000 });
  // Give the scene a few frames after its targets are set, so the containers hold the current positions.
  await page.waitForTimeout(500);
  return page.evaluate(() => {
    const app = globalThis.__pixiApp;
    if (app === undefined || app.canvas.parentElement === null) throw new Error('the Pixi application is not mounted');
    const canvasRect = app.canvas.getBoundingClientRect();
    const host = app.canvas.parentElement.getBoundingClientRect();
    // The lantern containers are the children of the targets layer: a Container with one Graphics, whose parent has four children.
    const drawn: { x: number; y: number }[] = [];
    const visit = (node: { children?: unknown[]; parent?: { children?: unknown[] } } & Record<string, unknown>): void => {
      const children = (node.children ?? []) as { constructor: { name: string } }[];
      if (children.length === 1 && children[0]?.constructor.name === 'Graphics' && node.parent?.children?.length === 4) {
        const global = (node as unknown as { getGlobalPosition: () => { x: number; y: number } }).getGlobalPosition();
        // A canvas pixel to CSS pixel, using the canvas's own scale.
        drawn.push({
          x: canvasRect.x + (global.x * canvasRect.width) / app.canvas.width,
          y: canvasRect.y + (global.y * canvasRect.height) / app.canvas.height,
        });
      }
      for (const child of children) visit(child as never);
    };
    visit(app.stage as Parameters<typeof visit>[0]);
    const hitCentres = [...document.querySelectorAll('[data-target]')].map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    return {
      host: { x: host.x, y: host.y, width: host.width, height: host.height },
      drawn,
      hitCentres,
    };
  });
}

test.describe('Lantern Glade frame', () => {
  test.beforeEach(async ({ page }) => {
    // Test-only hook: Pixi calls this on every Application init (pixi.js globalHooks.mjs).
    await page.addInitScript(() => {
      (globalThis as unknown as { __PIXI_APP_INIT__: (app: unknown) => void }).__PIXI_APP_INIT__ = (app: unknown) => {
        globalThis.__pixiApp = app as PixiAppLike;
      };
    });
  });

  for (const size of SIZES) {
    test(`the drawn lanterns sit on their hit centres at a ${size.name} window`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto('/?start=lantern-glade');
      const frame = await readFrame(page);
      expect(frame.drawn.length, 'drawn lanterns').toBe(4);
      expect(frame.hitCentres.length, 'hit centres').toBe(4);
      const offsets = frame.drawn.map((drawn, index) => {
        const hit = frame.hitCentres[index];
        return hit === undefined ? null : { index, dx: drawn.x - hit.x, dy: drawn.y - hit.y };
      });
      console.log(`${size.name} ${frame.host.width}x${frame.host.height} offsets ${JSON.stringify(offsets)}`);
      // The host box is a 16:9 box, to within one pixel of its height.
      expect(Math.abs(frame.host.height - frame.host.width / ASPECT), 'host aspect').toBeLessThanOrEqual(ONE_PIXEL);
      frame.drawn.forEach((drawn, index) => {
        const hit = frame.hitCentres[index];
        expect(hit, `lantern ${index}`).toBeDefined();
        if (hit === undefined) return;
        expect(Math.abs(drawn.x - hit.x), `lantern ${index} x`).toBeLessThanOrEqual(ONE_PIXEL);
        expect(Math.abs(drawn.y - hit.y), `lantern ${index} y`).toBeLessThanOrEqual(ONE_PIXEL);
      });
    });
  }
});

/** How long a lantern is held: the dwell time, and a few frames of margin (marrow TUNING, read not written). */
const HOLD_MS = TUNING.dwellMs + TUNING.maxClockStepMs * 4;

/**
 * Lights the four lanterns with the mouse, in order, and waits until journey A has begun. Each lantern is the one with
 * data-active="yes". The pointer moves to a corner between lanterns, so it does not dwell on the next one by accident.
 */
async function lightLanterns(page: Page): Promise<void> {
  await page.waitForSelector('[data-target]', { timeout: 30000 });
  for (let lantern = 0; lantern < 4; lantern++) {
    await page.waitForSelector('[data-target][data-active="yes"]', { timeout: 30000 });
    const centre = await page.locator('[data-target][data-active="yes"]').boundingBox();
    if (centre === null) throw new Error('the active lantern has no box');
    await page.mouse.move(centre.x + centre.width / 2, centre.y + centre.height / 2, { steps: 4 });
    await page.waitForTimeout(HOLD_MS);
    const box = await page.locator('.garden-play').boundingBox();
    if (box !== null) await page.mouse.move(box.x + box.width * 0.02, box.y + box.height * 0.02, { steps: 2 });
    await page.waitForTimeout(TUNING.maxClockStepMs * 2);
  }
}

/** Decodes two PNG screenshots in the page and returns the pixel at each sample point, as RGB, for both. */
async function pixelsAt(page: Page, first: Buffer, second: Buffer, points: readonly { x: number; y: number }[]): Promise<{ a: number[][]; b: number[][] }> {
  return page.evaluate(
    async ({ aData, bData, samples }) => {
      const decode = async (data: string): Promise<CanvasRenderingContext2D> => {
        const image = new Image();
        image.src = `data:image/png;base64,${data}`;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d');
        if (context === null) throw new Error('no 2d context');
        context.drawImage(image, 0, 0);
        return context;
      };
      const read = (context: CanvasRenderingContext2D, point: { x: number; y: number }): number[] => {
        const x = Math.floor(point.x * context.canvas.width);
        const y = Math.floor(point.y * context.canvas.height);
        const [r = 0, g = 0, b = 0] = context.getImageData(x, y, 1, 1).data;
        return [r, g, b];
      };
      const a = await decode(aData);
      const b = await decode(bData);
      return { a: samples.map((point) => read(a, point)), b: samples.map((point) => read(b, point)) };
    },
    { aData: first.toString('base64'), bData: second.toString('base64'), samples: points },
  );
}

/**
 * The budget of one arrival test. It covers four lanterns, the reward, the travel and the wait for the rebuilt scene. It is
 * a bound for a slow headless frame rate, not a timing claim: the timing claims read the session's own clock.
 */
const ARRIVAL_BUDGET_MS = 180000;

test.describe('Whisper Glade arrival (requirements 2.4, 2.5, 8.5)', () => {
  test.setTimeout(ARRIVAL_BUDGET_MS);
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      (globalThis as unknown as { __PIXI_APP_INIT__: (app: unknown) => void }).__PIXI_APP_INIT__ = (app: unknown) => {
        globalThis.__pixiApp = app as PixiAppLike;
      };
    });
  });

  test('the arrival backdrop differs from the Lantern Glade backdrop at the ground', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/?start=lantern-glade');
    await page.waitForSelector('[data-target]', { timeout: 30000 });
    await page.waitForTimeout(TUNING.maxClockStepMs * 4);
    const before = await page.locator('.garden-play').screenshot();
    await lightLanterns(page);
    await page.waitForSelector('main[data-stage="whisper-glade"][data-phase="PLAYING"]', { timeout: 60000 });
    // The backdrop switches in the arrival frame; the scene is rebuilt a few frames later, so the screenshot waits for it.
    await page.waitForTimeout(TUNING.maxClockStepMs * 30);
    const after = await page.locator('.garden-play').screenshot();
    // Sample points in the ground band of the layer table (the lower part of the play area).
    const samples = [
      { x: 0.25, y: 0.9 },
      { x: 0.5, y: 0.9 },
      { x: 0.75, y: 0.9 },
    ];
    const { a, b } = await pixelsAt(page, before, after, samples);
    const differs = a.some((rgb, index) => rgb.some((value, channel) => value !== b[index]?.[channel]));
    expect(differs, `ground pixels before ${JSON.stringify(a)} after ${JSON.stringify(b)}`).toBe(true);
  });

  test.describe('under Reduced motion', () => {
    test.use({ reducedMotion: 'reduce' });

    test('the arrival is the cross-fade of the world-view tuning, not a journey', async ({ page }) => {
      test.setTimeout(ARRIVAL_BUDGET_MS);
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto('/?start=lantern-glade');
      // The clock of the session is clamped per frame, so a slow headless frame rate stretches wall-clock time. The
      // check reads the travel's own clock (data-travel-ms and data-travel-length), which is the session time.
      await page.evaluate(() => {
        const log: { style: string; elapsed: number; length: number; phase: string }[] = [];
        (globalThis as unknown as { __travelLog: typeof log }).__travelLog = log;
        const main = document.querySelector('main.garden-stage');
        if (main === null) throw new Error('no stage element');
        const record = (): void => {
          log.push({
            style: main.getAttribute('data-travel-style') ?? '',
            elapsed: Number(main.getAttribute('data-travel-ms') ?? 0),
            length: Number(main.getAttribute('data-travel-length') ?? 0),
            phase: main.getAttribute('data-phase') ?? '',
          });
        };
        new MutationObserver(record).observe(main, { attributes: true, attributeFilter: ['data-travel-ms', 'data-phase'] });
        record();
      });
      await lightLanterns(page);
      await page.waitForSelector('main[data-stage="whisper-glade"][data-phase="PLAYING"]', { timeout: ARRIVAL_BUDGET_MS });
      const log = await page.evaluate(() => (globalThis as unknown as { __travelLog: { style: string; elapsed: number; length: number; phase: string }[] }).__travelLog);
      const travelling = log.filter((entry) => entry.phase === 'TRAVELLING');
      expect(travelling.length, 'the travel was seen').toBeGreaterThan(0);
      for (const entry of travelling) {
        expect(entry.style, 'the travel is a cross-fade, not a move').toBe('fade');
        expect(entry.length, 'the cross-fade lasts crossFadeMs').toBe(WORLD_TUNING.crossFadeMs);
      }
      const last = travelling[travelling.length - 1];
      expect(Math.abs((last?.elapsed ?? 0) - WORLD_TUNING.crossFadeMs)).toBeLessThanOrEqual(TUNING.maxClockStepMs * 2);
    });
  });
});
