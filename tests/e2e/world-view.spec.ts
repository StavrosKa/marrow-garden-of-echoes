// The World Playground in simulated-input mode (design 9.4, Req 15.4). One test, run in order. Each step
// reads the read-only snapshot of window.__worldPlayground, which exists only on ?playground=world.
// Code that runs in the page takes its constants as arguments: the page cannot see this file's scope.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { copy } from '../../apps/garden-of-echoes/src/copy/index';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROUTE = '/?playground=world';
const LABEL = copy.worldPlayground;
const TEST_TIMEOUT_MS = 120_000;
const FRAMES_TO_CHECK = 20;
const RAMP_MS = 1000;
const RAMP_TARGET = 0.5;
const RAMP_LIMIT_MS = 10_000;
const HOLD_MS = 2000;
const STOP_2_ID = 'stop-2-0';
const ARRIVED_TAIL_FRAMES = 5;
const MAX_RECORD_FRAMES = 4000;

interface Vec {
  readonly x: number;
  readonly y: number;
}

interface TargetView {
  readonly stop: number;
  readonly active: boolean;
  readonly selected: boolean;
  readonly dwell: { readonly owner: string | null; readonly progress: number };
  readonly rendered: { readonly x: number; readonly y: number; readonly scale: number; readonly visible: boolean } | null;
  readonly circle: { readonly centre: Vec; readonly radius: number } | null;
}

interface Snapshot {
  readonly screen: string;
  /** Missing until the first frame has run. */
  readonly canvas?: { readonly width: number; readonly height: number };
  readonly interactionHead: Vec;
  readonly decorativeHead: Vec;
  readonly lock: { readonly requested: boolean; readonly mode: string };
  readonly view: { readonly travel: number; readonly head: Vec };
  readonly travel: { readonly phase: string; readonly cover: number };
  readonly layers: readonly { readonly id: string; readonly x: number; readonly y: number; readonly scale: number }[];
  readonly targets: Readonly<Record<string, TargetView>>;
  readonly circles: readonly { readonly id: string; readonly centre: Vec; readonly radius: number }[];
  readonly placement: readonly { readonly id: string; readonly r: number }[];
  readonly restartAvailable: boolean;
}

/** The handle that the page defines on the world route (design 8.2). */
interface Handle {
  readonly __worldPlayground?: {
    snapshot(): Snapshot;
    setHead(head: Vec | null): void;
  };
}

/** One frame of a travel, as the recorder saw it. */
interface Sample {
  readonly phase: string;
  readonly stop2Active: boolean;
  readonly stop2Selected: boolean;
  readonly circles: number;
  readonly cover: number;
  readonly travel: number;
}

/** One frame of the dwell, as the in-page recorder saw it while the target's dwell owner was set. */
interface DwellFrame {
  readonly interactionHead: Vec;
  readonly interaction: Vec;
  readonly circle: Vec | null;
  readonly decorative: Vec;
  readonly decorativeHead: Vec;
  readonly lockRequested: boolean;
  readonly lockMode: string;
}

interface Slice {
  readonly layers: readonly { readonly id: string; readonly interaction?: boolean; readonly factor?: number }[];
  readonly segments: readonly { readonly kind: string; readonly to: number }[];
}

const SLICE = JSON.parse(
  readFileSync(path.join(HERE, '..', '..', 'apps', 'garden-of-echoes', 'src', 'dev', 'world', 'forestSlice.json'), 'utf8'),
) as Slice;
const INTERACTION_ID = SLICE.layers.find((layer) => layer.interaction === true)?.id ?? '';
/** The decorative layer with the largest factor moves most with the head (Req 3.1). */
const DECORATIVE_ID =
  [...SLICE.layers]
    .filter((layer) => layer.interaction !== true && (layer.factor ?? 0) > 0)
    .sort((a, b) => (b.factor ?? 0) - (a.factor ?? 0))[0]?.id ?? '';
const DOOR_TO = SLICE.segments.find((segment) => segment.kind === 'door')?.to ?? Number.NaN;

async function timed<T>(name: string, step: () => Promise<T>): Promise<T> {
  const started = Date.now();
  try {
    return await step();
  } finally {
    console.log(`e2e step ${name}: ${Date.now() - started} ms`);
  }
}

async function read(page: Page): Promise<Snapshot> {
  return page.evaluate(() => (window as unknown as Handle).__worldPlayground!.snapshot());
}

