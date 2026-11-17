// Calibration (Requirements 11-13, design sections 1, 3 and 14.2): the painting phase, in
// which the player moves each active hand to fill one comfort grid per active wrist.
// A pure reducer: stepCalibration(state, input, dtMs) -> { state, events }, with dtMs the
// presence delta of this step (Req 16.7). dtMs is trusted as it is: the Clocks already
// clamp it to 0..maxClockStepMs (Req 16.2), and it is not clamped a second time here.
//
// Decisions the requirements leave open (each is recorded in docs/kiro-journal.md):
//  - Painting time (Req 11.5) is the sum of dtMs over steps in which at least one active
//    wrist's pointer is valid. Every painting-time stamp below is that clock, read after
//    this step's dtMs was added.
//  - "No cell became valid during the last 2 s of painting time" (Req 11.7) is measured
//    from lastValidAtMs, the painting time of the step in which a cell of any active wrist
//    last became valid. Before any cell is valid it is 0, the start of painting, so the
//    quiet time is then the whole painting time. The rule holds when
//    paintingMs - lastValidAtMs >= calibEarlyQuietMs: a cell that became valid exactly
//    calibEarlyQuietMs ago is outside the window.
//  - The demand result (Req 11.11) is computed only in steps in which a cell became valid
//    (design section 14.2) and kept in demandMet; the end rules of Req 11.6 and 11.7 read
//    that last result. Counts only grow during painting, so the set of valid cells, and with
//    it the result, can change only in such a step. Before the first computation it is false.
//  - At the cap (Req 11.9) painting ends whether or not the demand is met; the calm hold
//    then starts as for any other end (Req 12.1), and the completion event carries the
//    grids as they are. The app re-runs Placement on them to choose the result (design
//    section 14.2), so nothing about the demand needs to travel in the event.
//  - Req 11.15: "the pointer's grid" is the grid of the one active wrist in simulated-input
//    mode, the right wrist (Req 6.1). chooseWholeScreen marks the grid of every active
//    wrist in simulated-input mode, which is that one grid. In camera mode it does nothing:
//    the Setup UI never offers it there (Req 11.16), and it would otherwise skip the calm
//    hold and invent comfort that was never painted.
//  - Req 11.12: the hand hint runs on the presence clock, from the input dtMs, never on
//    raw time. noWristMs is the presence time since the last step with a valid active wrist
//    or since painting started, and is 0 again in any step with a valid wrist. The hint
//    shows while noWristMs > calibHandHintMs, in camera mode and the painting phase only.
//  - In simulated-input mode the transform is the identity gain about the play-area centre
//    (Req 13.7), for the demand check and at completion: computeComfortTransform with no
//    grid gives exactly that, so no gain literal is written here.
import { addSample, createGrid, markAllValid, validCells, type ComfortGrid } from './comfortGrid';
import type { PoseLandmarks, Vec2, WristId } from './frame';
import { makeMapping } from './mapping';
import type { FilteredPointers } from './pointerFilter';
import { placeTargets, type Demand } from './placement';
import { computeComfortTransform, type ComfortTransform, type WristGrids } from './reachGain';
import type { Tuning } from './tuning';

/** Camera mode, or simulated input from a mouse, touch or pen (glossary). */
export type CalibrationMode = 'camera' | 'simulated';

/** What createCalibration needs (design section 14.2). The demand's slots are already filtered to the play area. */
export interface CalibrationConfig {
  /** The wrists whose grids are painted: the player's choice in camera mode, the right wrist in simulated input. */
  readonly activeWrists: readonly WristId[];
  readonly mode: CalibrationMode;
  /** The placement request the painting phase ends against (Req 11.11). */
  readonly demand: Demand;
  /** The camera frame aspect a. */
  readonly frameAspect: number;
  /** The play-area aspect A. */
  readonly playAspect: number;
  /** The tuning values every threshold below is read from. */
  readonly tuning: Tuning;
}

/** The head landmarks the calm hold reads (Req 12.2). Wrists are not needed there (Req 12.5). */
export type HeadLandmarks = Pick<PoseLandmarks, 'nose' | 'leftShoulder' | 'rightShoulder'>;

/** One step's input (design section 1). */
export interface CalibrationInput {
  /** The filtered camera-space pointer of each active wrist: held between consumed frames (design section 3). A missing wrist is invalid. */
  readonly pointers: FilteredPointers;
  /** Whether this step consumed a new frame: only then are samples added and the head landmarks read (Req 11.2, 12.2). */
  readonly frameConsumed: boolean;
  /** The head landmarks of the latest frame, for the calm hold. */
  readonly head: HeadLandmarks;
}

