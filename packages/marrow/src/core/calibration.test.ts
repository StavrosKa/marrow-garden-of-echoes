import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  cellRectCamera,
  createGrid,
  isCellValid,
  validCells,
  type CellIndex,
  type ComfortGrid,
} from './comfortGrid';
import {
  chooseWholeScreen,
  createCalibration,
  retryCalibration,
  skipHeadView,
  stepCalibration,
  type CalibrationConfig,
  type CalibrationEvent,
  type CalibrationInput,
  type CalibrationState,
  type HeadLandmarks,
} from './calibration';
import type { Landmark, Vec2 } from './frame';
import * as core from './index';
import { makeMapping } from './mapping';
import type { FilteredPointers } from './pointerFilter';
import { placeTargets, type Demand } from './placement';
import { computeComfortTransform, type WristGrids } from './reachGain';
import { genPointerPath } from './testgen';
import { TUNING } from './tuning';

// Every threshold comes from TUNING. The scripts step the presence clock by STEP = the
// largest delta the Clocks return (maxClockStepMs), and each test places its events at
// whole numbers of steps. The rest are named test parameters.

const COLS = TUNING.gridCols;
const ROWS = TUNING.gridRows;
const NEEDED = TUNING.cellValidSamples;
/** The presence delta of each scripted step: the largest the Clocks return. */
const STEP = TUNING.maxClockStepMs;
const HALF = 1 / 2;
/** The identity scale: no reach gain. Not read from reachGainMin, which is a tuning value. */
const IDENTITY_GAIN = 1;
/** A 1920 x 1080 viewport. A test parameter. */
const PLAY_ASPECT = 16 / 9;
/** A 640 x 480 camera image. A test parameter. */
const FRAME_ASPECT = 4 / 3;
/** The hit radius of the small demand: smaller than half a cell on screen, so one valid cell covers its slot. A test parameter. */
const SMALL_RADIUS = 0.01;
/** The start of painting in presence milliseconds: the step count times STEP. */
const ms = (steps: number): number => steps * STEP;
/** The number of whole steps in a duration from TUNING, checking that it is whole. */
function stepsIn(durationMs: number): number {
  const steps = durationMs / STEP;
  expect(Number.isInteger(steps), `${durationMs} ms is a whole number of steps of ${STEP} ms`).toBe(true);
  return steps;
}

const HEAD_OK: HeadLandmarks = {
  nose: { pos: { x: HALF, y: HALF }, valid: true },
  leftShoulder: { pos: { x: 0.7, y: 0.8 }, valid: true },
  rightShoulder: { pos: { x: 0.3, y: 0.8 }, valid: true },
};

/** The camera-space centre of a cell. */
function cellCentre({ col, row }: CellIndex): Vec2 {
  const { x0, y0, x1, y1 } = cellRectCamera(col, row, TUNING);
  return { x: (x0 + x1) * HALF, y: (y0 + y1) * HALF };
}

/** Under frame aspect = play aspect at the identity gain about the play-area centre: the mapping of simulated input (Req 13.7). */
const SIM_MAPPING = makeMapping({
  playAspect: PLAY_ASPECT,
  frameAspect: PLAY_ASPECT,
  gain: IDENTITY_GAIN,
  centre: { x: PLAY_ASPECT * HALF, y: HALF },
});

/** The cell the demand's slot is on, and cells that become valid later. Far apart, so each is valid on its own. */
const CELL_A: CellIndex = { col: 10, row: 10 };
const CELL_B: CellIndex = { col: 20, row: 5 };
/** The i-th fresh cell, in the last row. */
const fresh = (i: number): CellIndex => ({ col: i % COLS, row: ROWS - 1 });

/** A simulated-input configuration whose demand is met exactly when `slotCell` is valid: one slot at its centre, a radius inside the cell. */
function simConfig(slotCell: CellIndex): CalibrationConfig {
  const demand: Demand = { slots: [SIM_MAPPING.toScreen(cellCentre(slotCell))], n: 1, r: SMALL_RADIUS, m: 0 };
  return {
    activeWrists: ['right'],
    mode: 'simulated',
    demand,
    frameAspect: PLAY_ASPECT,
    playAspect: PLAY_ASPECT,
    tuning: TUNING,
  };
}

/** A camera-mode configuration for the right wrist. */
function cameraConfig(demand: Demand): CalibrationConfig {
  return {
    activeWrists: ['right'],
    mode: 'camera',
    demand,
    frameAspect: FRAME_ASPECT,
    playAspect: PLAY_ASPECT,
    tuning: TUNING,
  };
}

/** One scripted step: the right wrist at a cell's centre, or invalid; whether a frame is consumed; the delta. */
interface Move {
  readonly cell: CellIndex | null;
  readonly consumed?: boolean;
  readonly dt?: number;
}

function inputOf(move: Move): CalibrationInput {
  const pointers: FilteredPointers =
    move.cell === null ? { right: { valid: false } } : { right: { valid: true, pos: cellCentre(move.cell) } };
  return { pointers, frameConsumed: move.consumed ?? true, head: HEAD_OK };
}

/** Every state and every step's events of a script. */
interface Played {
  readonly states: CalibrationState[];
  readonly events: CalibrationEvent[][];
}

function play(start: CalibrationState, moves: readonly Move[]): Played {
  const states: CalibrationState[] = [];
  const events: CalibrationEvent[][] = [];
  let state = start;
  for (const move of moves) {
    const step = stepCalibration(state, inputOf(move), move.dt ?? STEP);
    state = step.state;
    states.push(state);
    events.push([...step.events]);
  }
  return { states, events };
}

