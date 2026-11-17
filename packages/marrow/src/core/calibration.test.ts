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
  stepCalibration,
  type CalibrationConfig,
  type CalibrationEvent,
  type CalibrationInput,
  type CalibrationState,
  type HeadLandmarks,
} from './calibration';
import type { Vec2 } from './frame';
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

describe('marrow/core', () => {
  it('exports the painting-phase names (design section 6) but not the calm-hold action yet', () => {
    expect(core.createCalibration).toBe(createCalibration);
    expect(core.stepCalibration).toBe(stepCalibration);
    expect(core.retryCalibration).toBe(retryCalibration);
    expect(core.chooseWholeScreen).toBe(chooseWholeScreen);
  });
});
