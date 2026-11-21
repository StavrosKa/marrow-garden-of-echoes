// The read-only snapshot of the slice (Req 11.7; design 8.2). It is a copy: plain values only, no
// function and no reference to live state, deep-frozen. Taking it does not change the run.
import { dwellView, type MotionLevel, type Vec2 } from 'marrow/core';
import type { DebugEntry, HitCircle } from 'world-view/pixi';
import type { LockMode, TravelPhase, TravelStyle } from 'world-view';
import type { FrameReport, InputMode, WorldRun } from './worldRun';

const ONE = 1;

/** What the Scene Manager and the DOM know that the run does not: applied values and the canvas. */
export interface SnapshotExtras {
  readonly canvas: { readonly width: number; readonly height: number };
  readonly pixelRatio: number;
  /** The applied values of the layer containers (Scene Manager debugLayers). */
  readonly layers: readonly DebugEntry[];
  /** The applied values of the target display objects (Scene Manager debugTargets). */
  readonly rendered: readonly DebugEntry[];
  /** The hit circles of this frame. */
  readonly circles: readonly HitCircle[];
  /** The hand of this frame: valid, and the position the dwell step received (Req 14.9). */
  readonly pointer: HandSnapshot;
}

export interface HandSnapshot {
  readonly valid: boolean;
  readonly pos: Vec2 | null;
}

export interface TargetSnapshot {
  readonly stop: number;
  readonly active: boolean;
  readonly selected: boolean;
  readonly dwell: { readonly owner: 'left' | 'right' | null; readonly progress: number };
  readonly rendered: { readonly x: number; readonly y: number; readonly scale: number; readonly visible: boolean } | null;
  readonly circle: { readonly centre: Vec2; readonly radius: number } | null;
}

export interface DebugSnapshot {
  readonly inputMode: InputMode;
  readonly driver: { readonly on: boolean; readonly value: Vec2 };
  readonly motion: MotionLevel;
  readonly view: { readonly travel: number; readonly head: Vec2 };
  readonly interactionHead: Vec2;
  readonly decorativeHead: Vec2;
  readonly headOut: Vec2;
  readonly lock: { readonly requested: boolean; readonly mode: LockMode };
  readonly clocks: { readonly rawDt: number; readonly presenceDt: number; readonly sessionDt: number };
  readonly paused: boolean;
  readonly hidden: boolean;
  readonly hold: boolean;
  readonly travel: {
    readonly phase: TravelPhase;
    readonly style: TravelStyle | null;
    readonly level: MotionLevel;
    readonly progress: number;
    readonly cover: number;
    readonly remainingMs: number;
  };
  readonly reward: { readonly elapsedMs: number; readonly started: boolean };
  readonly frame: { readonly aspect: number; readonly sceneScale: number };
  readonly canvas: { readonly width: number; readonly height: number };
  readonly pixelRatio: number;
  readonly placement: readonly {
    readonly id: string;
    readonly kind: 'simultaneous' | 'sequential';
    readonly m: number;
    readonly r: number;
    readonly slots: readonly Vec2[];
  }[];
  readonly comfort: { readonly kind: 'wholeFrame' | 'wholeScreen'; readonly gain: number; readonly calibration: 'none' };
  readonly targets: Readonly<Record<string, TargetSnapshot>>;
  readonly layers: readonly DebugEntry[];
  readonly circles: readonly HitCircle[];
  readonly pointer: HandSnapshot;
}

/** Freezes an object graph in place. Only plain values are passed in, so no function is frozen. */
export function deepFreeze<T>(value: T): Readonly<T> {
  if (typeof value === 'object' && value !== null) {
    for (const key of Reflect.ownKeys(value)) {
      deepFreeze((value as Record<PropertyKey, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

function copyVec(v: Vec2): Vec2 {
  return { x: v.x, y: v.y };
}

function copyEntry(entry: DebugEntry): DebugEntry {
  return { id: entry.id, x: entry.x, y: entry.y, scale: entry.scale, visible: entry.visible };
}

/** The snapshot of one frame: the run's values, the report of the frame and the extras. */
export function buildSnapshot(run: WorldRun, report: FrameReport, extras: SnapshotExtras): DebugSnapshot {
  const { config } = run;
  const renderedById = new Map(extras.rendered.map((entry) => [entry.id, entry]));
  const circleById = new Map(extras.circles.map((circle) => [circle.id, circle]));
  const targets: Record<string, TargetSnapshot> = {};
  config.stops.forEach((stop, stopIndex) => {
    for (const target of stop.targets) {
      const dwell = dwellView(run.dwell, target.id);
      const rendered = renderedById.get(target.id);
      const circle = circleById.get(target.id);
      targets[target.id] = {
        stop: stopIndex + ONE,
        active: report.active.includes(target.id),
        selected: run.selected.includes(target.id),
        dwell: { owner: dwell.owner, progress: dwell.progress },
        rendered:
          rendered === undefined
            ? null
            : { x: rendered.x, y: rendered.y, scale: rendered.scale, visible: rendered.visible },
        circle: circle === undefined ? null : { centre: copyVec(circle.centre), radius: circle.radius },
      };
    }
  });
  return deepFreeze({
    inputMode: config.mode,
    driver: { on: report.driverOn, value: copyVec(report.driverValue) },
    motion: report.level,
    view: { travel: report.view.travel, head: copyVec(report.view.head) },
    interactionHead: copyVec(report.interactionHead),
    decorativeHead: copyVec(report.decorativeHead),
    headOut: copyVec(report.headOut),
    lock: { requested: report.lockRequested, mode: report.lockMode },
    clocks: { rawDt: report.rawDt, presenceDt: report.presenceDt, sessionDt: report.sessionDt },
    paused: report.paused,
    hidden: report.hidden,
    hold: report.hold,
    travel: {
      phase: report.travelPhase,
      style: report.travelStyle,
      level: report.travelLevel,
      progress: report.progress,
      cover: report.cover,
      remainingMs: report.remainingMs,
    },
    reward: { elapsedMs: report.rewardMs, started: report.rewardStarted },
    frame: { aspect: report.frame.aspect, sceneScale: report.frame.sceneScale },
    canvas: { width: extras.canvas.width, height: extras.canvas.height },
    pixelRatio: extras.pixelRatio,
    placement: config.stops.map((stop) => ({
      id: stop.id,
      kind: stop.kind,
      m: stop.m,
      r: stop.r,
      slots: stop.slots.map(copyVec),
    })),
    comfort:
      config.mode === 'camera'
        ? { kind: 'wholeFrame', gain: ONE, calibration: 'none' }
        : { kind: 'wholeScreen', gain: ONE, calibration: 'none' },
    targets,
    layers: extras.layers.map(copyEntry),
    circles: extras.circles.map((circle) => ({ id: circle.id, centre: copyVec(circle.centre), radius: circle.radius })),
    pointer: { valid: extras.pointer.valid, pos: extras.pointer.pos === null ? null : copyVec(extras.pointer.pos) },
  });
}