/** The 1-based number of the step in which painting ended, or null. */
function endedAt(played: Played): number | null {
  const i = played.events.findIndex((step) => step.some((e) => e.kind === 'paintingEnded'));
  return i < 0 ? null : i + 1;
}

/** Steps that paint `cell` until it is valid: NEEDED consumed frames at its centre. */
const paint = (cell: CellIndex): Move[] => Array.from({ length: NEEDED }, () => ({ cell }));
/** `count` steps with the wrist valid on a cell, which add samples but make no new cell valid when that cell is already valid. */
const rest = (cell: CellIndex, count: number): Move[] => Array.from({ length: count }, () => ({ cell }));
const invalid = (count: number): Move[] => Array.from({ length: count }, () => ({ cell: null }));

describe('calibration thresholds are whole steps', () => {
  it('every threshold the scripts use divides into steps of maxClockStepMs', () => {
    for (const value of [
      TUNING.calibNominalMs,
      TUNING.calibEarliestMs,
      TUNING.calibCapMs,
      TUNING.calibEarlyQuietMs,
      TUNING.calibHandHintMs,
    ]) {
      stepsIn(value);
    }
  });
});

describe('stepCalibration, painting phase: the end rules at their exact boundaries (Req 11.6, 11.7, 11.9, 11.10)', () => {
  it('creates one empty grid per active wrist and a painting state (Req 11.1)', () => {
    const both = createCalibration({ ...simConfig(CELL_A), activeWrists: ['left', 'right'] });
    expect(both.phase).toBe('painting');
    expect(Object.keys(both.grids).sort()).toEqual(['left', 'right']);
    expect(both.grids.left).toEqual(createGrid(TUNING));
    expect(both.grids.right).toEqual(createGrid(TUNING));
    expect(both.paintingMs).toBe(0);
    expect(both.demandMet).toBe(false);
    const one = createCalibration(simConfig(CELL_A));
    expect(Object.keys(one.grids)).toEqual(['right']);
  });

  it('20 s with the demand met ends painting in exactly that step, one step earlier it does not (Req 11.6)', () => {
    // A cell becomes valid every 1.4 s, so the early rule never holds. The demand is met from 0.4 s.
    const GROUP = 14;
    const total = stepsIn(TUNING.calibNominalMs) + 50;
    const moves: Move[] = [];
    for (let s = 0; s < total; s++) {
      const group = Math.floor(s / GROUP);
      const at = s % GROUP;
      moves.push({ cell: at < NEEDED ? (group === 0 ? CELL_A : fresh(group)) : CELL_A });
    }
    const played = play(createCalibration(simConfig(CELL_A)), moves);
    const nominal = stepsIn(TUNING.calibNominalMs);
    const before = played.states[nominal - 2];
    expect(before?.paintingMs).toBe(ms(nominal - 1));
    expect(before?.phase).toBe('painting');
    expect(before?.demandMet).toBe(true);
    expect(endedAt(played)).toBe(nominal);
    expect(played.states[nominal - 1]?.paintingMs).toBe(TUNING.calibNominalMs);
    expect(played.events[nominal - 1]).toEqual([{ kind: 'paintingEnded', reason: 'nominal' }]);
    expect(played.states[nominal - 1]?.phase).toBe('calm');
  });

  it('early rule: with the demand met and no cell valid for calibEarlyQuietMs, painting ends at exactly last-valid + quiet, one step earlier it does not (Req 11.7)', () => {
    const quiet = stepsIn(TUNING.calibEarlyQuietMs);
    const earliest = stepsIn(TUNING.calibEarliestMs);
    // The last cell becomes valid at step `lastValid` (time ms(lastValid)); choose it so that
    // lastValid + quiet is after the earliest time.
    const lastValid = earliest - quiet + 1;
    const moves = [
      ...paint(CELL_A),
      ...rest(CELL_A, lastValid - 2 * NEEDED),
      ...paint(fresh(0)),
      ...rest(CELL_A, 40),
    ];
    expect(moves.slice(0, lastValid).length).toBe(lastValid);
    const played = play(createCalibration(simConfig(CELL_A)), moves);
    expect(played.states[lastValid - 1]?.lastValidAtMs).toBe(ms(lastValid));
    const end = lastValid + quiet;
    expect(end).toBeGreaterThan(earliest);
    expect(played.states[end - 2]?.phase).toBe('painting');
    expect(endedAt(played)).toBe(end);
    expect(played.events[end - 1]).toEqual([{ kind: 'paintingEnded', reason: 'early' }]);
  });

  it('early rule never ends before calibEarliestMs: quiet since long ago, painting still ends at exactly that time (Req 11.10)', () => {
    const earliest = stepsIn(TUNING.calibEarliestMs);
    const moves = [...paint(CELL_A), ...rest(CELL_A, earliest + 20)];
    const played = play(createCalibration(simConfig(CELL_A)), moves);
    // The demand has been met and the quiet time has held since step NEEDED, long before earliest.
    expect(played.states[earliest - 2]?.demandMet).toBe(true);
    expect(played.states[earliest - 2]?.phase).toBe('painting');
    expect(endedAt(played)).toBe(earliest);
    expect(played.events[earliest - 1]).toEqual([{ kind: 'paintingEnded', reason: 'early' }]);
  });

  it('the quiet time runs from the start of painting while no cell is valid: the demand met late ends painting no sooner than quiet after it (Req 11.7)', () => {
    // The slot is on CELL_B. CELL_A is valid at 0.4 s but does not meet the demand, so nothing ends
    // painting at the earliest time. CELL_B becomes valid at step `late`; painting ends quiet after it.
    const quiet = stepsIn(TUNING.calibEarlyQuietMs);
    const earliest = stepsIn(TUNING.calibEarliestMs);
    const late = earliest + 2 * quiet;
    const moves = [
      ...paint(CELL_A),
      ...rest(CELL_A, late - 2 * NEEDED),
      ...paint(CELL_B),
      ...rest(CELL_B, 3 * quiet),
    ];
    const played = play(createCalibration(simConfig(CELL_B)), moves);
    expect(played.states[late - 2]?.demandMet).toBe(false);
    expect(played.states[late - 1]?.demandMet).toBe(true);
    expect(played.states[late - 1]?.lastValidAtMs).toBe(ms(late));
    // No end at the earliest time or later, although the quiet time held then.
    expect(played.states[late - 2]?.phase).toBe('painting');
    expect(played.states[late + quiet - 2]?.phase).toBe('painting');
    expect(endedAt(played)).toBe(late + quiet);
    expect(played.events[late + quiet - 1]).toEqual([{ kind: 'paintingEnded', reason: 'early' }]);
  });

  it('the demand is not met: nothing ends painting at 12 s or 20 s, and it ends at exactly the cap (Req 11.9)', () => {
    const cap = stepsIn(TUNING.calibCapMs);
    // Painting time counts only steps with a valid wrist, so 25 invalid steps in the middle move the end by none.
    const gap = 25;
    const half = 120;
    const moves = [...paint(CELL_A), ...rest(CELL_A, half), ...invalid(gap), ...rest(CELL_A, cap)];
    const played = play(createCalibration(simConfig(CELL_B)), moves);
    expect(endedAt(played)).toBe(cap + gap);
    const last = played.states[cap + gap - 1];
    expect(last?.paintingMs).toBe(TUNING.calibCapMs);
    expect(played.events[cap + gap - 1]).toEqual([{ kind: 'paintingEnded', reason: 'cap' }]);
    const before = played.states[cap + gap - 2];
    expect(before?.paintingMs).toBe(ms(cap - 1));
    expect(before?.phase).toBe('painting');
    expect(before?.demandMet).toBe(false);
  });

  it('the cap ends painting while new cells are still becoming valid, and the calm hold state follows (Req 11.9, 12.1)', () => {
    // A new cell becomes valid every 1.4 s up to the end, and the demand is not met.
    const cap = stepsIn(TUNING.calibCapMs);
    const moves: Move[] = [];
    for (let s = 0; s < cap + 5; s++) moves.push({ cell: s % 14 < NEEDED ? fresh(Math.floor(s / 14)) : CELL_A });
    const played = play(createCalibration(simConfig(CELL_B)), moves);
    expect(endedAt(played)).toBe(cap);
    expect(played.states[cap - 1]?.phase).toBe('calm');
  });

  it('painting time counts only steps with a valid active wrist, and only wrists in the configuration (Req 11.5)', () => {
    const state0 = createCalibration(simConfig(CELL_A));
    const invalidStep = stepCalibration(state0, inputOf({ cell: null }), STEP).state;
    expect(invalidStep.paintingMs).toBe(0);
    const validStep = stepCalibration(invalidStep, inputOf({ cell: CELL_A }), STEP).state;
    expect(validStep.paintingMs).toBe(STEP);
    // A step with a delta of 0 adds nothing, and a missing pointer is invalid.
    const zero = stepCalibration(validStep, inputOf({ cell: CELL_A }), 0).state;
    expect(zero.paintingMs).toBe(STEP);
    const missing = stepCalibration(zero, { pointers: {}, frameConsumed: true, head: HEAD_OK }, STEP).state;
    expect(missing.paintingMs).toBe(STEP);
    // The left wrist is not active in this configuration: neither its time nor its samples count.
    const left: FilteredPointers = { left: { valid: true, pos: cellCentre(CELL_A) }, right: { valid: false } };
    const ignored = stepCalibration(missing, { pointers: left, frameConsumed: true, head: HEAD_OK }, STEP).state;
    expect(ignored.paintingMs).toBe(STEP);
    expect(ignored.grids).toEqual(missing.grids);
    // With both wrists active, either valid wrist counts the time once.
    const both = createCalibration({ ...simConfig(CELL_A), activeWrists: ['left', 'right'] });
    const either = stepCalibration(
      both,
      { pointers: { left: { valid: true, pos: cellCentre(CELL_A) }, right: { valid: true, pos: cellCentre(CELL_B) } }, frameConsumed: true, head: HEAD_OK },
      STEP,
    ).state;
    expect(either.paintingMs).toBe(STEP);
  });

  it('adds no sample after painting has ended (Req 11.8)', () => {
    const cap = stepsIn(TUNING.calibCapMs);
    const played = play(createCalibration(simConfig(CELL_B)), rest(CELL_A, cap));
    const ended = played.states[cap - 1];
    expect(ended?.phase).toBe('calm');
    let state = ended ?? createCalibration(simConfig(CELL_B));
    for (const move of [...paint(fresh(3)), ...paint(fresh(4)), ...rest(CELL_A, 5)]) {
      const step = stepCalibration(state, inputOf(move), STEP);
      expect(step.events).toEqual([]);
      state = step.state;
    }
    expect(state.grids).toEqual(ended?.grids);
    expect(state.paintingMs).toBe(ended?.paintingMs);
  });

  it('runs the demand check only in a step in which a cell became valid (design section 14.2)', () => {
    let reads = 0;
    const config = simConfig(CELL_A);
    const demand: Demand = {
      get slots() {
        reads += 1;
        return config.demand.slots;
      },
      n: config.demand.n,
      r: config.demand.r,
      m: config.demand.m,
    };
    const moves = [...paint(CELL_A), ...rest(CELL_A, 20), ...paint(fresh(0)), ...rest(CELL_A, 5), ...invalid(3)];
    let state = createCalibration({ ...config, demand });
    const readsAfter: number[] = [];
    const validAfter: number[] = [];
    for (const move of moves) {
      state = stepCalibration(state, inputOf(move), STEP).state;
      readsAfter.push(reads);
      validAfter.push(state.validCellCount);
    }
    const checks = readsAfter.map((count, i) => count - (readsAfter[i - 1] ?? 0));
    const becameValid = validAfter.map((count, i) => count - (validAfter[i - 1] ?? 0));
    expect(becameValid.reduce((a, b) => a + b, 0)).toBe(2);
    expect(checks).toEqual(becameValid);
    expect(state.demandMet).toBe(true);
  });

  it('keeps the last computed demand result between checks, and computes it from the grids with the camera-mode transform (Req 11.11, 13)', () => {
    // A 4 x 4 block of cells in the middle, painted one cell after another: valid cells are added in
    // 16 steps, and the stored result must equal Placement on the final grids with the transform
    // computed from them. One cell alone does not cover a disc of the hit radius; the block does.
    const block: CellIndex[] = [];
    for (let row = 10; row < 14; row++) for (let col = 14; col < 18; col++) block.push({ col, row });
    const demand: Demand = { slots: [{ x: PLAY_ASPECT * HALF, y: HALF }], n: 1, r: TUNING.hitRadius, m: 0 };
    const oracle = (grids: WristGrids): boolean => {
      const transform = computeComfortTransform(grids, FRAME_ASPECT, PLAY_ASPECT, TUNING);
      const mapping = makeMapping({ playAspect: PLAY_ASPECT, frameAspect: FRAME_ASPECT, ...transform });
      return placeTargets(demand, grids, mapping, TUNING).kind === 'simultaneous';
    };
    const config = cameraConfig(demand);
    const single = play(createCalibration(config), [...paint(CELL_A), ...rest(CELL_A, 10)]).states.at(-1);
    expect(single?.demandMet).toBe(false);
    expect(single?.demandMet).toBe(oracle(single?.grids ?? {}));
    const painted = play(createCalibration(config), [...block.flatMap(paint), ...rest(block[0] ?? CELL_A, 10)]).states.at(-1);
    expect(painted?.demandMet).toBe(true);
    expect(painted?.demandMet).toBe(oracle(painted?.grids ?? {}));
  });
});