/** The canvas height in CSS pixels: the K of design 9.4 step 5. A snapshot without a canvas is an error here. */
function canvasHeight(snapshot: Snapshot): number {
  if (snapshot.canvas === undefined) throw new Error('the snapshot has no canvas yet');
  return snapshot.canvas.height;
}

/** Moves the pointer to a screen point of the play area. K is the canvas height in CSS pixels (design 9.4 step 5). */
async function pointAt(page: Page, area: Locator, point: Vec, k: number): Promise<void> {
  await area.scrollIntoViewIfNeeded();
  const box = await area.boundingBox();
  if (box === null) throw new Error('the play area has no box');
  await page.mouse.move(box.x + point.x * k, box.y + point.y * k);
}

/** Holds the pointer on a target until it is selected. The target must have a hit circle. */
async function selectTarget(page: Page, area: Locator, id: string): Promise<void> {
  // A pointer that rests on an active target completes its dwell soon after the target becomes active
  // (Req 13.3 allows a selection after arrival), so the wait also ends when the target is already selected.
  await page.waitForFunction(
    (targetId) => {
      const target = (window as unknown as Handle).__worldPlayground!.snapshot().targets[targetId];
      return target?.selected === true || target?.circle != null;
    },
    id,
  );
  const snapshot = await read(page);
  if (snapshot.targets[id]?.selected === true) return;
  const circle = snapshot.targets[id]?.circle;
  if (circle == null) {
    throw new Error(`target ${id} has no hit circle: ${JSON.stringify({ phase: snapshot.travel.phase, target: snapshot.targets[id], circles: snapshot.circles })}`);
  }
  await pointAt(page, area, circle.centre, canvasHeight(snapshot));
  await page.waitForFunction(
    (targetId) => (window as unknown as Handle).__worldPlayground!.snapshot().targets[targetId]?.selected === true,
    id,
  );
}

/**
 * One travel from stop 1 to stop 2 and back to stop 1: both stop-1 targets are selected, the travel is
 * recorded frame by frame while the pointer rests on the stop-2 target, the arrival is checked, the
 * stop-2 target is selected, and Restart returns to stop 1. Returns the recorded frames.
 */