/**
 * The neutral head data the calm hold records (Req 12.4), and the one type the head view
 * reads (Req 9.1): the mean camera-space nose position, and the mean shoulder distance in
 * aspect-corrected units.
 */
export interface NeutralHead {
  readonly nose: Vec2;
  readonly shoulderWidth: number;
}

/** What completing calibration hands to the app: the grids, the transform computed once (Req 12.8, 13), and the head data, or none. */
export interface CalibrationResult {
  readonly grids: WristGrids;
  readonly transform: ComfortTransform;
  /** The neutral head data, or null when the calm hold was skipped (Req 12.7) or never run ("Use the whole screen", Req 11.15). */
  readonly head: NeutralHead | null;
}

/** Why the painting phase ended: the 20 s rule, the early rule, the cap, or "Use the whole screen". */
export type PaintingEndReason = 'nominal' | 'early' | 'cap' | 'wholeScreen';

export type CalibrationEvent =
  | { readonly kind: 'paintingEnded'; readonly reason: PaintingEndReason }
  | { readonly kind: 'completed'; readonly result: CalibrationResult };

/** painting, then the calm hold, then complete. */
export type CalibrationPhase = 'painting' | 'calm' | 'complete';

export interface CalibrationState {
  readonly cfg: CalibrationConfig;
  readonly phase: CalibrationPhase;
  /** One grid per active wrist. After the painting phase ends they no longer change (Req 11.8). */
  readonly grids: WristGrids;
  /** Presence time in steps with a valid active wrist, in the painting phase (Req 11.5). */
  readonly paintingMs: number;
  /** The painting time of the step in which a cell last became valid; 0 before any (Req 11.7). */
  readonly lastValidAtMs: number;
  /** The valid cells over all active grids, to see in which step a cell became valid. */
  readonly validCellCount: number;
  /** The last computed demand result: true if Placement gave `simultaneous` (Req 11.11). */
  readonly demandMet: boolean;
  /** Presence time since a step last had a valid active wrist, in the painting phase (Req 11.12). */
  readonly noWristMs: number;
  /** Whether the Setup UI shows the calibration hand hint (Req 11.12). */
  readonly handHint: boolean;
  /** Set once calibration completes. */
  readonly result: CalibrationResult | null;
}

/** What the actions and the step return. */
export interface CalibrationStep {
  readonly state: CalibrationState;
  readonly events: readonly CalibrationEvent[];
}

/** The state of a new painting phase: one empty grid per active wrist (Req 11.1). */
export function createCalibration(cfg: CalibrationConfig): CalibrationState {
  const grids: { [W in WristId]?: ComfortGrid } = {};
  for (const wrist of cfg.activeWrists) grids[wrist] = createGrid(cfg.tuning);
  return {
    cfg,
    phase: 'painting',
    grids,
    paintingMs: 0,
    lastValidAtMs: 0,
    validCellCount: 0,
    demandMet: false,
    noWristMs: 0,
    handHint: false,
    result: null,
  };
}

/** The number of valid cells over all the grids. */
function countValid(grids: WristGrids, activeWrists: readonly WristId[], tuning: Tuning): number {
  let total = 0;
  for (const wrist of activeWrists) {
    const grid = grids[wrist];
    if (grid !== undefined) total += validCells(grid, tuning).length;
  }
  return total;
}

/**
 * The reach gain and centre for the grids: computed from them in camera mode, and the
 * identity about the play-area centre in simulated-input mode (Req 13.7). With no grid
 * computeComfortTransform returns that identity (Req 13.4).
 */
function transformFor(cfg: CalibrationConfig, grids: WristGrids): ComfortTransform {
  const { frameAspect, playAspect, tuning } = cfg;
  return computeComfortTransform(cfg.mode === 'simulated' ? {} : grids, frameAspect, playAspect, tuning);
}

/** Whether Placement gives `simultaneous` for the demand on these grids (Req 11.11). */
function demandIsMet(cfg: CalibrationConfig, grids: WristGrids): boolean {
  const mapping = makeMapping({
    playAspect: cfg.playAspect,
    frameAspect: cfg.frameAspect,
    ...transformFor(cfg, grids),
  });
  return placeTargets(cfg.demand, grids, mapping, cfg.tuning).kind === 'simultaneous';
}