describe('stepCalibration, the calibration hand hint (Req 11.12)', () => {
  const hintMs = TUNING.calibHandHintMs;
  const hintSteps = stepsIn(hintMs);
  const camera = (): CalibrationState =>
    createCalibration(cameraConfig({ slots: [], n: 1, r: TUNING.hitRadius, m: 0 }));

  it('shows after more than calibHandHintMs without a valid wrist, not at exactly that time, from the start of painting', () => {
    const played = play(camera(), invalid(hintSteps + 1));
    expect(played.states[hintSteps - 2]?.handHint).toBe(false);
    expect(played.states[hintSteps - 1]?.noWristMs).toBe(hintMs);
    expect(played.states[hintSteps - 1]?.handHint).toBe(false);
    expect(played.states[hintSteps]?.handHint).toBe(true);
  });

  it('hides in the step a wrist is valid and restarts its timer from zero', () => {
    const played = play(camera(), [...invalid(hintSteps + 3), ...rest(CELL_A, 1), ...invalid(hintSteps + 1)]);
    const valid = hintSteps + 3;
    expect(played.states[valid - 1]?.handHint).toBe(true);
    expect(played.states[valid]?.handHint).toBe(false);
    expect(played.states[valid]?.noWristMs).toBe(0);
    expect(played.states[valid + hintSteps]?.handHint).toBe(false);
    expect(played.states[valid + hintSteps + 1]?.handHint).toBe(true);
  });

  it('runs on the presence delta it is given: steps of delta 0 never show it', () => {
    const played = play(camera(), Array.from({ length: 5 * hintSteps }, () => ({ cell: null, dt: 0 })));
    expect(played.states.some((s) => s.handHint)).toBe(false);
    expect(played.states.at(-1)?.noWristMs).toBe(0);
  });

  it('is never shown in simulated-input mode, and not after painting ended', () => {
    const sim = play(createCalibration(simConfig(CELL_A)), invalid(3 * hintSteps));
    expect(sim.states.some((s) => s.handHint)).toBe(false);
    const cap = stepsIn(TUNING.calibCapMs);
    const ended = play(camera(), [...rest(CELL_A, cap), ...invalid(2 * hintSteps)]);
    expect(ended.states[cap - 1]?.phase).toBe('calm');
    expect(ended.states.slice(cap - 1).some((s) => s.handHint)).toBe(false);
  });
});