async function travelOnce(page: Page, area: Locator, expectedTo: number, selectStopOne: boolean): Promise<Sample[]> {
  const stopOne = Object.keys((await read(page)).targets).filter((id) => id.startsWith('stop-1'));
  const [first, second] = stopOne;
  if (first === undefined || second === undefined) throw new Error('two stop-1 targets are expected');
  if (selectStopOne) {
    await selectTarget(page, area, first);
    await selectTarget(page, area, second);
  }
  const recording = page.evaluate(
    ([stop2Id, tailFrames, maxFrames]: [string, number, number]) =>
      new Promise<Sample[]>((resolve) => {
        const samples: Sample[] = [];
        let arrivedFrames = 0;
        const tick = (): void => {
          const s = (window as unknown as Handle).__worldPlayground!.snapshot();
          samples.push({
            phase: s.travel.phase,
            stop2Active: s.targets[stop2Id]?.active === true,
            stop2Selected: s.targets[stop2Id]?.selected === true,
            circles: s.circles.length,
            cover: s.travel.cover,
            travel: s.view.travel,
          });
          if (s.travel.phase === 'arrived') arrivedFrames += 1;
          if (arrivedFrames > tailFrames || samples.length >= maxFrames) resolve(samples);
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    [STOP_2_ID, ARRIVED_TAIL_FRAMES, MAX_RECORD_FRAMES] as [string, number, number],
  );
  await page.waitForFunction(() => (window as unknown as Handle).__worldPlayground!.snapshot().travel.phase === 'travelling');
  // The pointer rests on the stop-2 target's rendered position during the travel (design 9.4 step 10).
  const during = await read(page);
  const rendered = during.targets[STOP_2_ID]?.rendered;
  if (rendered != null && during.travel.phase === 'travelling') {
    await pointAt(page, area, rendered, canvasHeight(during));
    await page.waitForTimeout(HOLD_MS);
  }
  await page.waitForFunction(() => (window as unknown as Handle).__worldPlayground!.snapshot().travel.phase === 'arrived');
  const samples = await recording;
  const arrived = samples.findIndex((sample) => sample.phase === 'arrived');
  expect(arrived).toBeGreaterThan(-1);
  for (const sample of samples.slice(0, arrived)) {
    expect(sample.stop2Selected).toBe(false);
    if (sample.phase === 'travelling') {
      expect(sample.stop2Active).toBe(false);
      expect(sample.circles).toBe(0);
    }
  }
  const firstArrived = samples[arrived];
  expect(firstArrived?.stop2Active).toBe(true);
  expect(firstArrived?.travel).toBe(expectedTo);
  await selectTarget(page, area, STOP_2_ID);
  await page.getByRole('button', { name: LABEL.restart }).click();
  await page.waitForFunction(() => (window as unknown as Handle).__worldPlayground!.snapshot().travel.phase === 'idle');
  const reset = await read(page);
  expect(reset.view.travel).toBe(0);
  expect(reset.targets[first]?.active).toBe(true);
  expect(reset.targets[first]?.selected).toBe(false);
  return samples;
}

test.describe('world playground', () => {
  test.setTimeout(TEST_TIMEOUT_MS);

  test('world playground in simulated-input mode', async ({ page }) => {
    await timed('1 open the route with empty storage', async () => {
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.goto('/');
      await page.evaluate(() => localStorage.clear());
      await page.goto(ROUTE);
      await page.waitForFunction(() => (window as unknown as Handle).__worldPlayground !== undefined);
    });

    const area = page.getByTestId('world-play-area');
    await timed('2 play area touch-action and the route global', async () => {
      await page.waitForFunction(() => (window as unknown as Handle).__worldPlayground !== undefined);
      await expect(area).toHaveCount(1);
      expect(await area.evaluate((element) => getComputedStyle(element).touchAction)).toBe('none');
      expect(await page.evaluate(() => (window as unknown as Handle).__worldPlayground !== undefined)).toBe(true);
      await page.goto('/');
      expect(await page.evaluate(() => (window as unknown as Handle).__worldPlayground === undefined)).toBe(true);
      await page.goto(ROUTE);
      await page.waitForFunction(() => (window as unknown as Handle).__worldPlayground !== undefined);
    });

    await timed('3 start with the door segment and the mouse', async () => {
      await page.getByRole('radio', { name: LABEL.segmentDoor }).check();
      await page.getByRole('button', { name: LABEL.startMouse }).click();
      await page.waitForFunction(() => {
        const s = (window as unknown as Handle).__worldPlayground!.snapshot();
        return s.screen === 'running' && (s.canvas?.width ?? 0) > 0;
      });
    });

    await timed('4 rendered target equals hit circle for 20 frames', async () => {
      const result = await page.evaluate(async (frames: number) => {
        const handle = (window as unknown as Handle).__worldPlayground!;
        const failures: string[] = [];
        let compared = 0;
        for (let frame = 0; frame < frames; frame += 1) {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          const s = handle.snapshot();
          for (const [id, target] of Object.entries(s.targets)) {
            if (!target.active || target.circle === null) continue;
            compared += 1;
            const rendered = target.rendered;
            const circle = target.circle;
            const same =
              rendered !== null &&
              Object.is(rendered.x, circle.centre.x) &&
              Object.is(rendered.y, circle.centre.y) &&
              circle.radius === s.placement[0]?.r;
            if (!same) failures.push(`frame ${frame} ${id}: rendered ${JSON.stringify(rendered)} circle ${JSON.stringify(circle)}`);
          }
        }
        return { compared, failures };
      }, FRAMES_TO_CHECK);
      expect(result.failures).toEqual([]);
      expect(result.compared).toBeGreaterThan(0);
    });

    // The dwell frames, recorded in the page. Steps 5 to 7 share them.
    let samples: DwellFrame[] = [];
    let d0: Vec | undefined;
    const first = await timed('5 hover the first target until its dwell starts', async () => {
      const snapshot = await read(page);
      const id = Object.keys(snapshot.targets).find((key) => key.startsWith('stop-1') && snapshot.targets[key]?.active === true);
      if (id === undefined) throw new Error('no active stop-1 target');
      const circle = snapshot.targets[id]?.circle;
      if (circle == null) throw new Error(`target ${id} has no hit circle`);
      d0 = snapshot.layers.find((layer) => layer.id === DECORATIVE_ID);
      // The recorder starts before the pointer enters the circle, so no round trip sits inside the dwell. In the
      // page it waits for the target's dwell owner; from that very frame it ramps the head and records each frame
      // while the owner is set, until the target is selected or the limit passes.
      const recording = page.evaluate(
        async ([targetId, rampMs, rampTarget, limitMs, interactionId, decorativeId]: [string, number, number, number, string, string]) => {
          const handle = (window as unknown as Handle).__worldPlayground!;
          const out: {
            interactionHead: Vec;
            interaction: { x: number; y: number };
            circle: Vec | null;
            decorative: { x: number; y: number };
            decorativeHead: Vec;
            lockRequested: boolean;
            lockMode: string;
          }[] = [];
          const waitStarted = performance.now();
          let started: number | undefined;
          let done = false;
          while (!done) {
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
            const now = performance.now();
            const s = handle.snapshot();
            const target = s.targets[targetId];
            if (started === undefined) {
              if (target?.dwell.owner != null) started = now;
              else if (now - waitStarted > limitMs) break;
              else continue;
            }
            const elapsed = now - started;
            handle.setHead({ x: rampTarget * Math.min(1, elapsed / rampMs), y: 0 });
            const interaction = s.layers.find((layer) => layer.id === interactionId);
            const decorative = s.layers.find((layer) => layer.id === decorativeId);
            if (target !== undefined && target.dwell.owner !== null && interaction !== undefined && decorative !== undefined) {
              out.push({
                interactionHead: s.interactionHead,
                interaction: { x: interaction.x, y: interaction.y },
                circle: target.circle?.centre ?? null,
                decorative: { x: decorative.x, y: decorative.y },
                decorativeHead: s.decorativeHead,
                lockRequested: s.lock.requested,
                lockMode: s.lock.mode,
              });
            }
            done = (target?.selected === true && out.length > 0) || elapsed > limitMs;
          }
          handle.setHead(null);
          return out;
        },
        [id, RAMP_MS, RAMP_TARGET, RAMP_LIMIT_MS, INTERACTION_ID, DECORATIVE_ID] as [string, number, number, number, string, string],
      );
      await pointAt(page, area, circle.centre, canvasHeight(snapshot));
      samples = await recording;
      expect(samples.length).toBeGreaterThan(0);
      return id;
    });

    await timed('6 lock held (locked, dwell owner set)', async () => {
      expect(samples.some((sample) => sample.lockMode === 'locked' && sample.lockRequested)).toBe(true);
    });

    await timed('7 dwell completes during the head ramp; interaction layer and circle held', async () => {
      // The lock holds from the first locked frame: h0 is the interaction head of that frame.
      const locked = samples.filter((sample) => sample.lockMode === 'locked');
      const start = locked[0];
      if (start === undefined) throw new Error('no locked dwell frame');
      const h0 = start.interactionHead;
      for (const sample of locked) {
        expect(Object.is(sample.interactionHead.x, h0.x)).toBe(true);
        expect(Object.is(sample.interactionHead.y, h0.y)).toBe(true);
        expect(sample.interaction).toEqual(start.interaction);
        expect(sample.circle).toEqual(start.circle);
      }
      expect(samples.some((sample) => sample.decorative.x !== d0?.x || sample.decorative.y !== d0?.y)).toBe(true);
      const dwellStart = samples[0];
      if (dwellStart === undefined) throw new Error('no dwell sample');
      const headChange = Math.max(
        ...samples.map((sample) =>
          Math.hypot(sample.decorativeHead.x - dwellStart.decorativeHead.x, sample.decorativeHead.y - dwellStart.decorativeHead.y),
        ),
      );
      expect(headChange).toBeGreaterThan(0.1);
      expect((await read(page)).targets[first]?.selected).toBe(true);
    });

    const second = Object.keys((await read(page)).targets).find((key) => key.startsWith('stop-1') && key !== first);
    await timed('8 select the second stop-1 target', async () => {
      if (second === undefined) throw new Error('no second stop-1 target');
      await selectTarget(page, area, second);
    });

    await timed('9-12 travel in full: no selection during travel, stop 2 active after arrival, restart', async () => {
      await travelOnce(page, area, DOOR_TO, false);
    });

    await timed('13 travel in gentle', async () => {
      await page.getByRole('radio', { name: LABEL.motionGentle }).check();
      await travelOnce(page, area, DOOR_TO, true);
    });

    await timed('13 travel in reduced: one cover peak, travel from then to', async () => {
      await page.getByRole('radio', { name: LABEL.motionReduced }).check();
      const samples = await travelOnce(page, area, DOOR_TO, true);
      const covers = samples.map((sample) => sample.cover);
      const peak = Math.max(...covers);
      const peakFrame = covers.indexOf(peak);
      expect(peak, `cover peak at recorded frame ${peakFrame}: ${JSON.stringify(samples[peakFrame])}`).toBe(1);
      const peaks = covers.reduce<number>((count, value, index) => (value === 1 && covers[index - 1] !== 1 ? count + 1 : count), 0);
      expect(peaks).toBe(1);
      expect([...new Set(samples.map((sample) => sample.travel))]).toEqual([0, DOOR_TO]);
    });

  });
});