/** The state at the end of calibration, with the completion event. */
function complete(
  state: CalibrationState,
  grids: WristGrids,
  head: NeutralHead | null,
  events: readonly CalibrationEvent[],
): CalibrationStep {
  const result: CalibrationResult = { grids, transform: transformFor(state.cfg, grids), head };
  return {
    state: { ...state, phase: 'complete', grids, handHint: false, result },
    events: [...events, { kind: 'completed', result }],
  };
}

/** The reason painting ends in this step, or null (Req 11.6, 11.7, 11.9, 11.10). */
function endReason(
  cfg: CalibrationConfig,
  paintingMs: number,
  lastValidAtMs: number,
  demandMet: boolean,
): PaintingEndReason | null {
  const t = cfg.tuning;
  if (demandMet && paintingMs >= t.calibNominalMs) return 'nominal';
  const quiet = paintingMs - lastValidAtMs >= t.calibEarlyQuietMs;
  if (demandMet && paintingMs >= t.calibEarliestMs && quiet) return 'early';
  if (paintingMs >= t.calibCapMs) return 'cap';
  return null;
}

/** One step of the painting phase. */
function stepPainting(state: CalibrationState, input: CalibrationInput, dtMs: number): CalibrationStep {
  const { cfg } = state;
  const t = cfg.tuning;
  const pointers = cfg.activeWrists.flatMap((wrist) => {
    const pointer = input.pointers[wrist];
    return pointer !== undefined && pointer.valid ? [{ wrist, pos: pointer.pos }] : [];
  });
  const anyValid = pointers.length > 0;
  const paintingMs = state.paintingMs + (anyValid ? dtMs : 0);
  const noWristMs = anyValid ? 0 : state.noWristMs + dtMs;

  // One sample per valid active wrist for each consumed frame (Req 11.2).
  const grids: { [W in WristId]?: ComfortGrid } = { ...state.grids };
  if (input.frameConsumed) {
    for (const { wrist, pos } of pointers) grids[wrist] = addSample(grids[wrist] ?? createGrid(t), pos);
  }

  // The demand is checked only in a step in which a cell became valid (design section 14.2).
  const validCellCount = countValid(grids, cfg.activeWrists, t);
  const changed = validCellCount > state.validCellCount;
  const lastValidAtMs = changed ? paintingMs : state.lastValidAtMs;
  const demandMet = changed ? demandIsMet(cfg, grids) : state.demandMet;

  const next: CalibrationState = {
    ...state,
    grids,
    paintingMs,
    lastValidAtMs,
    validCellCount,
    demandMet,
    noWristMs,
    handHint: cfg.mode === 'camera' && noWristMs > t.calibHandHintMs,
  };
  const reason = endReason(cfg, paintingMs, lastValidAtMs, demandMet);
  if (reason === null) return { state: next, events: [] };
  return {
    state: { ...next, phase: 'calm', handHint: false },
    events: [{ kind: 'paintingEnded', reason }],
  };
}

/**
 * One step of calibration with presence delta dtMs (Req 11, 12). In the painting phase it
 * adds samples, counts painting time, runs the demand check and applies the end rules; after
 * the painting phase ends no sample is added (Req 11.8). The arguments are only read.
 */
export function stepCalibration(state: CalibrationState, input: CalibrationInput, dtMs: number): CalibrationStep {
  if (state.phase === 'painting') return stepPainting(state, input, dtMs);
  return { state, events: [] };
}

/** Retry (Req 11.13): every grid, the head data and every timer cleared, and painting restarted. */
export function retryCalibration(state: CalibrationState): CalibrationStep {
  return { state: createCalibration(state.cfg), events: [] };
}

/**
 * "Use the whole screen" (Req 11.15): in simulated-input mode, marks every cell of the
 * pointer's grid valid and completes at once, skipping the calm hold, with no head data. In
 * camera mode, or after completion, it does nothing (see the decisions above).
 */
export function chooseWholeScreen(state: CalibrationState): CalibrationStep {
  if (state.phase === 'complete' || state.cfg.mode !== 'simulated') return { state, events: [] };
  const grids: { [W in WristId]?: ComfortGrid } = { ...state.grids };
  for (const wrist of state.cfg.activeWrists) {
    grids[wrist] = markAllValid(grids[wrist] ?? createGrid(state.cfg.tuning));
  }
  const ended: CalibrationEvent[] = state.phase === 'painting' ? [{ kind: 'paintingEnded', reason: 'wholeScreen' }] : [];
  return complete(state, grids, null, ended);
}