describe('retryCalibration (Req 11.13)', () => {
  it('clears every grid, every timer and the result, and restarts painting, at any point', () => {
    const config = simConfig(CELL_A);
    const fresh0 = createCalibration(config);
    const mid = play(fresh0, [...paint(CELL_A), ...rest(CELL_A, 30), ...invalid(15)]).states.at(-1);
    expect(mid?.paintingMs).toBeGreaterThan(0);
    expect(retryCalibration(mid ?? fresh0)).toEqual({ state: fresh0, events: [] });
    const whole = chooseWholeScreen(mid ?? fresh0).state;
    expect(whole.phase).toBe('complete');
    expect(retryCalibration(whole).state).toEqual(fresh0);
    const cap = stepsIn(TUNING.calibCapMs);
    const calm = play(createCalibration(simConfig(CELL_B)), rest(CELL_A, cap)).states.at(-1);
    expect(calm?.phase).toBe('calm');
    expect(retryCalibration(calm ?? fresh0).state).toEqual(createCalibration(simConfig(CELL_B)));
  });
});

describe('chooseWholeScreen (Req 11.15, 11.16)', () => {
  it('in simulated input marks every cell of the pointer grid valid and completes at once, with no head data and the identity transform', () => {
    const start = createCalibration(simConfig(CELL_A));
    const mid = play(start, rest(CELL_A, 7)).states.at(-1) ?? start;
    const { state, events } = chooseWholeScreen(mid);
    expect(state.phase).toBe('complete');
    expect(state.grids.right?.allValid).toBe(true);
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) expect(isCellValid(state.grids.right ?? createGrid(TUNING), col, row, TUNING)).toBe(true);
    }
    expect(events).toEqual([
      { kind: 'paintingEnded', reason: 'wholeScreen' },
      { kind: 'completed', result: state.result },
    ]);
    expect(state.result?.head).toBeNull();
    expect(state.result?.transform).toEqual({ centre: { x: PLAY_ASPECT * HALF, y: HALF }, gain: IDENTITY_GAIN });
    expect(state.result?.grids).toBe(state.grids);
    // The samples painted so far stay as counts: the mark does not change them.
    expect(state.grids.right?.counts).toEqual(mid.grids.right?.counts);
    // Nothing more happens after completion.
    const after = stepCalibration(state, inputOf({ cell: fresh(2) }), STEP);
    expect(after).toEqual({ state, events: [] });
    expect(chooseWholeScreen(state)).toEqual({ state, events: [] });
  });

  it('in camera mode it does nothing: the Setup UI never offers it there', () => {
    const state = createCalibration(cameraConfig({ slots: [], n: 1, r: TUNING.hitRadius, m: 0 }));
    expect(chooseWholeScreen(state)).toEqual({ state, events: [] });
    const both = createCalibration({ ...cameraConfig(state.cfg.demand), activeWrists: ['left', 'right'] });
    expect(chooseWholeScreen(both)).toEqual({ state: both, events: [] });
  });
});

