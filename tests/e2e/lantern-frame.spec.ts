// The Lantern Glade scene and the stage's logical frame share one frame (garden-level 6.8, design 2.8). The drawn
// lantern (its Pixi container, in screen units) and the hit centre the stage driver uses (drawnTargetsOf, shown as
// the DOM marker of each lantern) must be the same point on the host box, within one pixel, at a wide and a tall
// window. The host box itself must be 16:9.
import { expect, test, type Page } from '@playwright/test';

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
