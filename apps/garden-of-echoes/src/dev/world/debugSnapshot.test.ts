// The read-only debug snapshot (Req 11.7; design 8.2).
import { TUNING as MARROW_TUNING, type Vec2 } from 'marrow/core';
import { createSettingsStore } from 'marrow/react';
import { describe, expect, it } from 'vitest';
import { TUNING as WORLD_TUNING, type ProjectionFrame } from 'world-view';
import { DEFAULT_ASPECT } from './constants';
import { buildSnapshot, type SnapshotExtras } from './debugSnapshot';
import { mouseComfort, placeStops } from './placementSetup';
import { loadWorldContent } from './worldContent';
import { createWorldRun, stepWorldFrame, type FrameReport, type WorldRun } from './worldRun';

const ONE = 1;
const HALF = 0.5;
const FRAME: ProjectionFrame = { aspect: DEFAULT_ASPECT, sceneScale: ONE };

/** Counts the functions in a value graph. A snapshot must hold none. */
function functionsIn(value: unknown, seen = new Set<unknown>()): number {
  if (typeof value === 'function') return ONE;
  if (typeof value !== 'object' || value === null || seen.has(value)) return 0;
  seen.add(value);
  return Object.values(value).reduce<number>((sum, item) => sum + functionsIn(item, seen), 0);
}

/** True when every object of the value graph is frozen. */
function frozenEverywhere(value: unknown, seen = new Set<unknown>()): boolean {
  if (typeof value !== 'object' || value === null || seen.has(value)) return true;
  seen.add(value);
  if (!Object.isFrozen(value)) return false;
  return Object.values(value).every((item) => frozenEverywhere(item, seen));
}

function setup(): { run: WorldRun; report: FrameReport; extras: SnapshotExtras } {
  const loaded = loadWorldContent(FRAME);
  if (!loaded.ok) throw new Error('the forest content is invalid');
  const segment = loaded.content.segments[ONE];
  if (segment === undefined) throw new Error('no door segment');
  const settings = createSettingsStore({ prefix: 'test:', prefersReducedMotion: false, storage: null });
  const comfort = mouseComfort(FRAME.aspect, MARROW_TUNING.hitRadius);
  const placed = placeStops(loaded.content, segment, FRAME, comfort.grids, comfort.mapping, MARROW_TUNING.hitRadius, WORLD_TUNING);
  if (!placed.ok) throw new Error('placement did not start');
  const run = createWorldRun({ content: loaded.content, tuning: WORLD_TUNING, segment, stops: placed.stops, settings, mode: 'mouse' });
  const pointer: Vec2 = { x: HALF * FRAME.aspect, y: HALF };
  const step = stepWorldFrame(run, MARROW_TUNING.maxClockStepMs, {
    paused: false,
    hidden: false,
    frame: FRAME,
    head: { kind: 'pointer', pointer: { valid: true, pos: pointer }, playAspect: FRAME.aspect },
  });
  const extras: SnapshotExtras = {
    canvas: { width: ONE, height: ONE },
    pixelRatio: ONE,
    layers: [{ id: 'layer-0', x: ONE, y: ONE, scale: ONE, visible: true }],
    rendered: [],
    circles: [],
  };
  return { run, report: step.report, extras };
}

describe('debug snapshot', () => {
  it('debug snapshot is frozen and holds no live state', () => {
    const { run, report, extras } = setup();
    const snapshot = buildSnapshot(run, report, extras);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(frozenEverywhere(snapshot)).toBe(true);
    expect(functionsIn(snapshot)).toBe(0);

    const before = JSON.stringify(snapshot);
    // Mutate the live state that the snapshot was taken from: the report and the extras.
    Object.assign(report.view.head, { x: ONE });
    Object.assign(report.interactionHead, { x: ONE });
    Object.assign(report.decorativeHead, { y: ONE });
    const layer = extras.layers[ZERO_INDEX];
    if (layer !== undefined) Object.assign(layer, { x: ONE + ONE });
    Object.assign(extras.canvas, { width: ONE + ONE });
    expect(JSON.stringify(snapshot)).toBe(before);
  });

  it('the snapshot reports every stop target by id, and refuses writes', () => {
    const { run, report, extras } = setup();
    const snapshot = buildSnapshot(run, report, extras);
    const ids = run.config.stops.flatMap((stop) => stop.targets.map((target) => target.id));
    expect(Object.keys(snapshot.targets).sort()).toEqual([...ids].sort());
    expect(() => {
      Object.assign(snapshot.canvas, { width: ONE });
    }).toThrow();
  });
});

const ZERO_INDEX = 0;