describe('stepCalibration leaves its arguments unchanged', () => {
  it('the state, the input and the configuration are deep-equal to what they were', () => {
    const config = simConfig(CELL_A);
    const start = createCalibration(config);
    const state = play(start, [...paint(CELL_A), ...rest(CELL_A, 3)]).states.at(-1) ?? start;
    const input = inputOf({ cell: fresh(1) });
    const before = structuredClone({ state, input });
    stepCalibration(state, input, STEP);
    chooseWholeScreen(state);
    retryCalibration(state);
    expect({ state, input }).toStrictEqual(before);
  });
});

// calibration_cell_needs_own_samples (Req 11.4, design section 10.2): driven through
// stepCalibration with valid and invalid frames from genPointerPath, some of them not
// consumed, and compared with an independent per-cell count. The oracle finds each
// sample's cell by scanning the half-open rectangles of cellRectCamera, not with cellIndex.

const COLUMN_STARTS = Array.from({ length: COLS }, (_, col) => cellRectCamera(col, 0, TUNING).x0);
const ROW_STARTS = Array.from({ length: ROWS }, (_, row) => cellRectCamera(0, row, TUNING).y0);

/** The index of the cell that holds v, for v in 0..1: the last cell that starts at or before v (Req 11.2). */
function cellOn(starts: readonly number[], v: number): number {
  let i = 0;
  while (i + 1 < starts.length && (starts[i + 1] ?? Infinity) <= v) i++;
  return i;
}

/** The longest scripted path: genPointerPath makes at most 5 gaps of 2 s and 5 runs of 10 steps of 100 ms, far below the earliest end. */
it(
  'calibration_cell_needs_own_samples',
  () => {
    fc.assert(
      fc.property(
        genPointerPath().chain((path) =>
          fc.tuple(fc.constant(path), fc.array(fc.boolean(), { minLength: path.length, maxLength: path.length })),
        ),
        ([path, consumed]) => {
          let state = createCalibration(simConfig(CELL_A));
          const own = new Array<number>(COLS * ROWS).fill(0);
          path.forEach((step, i) => {
            const frameConsumed = consumed[i] ?? false;
            const pointers: FilteredPointers = { right: step.valid ? { valid: true, pos: step.pos } : { valid: false } };
            state = stepCalibration(state, { pointers, frameConsumed, head: HEAD_OK }, step.dtMs).state;
            if (step.valid && frameConsumed) {
              const at = cellOn(ROW_STARTS, step.pos.y) * COLS + cellOn(COLUMN_STARTS, step.pos.x);
              own[at] = (own[at] ?? 0) + 1;
            }
          });
          expect(state.phase, 'the path is too short to end painting').toBe('painting');
          const grid: ComfortGrid = state.grids.right ?? createGrid(TUNING);
          for (let row = 0; row < ROWS; row++) {
            for (let col = 0; col < COLS; col++) {
              const samples = own[row * COLS + col] ?? 0;
              // A cell holds exactly the samples that fell in it, and is valid iff there are enough of them.
              expect(grid.counts[row * COLS + col], `samples in (${col}, ${row})`).toBe(samples);
              expect(isCellValid(grid, col, row, TUNING), `validity of (${col}, ${row})`).toBe(samples >= NEEDED);
            }
          }
          expect(validCells(grid, TUNING).length).toBe(own.filter((count) => count >= NEEDED).length);
        },
      ),
      { numRuns: 200 },
    );
  },
  60_000,
);

// ---------------------------------------------------------------------------------
// The calm hold, "Skip head view" and completion (Req 12, task 9.2).

/** One step of the calm hold: the head landmarks of the latest frame, whether it is a new frame, and the delta. */
interface CalmMove {
  readonly head: HeadLandmarks;
  readonly consumed?: boolean;
  readonly dt?: number;
}

const landmark = (x: number, y: number, valid = true): Landmark => ({ pos: { x, y }, valid });

/**
 * Head landmarks that differ from frame to frame, all inside the frame: the head moves and the
 * shoulders drift, since the calm hold does not need the head to be still (Req 12.5).
 */
function headAt(i: number, valid: { nose?: boolean; left?: boolean; right?: boolean } = {}): HeadLandmarks {
  const DRIFT = 0.004;
  return {
    nose: landmark(0.45 + DRIFT * i, 0.3 + DRIFT * (i % 5), valid.nose ?? true),
    leftShoulder: landmark(0.7 + DRIFT * (i % 3), 0.75 + DRIFT * i, valid.left ?? true),
    rightShoulder: landmark(0.25 + DRIFT * (i % 4), 0.78, valid.right ?? true),
  };
}

const goodMove = (i: number, extra: Partial<CalmMove> = {}): CalmMove => ({ head: headAt(i), ...extra });
const good = (count: number, from = 0): CalmMove[] => Array.from({ length: count }, (_, i) => goodMove(from + i));

function calmInput(move: CalmMove): CalibrationInput {
  return { pointers: { right: { valid: false } }, frameConsumed: move.consumed ?? true, head: move.head };
}

function playCalm(start: CalibrationState, moves: readonly CalmMove[]): Played {
  const states: CalibrationState[] = [];
  const events: CalibrationEvent[][] = [];
  let state = start;
  for (const move of moves) {
    const step = stepCalibration(state, calmInput(move), move.dt ?? STEP);
    state = step.state;
    states.push(state);
    events.push([...step.events]);
  }
  return { states, events };
}

/** A simulated-input calibration whose painting phase has just ended. */
function simCalm(): CalibrationState {
  const earliest = stepsIn(TUNING.calibEarliestMs);
  const state = play(createCalibration(simConfig(CELL_A)), rest(CELL_A, earliest)).states.at(-1);
  expect(state?.phase).toBe('calm');
  return state ?? createCalibration(simConfig(CELL_A));
}

/** A camera-mode calibration whose painting phase has ended at the cap, with one valid cell. */
function cameraCalm(): CalibrationState {
  const cap = stepsIn(TUNING.calibCapMs);
  const config = cameraConfig({ slots: [], n: 1, r: TUNING.hitRadius, m: 0 });
  const state = play(createCalibration(config), rest(CELL_A, cap)).states.at(-1);
  expect(state?.phase).toBe('calm');
  return state ?? createCalibration(config);
}

const completedAt = (played: Played): number | null => {
  const i = played.events.findIndex((step) => step.some((e) => e.kind === 'completed'));
  return i < 0 ? null : i + 1;
};

describe('the calm hold (Req 12.1-12.5)', () => {
  const calmSteps = stepsIn(TUNING.calmHoldMs);

  it('starts when painting ends, in the next step: the step that ended painting adds nothing to it (Req 12.1)', () => {
    const calm = simCalm();
    expect(calm.calm).toEqual(createCalibration(simConfig(CELL_A)).calm);
    expect(calm.keepInView).toBe(false);
    expect(calm.skipOffered).toBe(false);
    expect(calm.result).toBeNull();
  });

  it('completes in exactly the step in which calmHoldMs of valid presence time is reached, one step earlier it does not (Req 12.2)', () => {
    const played = playCalm(simCalm(), good(calmSteps + 5));
    expect(played.states[calmSteps - 2]?.phase).toBe('calm');
    expect(played.states[calmSteps - 2]?.calm.validMs).toBe(ms(calmSteps - 1));
    expect(completedAt(played)).toBe(calmSteps);
    expect(played.states[calmSteps - 1]?.phase).toBe('complete');
    expect(played.events.slice(calmSteps).every((events) => events.length === 0)).toBe(true);
  });

  it('an invalid nose or shoulder in a consumed frame restarts the time, just before the end as well, and raises the keep-in-view flag until all three are valid (Req 12.3)', () => {
    for (const bad of [{ nose: false }, { left: false }, { right: false }]) {
      const moves: CalmMove[] = [
        ...good(calmSteps - 1),
        { head: headAt(0, bad) },
        ...good(calmSteps - 1),
        ...good(1, 40),
      ];
      const played = playCalm(simCalm(), moves);
      const restartAt = calmSteps; // 1-based step of the invalid frame
      expect(played.states[restartAt - 2]?.keepInView).toBe(false);
      expect(played.states[restartAt - 1]?.keepInView).toBe(true);
      expect(played.states[restartAt - 1]?.calm.validMs).toBe(0);
      expect(played.states[restartAt - 1]?.calm.frames).toBe(0);
      // The first valid frame lowers the flag and its own dt is counted.
      expect(played.states[restartAt]?.keepInView).toBe(false);
      expect(played.states[restartAt]?.calm.validMs).toBe(STEP);
      // Not complete one step before the new 2 s are full, complete at it.
      expect(completedAt(played)).toBe(restartAt + calmSteps);
      expect(played.states[restartAt + calmSteps - 2]?.phase).toBe('calm');
    }
  });

  it('judges the head only in consumed frames: steps without one count while the last frame was valid, and not before the first (Req 12.2)', () => {
    // 5 steps with no frame at all: nothing is known yet, so no time counts.
    const before = playCalm(simCalm(), Array.from({ length: 5 }, () => goodMove(0, { consumed: false })));
    expect(before.states.at(-1)?.calm.validMs).toBe(0);
    // Then one consumed frame and unconsumed steps: they count, so it completes after calmSteps steps from the frame.
    const moves = [...before.states.map(() => goodMove(0, { consumed: false })), goodMove(0), ...Array.from({ length: calmSteps }, () => goodMove(1, { consumed: false }))];
    const played = playCalm(simCalm(), moves);
    expect(completedAt(played)).toBe(5 + calmSteps);
    // An unconsumed step with an invalid head in its input restarts nothing: only a consumed frame can.
    const held = playCalm(simCalm(), [goodMove(0), { head: headAt(0, { nose: false }), consumed: false }]);
    expect(held.states[1]?.keepInView).toBe(false);
    expect(held.states[1]?.calm.validMs).toBe(2 * STEP);
  });

  it('with the presence clock stopped (delta 0) time stands still and nothing restarts (Req 12.2)', () => {
    const moves: CalmMove[] = [
      ...good(calmSteps - 1),
      ...Array.from({ length: 30 }, () => goodMove(3, { consumed: false, dt: 0 })),
      goodMove(4),
    ];
    const played = playCalm(simCalm(), moves);
    expect(played.states[calmSteps - 1 + 29]?.calm.validMs).toBe(ms(calmSteps - 1));
    expect(played.states[calmSteps - 1 + 29]?.phase).toBe('calm');
    expect(completedAt(played)).toBe(calmSteps + 30);
  });

  it('the wrists are not needed, and the head need not be still (Req 12.5)', () => {
    // The pointers are invalid in every scripted step, and the head moves in every frame.
    const played = playCalm(cameraCalm(), good(calmSteps));
    expect(completedAt(played)).toBe(calmSteps);
    expect(played.states[calmSteps - 1]?.result?.head).not.toBeNull();
  });
});

describe('the neutral head data (Req 12.4)', () => {
  const calmSteps = stepsIn(TUNING.calmHoldMs);

  /** The expected mean over consumed frames, computed here with the aspect-corrected distance written out. */
  function expectedMeans(heads: readonly HeadLandmarks[], aspect: number) {
    const n = heads.length;
    const nose = {
      x: heads.reduce((sum, h) => sum + h.nose.pos.x, 0) / n,
      y: heads.reduce((sum, h) => sum + h.nose.pos.y, 0) / n,
    };
    const shoulderWidth =
      heads.reduce((sum, h) => {
        const dx = (h.leftShoulder.pos.x - h.rightShoulder.pos.x) * aspect;
        const dy = h.leftShoulder.pos.y - h.rightShoulder.pos.y;
        return sum + Math.sqrt(dx * dx + dy * dy);
      }, 0) / n;
    return { nose, shoulderWidth };
  }

  it('records the mean nose and the mean aspect-corrected shoulder distance over the frames of the completing stretch, the last frame included', () => {
    const moves = good(calmSteps);
    const played = playCalm(cameraCalm(), moves);
    const head = played.states[calmSteps - 1]?.result?.head;
    const want = expectedMeans(moves.map((m) => m.head), FRAME_ASPECT);
    expect(head?.nose.x).toBeCloseTo(want.nose.x, 12);
    expect(head?.nose.y).toBeCloseTo(want.nose.y, 12);
    expect(head?.shoulderWidth).toBeCloseTo(want.shoulderWidth, 12);
    // The aspect correction matters here: the same frames at aspect 1 give another width.
    const flat = expectedMeans(moves.map((m) => m.head), IDENTITY_GAIN);
    expect(Math.abs((head?.shoulderWidth ?? 0) - flat.shoulderWidth)).toBeGreaterThan(1e-3);
  });

  it('after a restart only the frames since it count; frames before it are not in the mean', () => {
    const before = good(calmSteps - 1, 100);
    const after = good(calmSteps, 0);
    const played = playCalm(cameraCalm(), [...before, { head: headAt(0, { nose: false }) }, ...after]);
    const head = played.states.at(-1)?.result?.head;
    const want = expectedMeans(after.map((m) => m.head), FRAME_ASPECT);
    expect(head?.nose.x).toBeCloseTo(want.nose.x, 12);
    expect(head?.shoulderWidth).toBeCloseTo(want.shoulderWidth, 12);
  });

  it('steps without a new frame add no sample: the mean is over the consumed frames only', () => {
    const frames = good(calmSteps / 2);
    const moves: CalmMove[] = [...frames, ...Array.from({ length: calmSteps / 2 }, () => goodMove(99, { consumed: false }))];
    const played = playCalm(cameraCalm(), moves);
    expect(completedAt(played)).toBe(calmSteps);
    const head = played.states.at(-1)?.result?.head;
    const want = expectedMeans(frames.map((m) => m.head), FRAME_ASPECT);
    expect(head?.nose.x).toBeCloseTo(want.nose.x, 12);
    expect(head?.nose.y).toBeCloseTo(want.nose.y, 12);
    expect(head?.shoulderWidth).toBeCloseTo(want.shoulderWidth, 12);
  });
});

describe('completion (Req 12.8, 13.7)', () => {
  const calmSteps = stepsIn(TUNING.calmHoldMs);

  it('in camera mode emits one completion event with the grids, the transform computed from them once, and the head data', () => {
    const start = cameraCalm();
    const played = playCalm(start, [...good(calmSteps), ...good(10, 50)]);
    const done = played.states[calmSteps - 1];
    const transform = computeComfortTransform(start.grids, FRAME_ASPECT, PLAY_ASPECT, TUNING);
    expect(played.events[calmSteps - 1]).toEqual([{ kind: 'completed', result: done?.result }]);
    expect(done?.result?.grids).toEqual(start.grids);
    expect(done?.result?.transform).toEqual(transform);
    expect(done?.result?.head).not.toBeNull();
    // Nothing more is emitted or changed after completion.
    expect(played.states.at(-1)).toBe(done);
    expect(played.events.slice(calmSteps).flat()).toEqual([]);
  });

  it('in simulated input the calm hold completes after calmHoldMs, and the transform is the identity gain about the play-area centre', () => {
    const start = simCalm();
    const played = playCalm(start, good(calmSteps));
    expect(completedAt(played)).toBe(calmSteps);
    expect(played.states[calmSteps - 2]?.phase).toBe('calm');
    const result = played.states[calmSteps - 1]?.result;
    expect(result?.transform).toEqual({ centre: { x: PLAY_ASPECT * HALF, y: HALF }, gain: IDENTITY_GAIN });
    expect(result?.head).not.toBeNull();
    expect(result?.grids).toEqual(start.grids);
  });
});

describe('"Skip head view" (Req 12.6, 12.7)', () => {
  const calmSteps = stepsIn(TUNING.calmHoldMs);
  const skipSteps = stepsIn(TUNING.skipHeadViewAfterMs);

  it('the offer appears exactly at skipHeadViewAfterMs of presence time since the calm hold started, restarts included', () => {
    // An invalid consumed frame in every step: the hold restarts all the time and never completes.
    const played = playCalm(simCalm(), Array.from({ length: skipSteps + 3 }, () => ({ head: headAt(0, { nose: false }) })));
    expect(played.states[skipSteps - 2]?.skipOffered).toBe(false);
    expect(played.states[skipSteps - 2]?.calm.elapsedMs).toBe(ms(skipSteps - 1));
    expect(played.states[skipSteps - 1]?.skipOffered).toBe(true);
    expect(played.states.at(-1)?.skipOffered).toBe(true);
    expect(played.states.at(-1)?.keepInView).toBe(true);
    expect(completedAt(played)).toBeNull();
  });

  it('the offer is not shown before the calm hold, and completing the hold in time does not need it', () => {
    expect(simCalm().skipOffered).toBe(false);
    expect(calmSteps).toBeLessThan(skipSteps);
  });

  it('completes without head data, with the grids and the transform, and does nothing outside the calm hold', () => {
    const calm = cameraCalm();
    const { state, events } = skipHeadView(calm);
    expect(state.phase).toBe('complete');
    expect(state.result?.head).toBeNull();
    expect(state.result?.grids).toEqual(calm.grids);
    expect(state.result?.transform).toEqual(computeComfortTransform(calm.grids, FRAME_ASPECT, PLAY_ASPECT, TUNING));
    expect(events).toEqual([{ kind: 'completed', result: state.result }]);
    expect(skipHeadView(state)).toEqual({ state, events: [] });
    const painting = createCalibration(simConfig(CELL_A));
    expect(skipHeadView(painting)).toEqual({ state: painting, events: [] });
    // After completion nothing more happens.
    expect(stepCalibration(state, calmInput(goodMove(0)), STEP)).toEqual({ state, events: [] });
  });

  it('leaves the state it is given unchanged', () => {
    const calm = cameraCalm();
    const before = structuredClone(calm);
    skipHeadView(calm);
    expect(calm).toStrictEqual(before);
  });
});

describe('marrow/core', () => {
  it('exports the calibration names (design section 6)', () => {
    expect(core.createCalibration).toBe(createCalibration);
    expect(core.stepCalibration).toBe(stepCalibration);
    expect(core.retryCalibration).toBe(retryCalibration);
    expect(core.chooseWholeScreen).toBe(chooseWholeScreen);
    expect(core.skipHeadView).toBe(skipHeadView);
  });
});
