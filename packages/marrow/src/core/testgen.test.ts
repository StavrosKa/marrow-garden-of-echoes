import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { presenceDelta } from './clocks';
import { createGrid, isCellValid, markAllValid, validCells, type ComfortGrid } from './comfortGrid';
import { createDwell, dwellView, stepDwell, type DwellState, type HitArea, type PointerInput } from './dwell';
import type { Vec2, WristId } from './frame';
import { dist } from './geometry';
import { createHelp, stepHelp, type HelpEvent } from './help';
import {
  ASPECT_MAX,
  ASPECT_MIN,
  DEMAND_N_MAX,
  DEMAND_SLOTS_MAX,
  DWELL_ACTIVATIONS,
  DWELL_APPROACH_MAX,
  DWELL_MEDIUM_RUN_MAX,
  DWELL_STEPS_MAX,
  DWELL_STEPS_MIN,
  DWELL_TARGETS_MAX,
  GAP_MAX_MS,
  HELP_BODY_MAX,
  HELP_ROUNDS_MAX,
  HELP_STEPS_MAX,
  RESELECT_CYCLES_MAX,
  RESELECT_CYCLES_MIN,
  STINT_COUNT_MAX,
  STINT_COUNT_MIN,
  STINT_ODD_STEP_MS,
  TRACKING_STEPS_MAX,
  TRACKING_STEPS_MIN,
  HEAD_EDGE_SHARE,
  HEAD_RUN_MAX,
  
  SETTINGS_FIELDS,
  SETTINGS_HOSTILE_KEYS,
  SETTINGS_LONG_MIN,
  HEAD_NEUTRAL_MAX,
  HEAD_NEUTRAL_MIN,
  HEAD_REACH,
  HEAD_SHOULDER_MAX,
  HEAD_SHOULDER_MIN,
  HEAD_WIDTH_MAX,
  HEAD_WIDTH_MIN,
  MARGIN_MAX,
  NEAR_END_SHARE,
  OUTSIDE_MARGIN,
  demote,
  genClockFlags,
  genDemand,
  genAxis,
  genClosed,
  genDt,
  genDtClamped,
  genDwellRun,
  genGrid,
  genHeadFrames,
  genHelpSession,
  genHitAreas,
  genMappingParams,
  genSettingsString,
  genPointerPath,
  genReselectRun,
  genStintRun,
  genTargetPath,
  genTrackingRun,
  genTwoPointerInterleaving,
  genUnit,
  genVec2Camera,
  genVec2Screen,
  promote,
  type DwellStepCase,
  type PointerPathStep,
  type StintKind,
  type StintRun,
  type TrackingRunCase,
} from './testgen';
import { SETTINGS_VERSION } from './settings';
import { createTracking, stepTracking } from './tracking';
import { TUNING } from './tuning';

// A property test is only as strong as its generator, so these check that each
// generator reaches the cases it promises. The fixed seed makes the samples, and so
// these tests, the same on every run.
const SAMPLE = { numRuns: 1000, seed: 42 };
const MAX = TUNING.maxClockStepMs;
/** The quarters of a range that the genDemand check counts slot coordinates in. */
const QUARTERS = 4;
/**
 * The least share of slot coordinates genDemand must put in each quarter of an axis, so
 * that a return to fc.double's spread, which leaves the middle quarters almost empty,
 * fails the check. A test parameter.
 */
const MIN_QUARTER_SHARE = 0.1;

/**
 * The share of the values that lie in lo..hi that fall in each quarter of lo..hi, in order.
 * Values outside the range, NaN and infinities are left out of the count.
 */
function quarterSharesOf(values: readonly number[], lo: number, hi: number): number[] {
  const inRange = values.filter((v) => v >= lo && v <= hi);
  const counts = new Array<number>(QUARTERS).fill(0);
  for (const v of inRange) {
    const quarter = Math.min(QUARTERS - 1, Math.floor(((v - lo) / (hi - lo)) * QUARTERS));
    counts[quarter] = (counts[quarter] ?? 0) + 1;
  }
  return counts.map((count) => count / inRange.length);
}

/** How close to an edge the tight band of the genHeadFrames check lies, as a share of the edge width. A test parameter. */
const HEAD_TIGHT_SHARE = 0.1;
/** The least share of genHeadFrames offsets in each tight band: the generator gives about 1.5%, the spread alone 0.2%. A test parameter. */
const HEAD_TIGHT_MIN_SHARE = 0.008;

/** Whether cell (col, row) is valid at TUNING's threshold; false for a cell outside the grid. */
const validAt = (grid: ComfortGrid, col: number, row: number): boolean => isCellValid(grid, col, row, TUNING);

/**
 * The number of separate valid regions: groups of valid cells joined along a side or at
 * a corner. Two regions counted apart do not touch, not even at a corner.
 */
function regionCount(grid: ComfortGrid): number {
  const seen = new Set<number>();
  let regions = 0;
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      if (!validAt(grid, col, row) || seen.has(row * grid.cols + col)) continue;
      regions += 1;
      seen.add(row * grid.cols + col);
      const stack = [{ col, row }];
      for (let cell = stack.pop(); cell !== undefined; cell = stack.pop()) {
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const c = cell.col + dc;
            const r = cell.row + dr;
            if (validAt(grid, c, r) && !seen.has(r * grid.cols + c)) {
              seen.add(r * grid.cols + c);
              stack.push({ col: c, row: r });
            }
          }
        }
      }
    }
  }
  return regions;
}

/** Whether some cell that is not valid has a valid cell on each of its four sides: a hole in a region. */
function hasHole(grid: ComfortGrid): boolean {
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      if (
        !validAt(grid, col, row) &&
        validAt(grid, col - 1, row) &&
        validAt(grid, col + 1, row) &&
        validAt(grid, col, row - 1) &&
        validAt(grid, col, row + 1)
      ) {
        return true;
      }
    }
  }
  return false;
}

/** Whether a pointer or path point is valid and within a hit area, by the reducer's own distance. */
const insideArea = (valid: boolean, pos: Vec2, area: HitArea): boolean => valid && dist(pos, area.centre) <= area.radius;

/** The steps of a dwell run in which one pointer rests on one target for dwellMs of presence time, at the longest. */
function longestRestMs(run: readonly DwellStepCase[]): number {
  let longest = 0;
  for (const wrist of ['left', 'right'] as const) {
    for (const id of Array.from({ length: DWELL_TARGETS_MAX }, (_, j) => `t${j}`)) {
      let sum = 0;
      for (const step of run) {
        const area = step.hitAreas.find((a) => a.targetId === id);
        const pointer = step.pointers.find((p) => p.wrist === wrist);
        const on = area !== undefined && pointer !== undefined && pointer.valid && insideArea(true, pointer.pos, area);
        sum = on ? sum + step.dt : 0;
        longest = Math.max(longest, sum);
      }
    }
  }
  return longest;
}

/** What a dwell run does in the reducer: the behaviours the dwell properties need to see happen. */
interface RunTally {
  selections: number;
  sameTargetTwice: boolean;
  outsideRelease: boolean;
  invalidCancel: boolean;
  droppedByActivation: boolean;
  droppedByRemoval: boolean;
  latchBlocksAnInsidePointer: boolean;
  latchEnded: boolean;
  onePointerOwnsTwoTargets: boolean;
  bothWristsOwn: boolean;
}

function tallyRun(run: readonly DwellStepCase[]): RunTally {
  const tally: RunTally = {
    selections: 0,
    sameTargetTwice: false,
    outsideRelease: false,
    invalidCancel: false,
    droppedByActivation: false,
    droppedByRemoval: false,
    latchBlocksAnInsidePointer: false,
    latchEnded: false,
    onePointerOwnsTwoTargets: false,
    bothWristsOwn: false,
  };
  const selected = new Map<string, number>();
  let state: DwellState = createDwell();
  for (const step of run) {
    const before = state;
    const result = stepDwell(before, { dt: step.dt, pointers: step.pointers, hitAreas: step.hitAreas });
    state = result.state;
    tally.selections += result.events.length;
    for (const event of result.events) {
      selected.set(event.targetId, (selected.get(event.targetId) ?? 0) + 1);
      if ((selected.get(event.targetId) ?? 0) >= 2) tally.sameTargetTwice = true;
    }
    for (const record of before.targets) {
      const area = step.hitAreas.find((a) => a.targetId === record.targetId);
      const after = dwellView(state, record.targetId);
      const pointer = record.owner === null ? undefined : step.pointers.find((p) => p.wrist === record.owner);
      if (record.owner !== null) {
        if (area === undefined) tally.droppedByRemoval = true;
        else if (area.activationId !== record.activationId) tally.droppedByActivation = true;
        else if (after.owner === null && !result.events.some((e) => e.targetId === record.targetId)) {
          if (pointer === undefined || !pointer.valid) tally.invalidCancel = true;
          else if (!insideArea(true, pointer.pos, area)) tally.outsideRelease = true;
        }
      }
      if (record.latch.length > 0 && area !== undefined) {
        if (after.owner === null && step.pointers.some((p) => p.valid && insideArea(true, p.pos, area))) {
          tally.latchBlocksAnInsidePointer = true;
        }
        const next = state.targets.find((t) => t.targetId === record.targetId);
        if (next === undefined || next.latch.length === 0) tally.latchEnded = true;
      }
    }
    const ids = [...new Set(step.hitAreas.map((a) => a.targetId))];
    const owned = (wrist: WristId): number => ids.filter((id) => dwellView(state, id).owner === wrist).length;
    if (owned('left') >= 2 || owned('right') >= 2) tally.onePointerOwnsTwoTargets = true;
    if (owned('left') >= 1 && owned('right') >= 1) tally.bothWristsOwn = true;
  }
  return tally;
}

/** The kind of a step of a stint run, from its pointer and its hit area. */
function stepKind(step: DwellStepCase): StintKind {
  const pointer = step.pointers[0];
  const area = step.hitAreas[0];
  if (pointer === undefined || !pointer.valid || area === undefined) return 'invalid';
  return insideArea(true, pointer.pos, area) ? 'inside' : 'outside';
}

/** Kinds and durations with neighbours of one kind joined into one. */
function joinedKinds(items: readonly { kind: StintKind; ms: number }[]): { kind: StintKind; ms: number }[] {
  const out: { kind: StintKind; ms: number }[] = [];
  for (const item of items) {
    const last = out[out.length - 1];
    if (last !== undefined && last.kind === item.kind) out[out.length - 1] = { kind: last.kind, ms: last.ms + item.ms };
    else out.push({ ...item });
  }
  return out;
}

/** The stints of a run as its steps show them: every step after the acquiring one, neighbours of one kind joined. */
const joinedSteps = (run: StintRun): { kind: StintKind; ms: number }[] =>
  joinedKinds(run.steps.slice(1).map((s) => ({ kind: stepKind(s), ms: s.dt })));
const joinedStints = (run: StintRun): { kind: StintKind; ms: number }[] =>
  joinedKinds(run.stints.map((s) => ({ kind: s.kind, ms: s.ms })));

/** Whether the right wrist still holds the one target after the last step of a run. */
function holdsAtTheEnd(run: readonly DwellStepCase[]): boolean {
  let state: DwellState = createDwell();
  for (const step of run) state = stepDwell(state, { dt: step.dt, pointers: step.pointers, hitAreas: step.hitAreas }).state;
  return dwellView(state, 't0').owner !== null;
}

/** The least share of bounded stint runs in which the hold is still there at the end, so that Req 17.22 is not run on holds that end at once. A test parameter. */
const MIN_HELD_AT_END_SHARE = 0.3;
/** The least share of re-selection runs that select one target twice, so that Req 17.20 is run on re-selections. A test parameter. */
const MIN_RESELECT_SHARE = 0.5;
/** The least share of tracking runs in which a hold begins, so that Req 18.13 and 18.14 are run on holds. Measured 0.713; the floor keeps 1.5 times of margin. A test parameter. */
const MIN_HOLD_RUN_SHARE = 0.45;
/** The least share of tracking runs with a gap of GAP_MAX_MS or more of presence time with no valid active wrist. A test parameter. */
const MIN_LONG_GAP_RUN_SHARE = 0.2;

/** What a tracking run does in the lifecycle, summed here from the inputs: the behaviours the tracking properties need to see. */
interface TrackingTally {
  holdBegan: boolean;
  overlayShown: boolean;
  holdEnded: boolean;
  hintShown: boolean;
  /** A step in which lost time is exactly the hold threshold and no hold begins. */
  lostExactlyAtTheThreshold: boolean;
  /** The hold began in a step in which lost time is at most one step over the threshold. */
  holdBeganJustOver: boolean;
  /** A hold ended in a step in which valid time was exactly trackingResumeMs. */
  endedExactlyAtTheResumeTime: boolean;
  /** The most valid stretches shorter than trackingResumeMs, each ended by a step without a valid wrist, in one hold. */
  mostShortStretchesInOneHold: number;
  /** The longest continuous presence time with no valid active wrist, in milliseconds. */
  longestLostMs: number;
}

function tallyTracking(run: TrackingRunCase): TrackingTally {
  const tally: TrackingTally = {
    holdBegan: false,
    overlayShown: false,
    holdEnded: false,
    hintShown: false,
    lostExactlyAtTheThreshold: false,
    holdBeganJustOver: false,
    endedExactlyAtTheResumeTime: false,
    mostShortStretchesInOneHold: 0,
    longestLostMs: 0,
  };
  let state = createTracking({ activeWrists: run.activeWrists, mode: 'camera', tuning: TUNING });
  let lostMs = 0;
  let validMs = 0;
  let stretchMs = 0;
  let stretches = 0;
  let holdBefore = false;
  for (const step of run.steps) {
    const presenceDt = presenceDelta(step.rawDt, { paused: step.paused, hidden: step.hidden }, TUNING);
    const result = stepTracking(state, { wristValid: step.wristValid, noseValid: step.noseValid, calibrating: false }, presenceDt);
    state = result.state;
    const valid = run.activeWrists.some((w) => step.wristValid[w]);
    lostMs = valid ? 0 : lostMs + presenceDt;
    tally.longestLostMs = Math.max(tally.longestLostMs, lostMs);
    for (const event of result.events) {
      if (event.kind === 'holdBegan') tally.holdBegan = true;
      if (event.kind === 'overlayShown') tally.overlayShown = true;
      if (event.kind === 'holdEnded') tally.holdEnded = true;
      if (event.kind === 'oneWristHintShown') tally.hintShown = true;
    }
    if (!holdBefore && !result.holdActive && lostMs === TUNING.trackingHoldAfterMs) tally.lostExactlyAtTheThreshold = true;
    if (!holdBefore && result.holdActive && lostMs <= TUNING.trackingHoldAfterMs + TUNING.maxClockStepMs) tally.holdBeganJustOver = true;
    if (holdBefore) {
      validMs = valid ? validMs + presenceDt : 0;
      if (!result.holdActive && validMs === TUNING.trackingResumeMs) tally.endedExactlyAtTheResumeTime = true;
      if (valid) stretchMs += presenceDt;
      else {
        // A valid stretch that a step without a valid wrist ended before the hold did.
        if (stretchMs > 0) stretches += 1;
        stretchMs = 0;
      }
      tally.mostShortStretchesInOneHold = Math.max(tally.mostShortStretchesInOneHold, stretches);
    }
    if (!result.holdActive) {
      validMs = 0;
      stretchMs = 0;
      stretches = 0;
    }
    holdBefore = result.holdActive;
  }
  return tally;
}

/** What a help session does in the policy, counted by running it: the behaviours the help properties need to see happen. */
interface HelpTally {
  offers: number;
  raises: number;
  /** A level raised in a round end that reports neither flag while nothing waited: the change of that round itself. */
  immediateRaise: boolean;
  /** A level raised in an event that is not a round end: a waiting change applied. */
  deferredRaise: boolean;
  /** A round that earned a change ended with a dwell only, a playback only, or both active, and left the change waiting. */
  heldByDwell: boolean;
  heldByPlayback: boolean;
  heldByBoth: boolean;
  /** A round that earned a change ended with neither flag while another change waited, so its change went behind that one. */
  queuedBehindAWaitingChange: boolean;
  longestQueue: number;
  /** Both levels were at helpMaxLevel at some point: 2 * helpMaxLevel changes made. */
  atTheTop: boolean;
  /** An immediate raise of the axis with fewer difficulties: the fallback of Req 19.5. */
  fallback: boolean;
  /** An immediate raise from a round with the same difficulties on each axis. */
  tieRaise: boolean;
  /** A round with enough difficulties, ended with neither flag and nothing waiting, that changed nothing. */
  nothingToRaise: boolean;
  /** The number of difficulties of each round that ended. */
  endedWith: number[];
  continueBeyondTheEnd: boolean;
  continueOutsideARound: boolean;
  roundEndOutsideARound: boolean;
  roundReplaced: boolean;
  endedInsideARound: boolean;
}

function tallyHelp(events: readonly HelpEvent[]): HelpTally {
  const tally: HelpTally = {
    offers: 0,
    raises: 0,
    immediateRaise: false,
    deferredRaise: false,
    heldByDwell: false,
    heldByPlayback: false,
    heldByBoth: false,
    queuedBehindAWaitingChange: false,
    longestQueue: 0,
    atTheTop: false,
    fallback: false,
    tieRaise: false,
    nothingToRaise: false,
    endedWith: [],
    continueBeyondTheEnd: false,
    continueOutsideARound: false,
    roundEndOutsideARound: false,
    roundReplaced: false,
    endedInsideARound: false,
  };
  const top = TUNING.helpMaxLevel;
  let state = createHelp(TUNING);
  for (const event of events) {
    const before = state;
    const result = stepHelp(before, event);
    state = result.state;
    const neither = !event.dwellActive && !event.playbackActive;
    const raised = result.outputs.flatMap((o) => (o.kind === 'levelRaised' ? [o] : []));
    tally.offers += result.outputs.filter((o) => o.kind === 'offerHelp').length;
    tally.raises += raised.length;
    tally.longestQueue = Math.max(tally.longestQueue, state.pending.length);
    if (state.motorLevel === top && state.cognitiveLevel === top) tally.atTheTop = true;
    if (raised.length > 0 && event.kind !== 'roundEnded') tally.deferredRaise = true;
    const round = before.round;
    if (event.kind === 'roundStarted' && round !== null) tally.roundReplaced = true;
    if (event.kind === 'continueWithHelp') {
      if (round === null) tally.continueOutsideARound = true;
      else if (round.completed >= round.steps) tally.continueBeyondTheEnd = true;
    }
    if (event.kind === 'roundEnded') {
      if (round === null) {
        tally.roundEndOutsideARound = true;
      } else {
        const total = round.motorDifficulties + round.cognitiveDifficulties;
        tally.endedWith.push(total);
        if (total >= TUNING.difficultiesBeforeHelp) {
          // The event applies the oldest waiting change first if it can, so its own change is queued if the queue did not shrink by one and grow by one.
          const applied = neither && before.pending.length > 0;
          const queuedNow = state.pending.length - (before.pending.length - (applied ? 1 : 0)) > 0;
          if (queuedNow && neither) tally.queuedBehindAWaitingChange = true;
          if (queuedNow && event.dwellActive && !event.playbackActive) tally.heldByDwell = true;
          if (queuedNow && !event.dwellActive && event.playbackActive) tally.heldByPlayback = true;
          if (queuedNow && event.dwellActive && event.playbackActive) tally.heldByBoth = true;
          if (neither && before.pending.length === 0) {
            const own = raised[0];
            if (own === undefined) tally.nothingToRaise = true;
            else {
              tally.immediateRaise = true;
              if (round.motorDifficulties === round.cognitiveDifficulties) tally.tieRaise = true;
              else if ((own.axis === 'motor') !== (round.motorDifficulties > round.cognitiveDifficulties)) tally.fallback = true;
            }
          }
        }
      }
    }
  }
  tally.endedInsideARound = state.round !== null;
  return tally;
}

/** The numbers of events between each round start and the round end that follows it directly, for the rounds that have one. */
function helpBodyLengths(session: readonly HelpEvent[]): number[] {
  const lengths: number[] = [];
  let since: number | null = null;
  for (const event of session) {
    if (event.kind === 'roundStarted') since = 0;
    else if (event.kind === 'roundEnded') {
      if (since !== null) lengths.push(since);
      since = null;
    } else if (since !== null) since += 1;
  }
  return lengths;
}

type HelpShareName =
  | 'raise'
  | 'immediateRaise'
  | 'deferredRaise'
  | 'queueOfTwo'
  | 'atTheTop'
  | 'fallback'
  | 'continueBeyondTheEnd'
  | 'waitForADwell'
  | 'waitForAPlayback'
  | 'waitForBoth'
  | 'behindAWaitingChange';

/**
 * The least share of help sessions that reach what the help properties need to see, each measured on the
 * seed-42 sample of 1000 and set at no more than two thirds of the measured share, so that a change of the
 * generator has room before the check fails. One record, so that a failing check shows every share below its
 * floor. A test parameter.
 */
const HELP_SHARE_FLOORS: Record<HelpShareName, number> = {
  // Measured 0.816, 0.621, 0.494, 0.139, 0.186, 0.162 and 0.364.
  raise: 0.5,
  immediateRaise: 0.4,
  deferredRaise: 0.32,
  queueOfTwo: 0.09,
  atTheTop: 0.12,
  fallback: 0.1,
  continueBeyondTheEnd: 0.2,
  // Measured 0.412, 0.326, 0.309 and 0.095.
  waitForADwell: 0.27,
  waitForAPlayback: 0.21,
  waitForBoth: 0.2,
  behindAWaitingChange: 0.06,
};

/** The least share of dwell runs that must reach a selection, so that the properties are not run on holds that never finish. A test parameter. */
const MIN_SELECTING_RUN_SHARE = 0.2;
/** The least share of the steps with two or more targets in which two of them overlap deeply (a centre inside the other circle). A test parameter. */
const MIN_DEEP_OVERLAP_SHARE = 0.15;

/** What one string of genSettingsString is, judged here from the text and not from the generator. */
type SettingsKind =
  | 'notJson'
  | 'topNull'
  | 'topArray'
  | 'topNumber'
  | 'topString'
  | 'topBoolean'
  | 'object'
  | 'rightVersion'
  | 'wrongVersion'
  | 'noVersion'
  | 'allFieldsValid'
  | 'oneFieldInvalid'
  | 'oneFieldMissing'
  | 'motionInvalid'
  | 'muteInvalid'
  | 'volumeInvalid'
  | 'handsInvalid'
  | 'topEmptyArray'
  | 'volumeOutOfRange'
  | 'invalidContainer'
  | 'hostileKey'
  | 'protoKey'
  | 'constructorKey'
  | 'hostileWithValidFields'
  | 'deep'
  | 'long'
  | 'plainText';
/** Whether a stored value is acceptable for the field (Req 20.1), written for this test. */
function fieldIsValid(field: (typeof SETTINGS_FIELDS)[number], value: unknown): boolean {
  switch (field) {
    case 'motion':
      return value === 'full' || value === 'gentle' || value === 'reduced';
    case 'mute':
      return typeof value === 'boolean';
    case 'volume':
      return typeof value === 'number' && value >= 0 && value <= 1;
    case 'hands':
      return value === null || value === 'right' || value === 'left' || value === 'both';
  }
}
/** The shortest nesting that counts as deep when the coverage test judges a string. A test parameter. */
const SETTINGS_DEPTH_MIN_TEST = 1_000;
/** Test parameters: nesting and length that the sample must reach, whatever the limits of the generator are. */
const DEEP_ENOUGH = 10_000;
const LONG_ENOUGH = 50_000;
function kindsOfSettingsString(s: string): Set<SettingsKind> {
  const kinds = new Set<SettingsKind>();
  const deep = s.includes('['.repeat(SETTINGS_DEPTH_MIN_TEST)) || s.includes('{"a":'.repeat(SETTINGS_DEPTH_MIN_TEST));
  if (deep) kinds.add('deep');
  if (s.length >= SETTINGS_LONG_MIN && !deep) kinds.add('long');
  let value: unknown;
  try {
    value = JSON.parse(s);
  } catch {
    kinds.add('notJson');
    if (!deep && s.length < SETTINGS_LONG_MIN) kinds.add('plainText');
    return kinds;
  }
  if (Array.isArray(value) && value.length === 0) kinds.add('topEmptyArray');
  if (value === null) kinds.add('topNull');

  else if (Array.isArray(value)) kinds.add('topArray');
  else if (typeof value === 'number') kinds.add('topNumber');
  else if (typeof value === 'string') kinds.add('topString');
  else if (typeof value === 'boolean') kinds.add('topBoolean');
  else if (typeof value === 'object') {
    kinds.add('object');
    const own = (key: string): unknown => Reflect.getOwnPropertyDescriptor(value, key)?.value;
    const has = (key: string): boolean => Object.hasOwn(value, key);
    if (!has('version')) kinds.add('noVersion');
    else if (own('version') === SETTINGS_VERSION) kinds.add('rightVersion');
    else kinds.add('wrongVersion');
    const keys = Object.keys(value);
    const hostile = keys.some((k) => (SETTINGS_HOSTILE_KEYS as readonly string[]).includes(k));
    if (hostile) kinds.add('hostileKey');
    if (keys.includes('__proto__')) kinds.add('protoKey');
    if (keys.includes('constructor')) kinds.add('constructorKey');
    const invalid = SETTINGS_FIELDS.filter((f) => has(f) && !fieldIsValid(f, own(f)));
    const missing = SETTINGS_FIELDS.filter((f) => !has(f));
    if (kinds.has('rightVersion') && invalid.length === 0 && missing.length === 0) {
      kinds.add('allFieldsValid');
      if (hostile) kinds.add('hostileWithValidFields');
    }
    if (kinds.has('rightVersion')) {
      for (const f of invalid) kinds.add(`${f}Invalid`);
      const volume = own('volume');
      if (has('volume') && typeof volume === 'number' && !fieldIsValid('volume', volume)) kinds.add('volumeOutOfRange');
      if (invalid.some((f) => typeof own(f) === 'object' && own(f) !== null)) kinds.add('invalidContainer');
    }
    if (kinds.has('rightVersion') && invalid.length === 1 && missing.length === 0) kinds.add('oneFieldInvalid');
    if (kinds.has('rightVersion') && invalid.length === 0 && missing.length === 1) kinds.add('oneFieldMissing');
  }
  return kinds;
}
/** The share of the strings that each kind must reach at least, each at most two thirds of what was measured. */
const SETTINGS_SHARE_FLOORS: Record<SettingsKind, number> = {
  notJson: 0.1, topNull: 0.007, topArray: 0.07, topNumber: 0.015, topString: 0.026, topBoolean: 0.009,
  object: 0.4, rightVersion: 0.27, wrongVersion: 0.05, noVersion: 0.1, allFieldsValid: 0.07,
  oneFieldInvalid: 0.14, oneFieldMissing: 0.04, hostileKey: 0.29, protoKey: 0.11, constructorKey: 0.11,
  hostileWithValidFields: 0.05, deep: 0.014, long: 0.033, plainText: 0.09,
  motionInvalid: 0.045, muteInvalid: 0.03, volumeInvalid: 0.033, handsInvalid: 0.045, topEmptyArray: 0.006, volumeOutOfRange: 0.013, invalidContainer: 0.04,
};

describe('testgen', () => {
  it('genDt reaches 0, negative, non-finite, in-range and above-range deltas', () => {
    const values = fc.sample(genDt(), SAMPLE);
    expect({
      zero: values.some((v) => Object.is(v, 0)),
      negative: values.some((v) => Number.isFinite(v) && v < 0),
      nan: values.some((v) => Number.isNaN(v)),
      infinity: values.includes(Infinity),
      minusInfinity: values.includes(-Infinity),
      inRange: values.some((v) => v > 0 && v < MAX),
      aboveRange: values.some((v) => Number.isFinite(v) && v > MAX),
    }).toEqual({
      zero: true,
      negative: true,
      nan: true,
      infinity: true,
      minusInfinity: true,
      inRange: true,
      aboveRange: true,
    });
  });

  it('genDtClamped stays in 0..maxClockStepMs and reaches both ends', () => {
    const values = fc.sample(genDtClamped(), SAMPLE);
    expect(values.filter((v) => !(v >= 0 && v <= MAX))).toEqual([]);
    expect({
      zero: values.some((v) => Object.is(v, 0)),
      max: values.includes(MAX),
      between: values.some((v) => v > 0 && v < MAX),
    }).toEqual({ zero: true, max: true, between: true });
  });

  it('genClockFlags reaches every combination of paused, hidden and holdActive', () => {
    const seen = new Set(
      fc.sample(genClockFlags(), SAMPLE).map((f) => `${f.paused} ${f.hidden} ${f.holdActive}`),
    );
    const all = [false, true].flatMap((p) =>
      [false, true].flatMap((h) => [false, true].map((k) => `${p} ${h} ${k}`)),
    );
    expect([...seen].sort()).toEqual(all.sort());
  });

  it('genPointerPath reaches gaps of 0 and GAP_MAX_MS, deltas of 0 and maxClockStepMs, and valid and invalid samples', () => {
    const paths = fc.sample(genPointerPath(), SAMPLE);
    const steps = paths.flat();
    const inFrame = (v: number): boolean => v >= 0 && v <= 1;

    // Every gap, with its duration: the sum of the deltas of a run of invalid samples.
    // Interior gaps have a valid sample on both sides; they are the ones that reset.
    const gaps = paths.flatMap((path) => {
      const found: { durationMs: number; interior: boolean }[] = [];
      let start = -1;
      path.forEach((step: PointerPathStep, i) => {
        if (!step.valid && start < 0) start = i;
        const ends = start >= 0 && (step.valid || i === path.length - 1);
        if (!ends) return;
        const run = path.slice(start, step.valid ? i : i + 1);
        found.push({
          durationMs: run.reduce((sum, s) => sum + s.dtMs, 0),
          interior: start > 0 && step.valid,
        });
        start = -1;
      });
      return found;
    });
    const interior = gaps.filter((g) => g.interior).map((g) => g.durationMs);

    expect(steps.filter((s) => !(s.dtMs >= 0 && s.dtMs <= MAX))).toEqual([]);
    expect(gaps.filter((g) => !(g.durationMs >= 0 && g.durationMs <= GAP_MAX_MS))).toEqual([]);
    expect(steps.filter((s) => s.valid && !(inFrame(s.pos.x) && inFrame(s.pos.y)))).toEqual([]);
    expect({
      zeroDelta: steps.some((s) => Object.is(s.dtMs, 0)),
      maxDelta: steps.some((s) => s.dtMs === MAX),
      valid: steps.some((s) => s.valid),
      invalid: steps.some((s) => !s.valid),
      invalidOutsideFrame: steps.some((s) => !s.valid && !(inFrame(s.pos.x) && inFrame(s.pos.y))),
      zeroGap: interior.includes(0),
      maxGap: interior.includes(GAP_MAX_MS),
    }).toEqual({
      zeroDelta: true,
      maxDelta: true,
      valid: true,
      invalid: true,
      invalidOutsideFrame: true,
      zeroGap: true,
      maxGap: true,
    });
  });

  it('genMappingParams stays in range and reaches A > a, A < a, A = a, both gain ends and the play-area edges for c', () => {
    const params = fc.sample(genMappingParams(), SAMPLE);
    const { reachGainMin, reachGainMax } = TUNING;
    const isAspect = (v: number): boolean => v >= ASPECT_MIN && v <= ASPECT_MAX;

    expect(
      params.filter(
        (p) =>
          !(
            isAspect(p.playAspect) &&
            isAspect(p.frameAspect) &&
            p.gain >= reachGainMin &&
            p.gain <= reachGainMax &&
            p.centre.x >= 0 &&
            p.centre.x <= p.playAspect &&
            p.centre.y >= 0 &&
            p.centre.y <= 1
          ),
      ),
    ).toEqual([]);
    expect({
      playWider: params.some((p) => p.playAspect > p.frameAspect),
      playNarrower: params.some((p) => p.playAspect < p.frameAspect),
      sameAspect: params.some((p) => p.playAspect === p.frameAspect),
      playAspectMin: params.some((p) => p.playAspect === ASPECT_MIN),
      playAspectMax: params.some((p) => p.playAspect === ASPECT_MAX),
      frameAspectMin: params.some((p) => p.frameAspect === ASPECT_MIN),
      frameAspectMax: params.some((p) => p.frameAspect === ASPECT_MAX),
      gainMin: params.some((p) => p.gain === reachGainMin),
      gainMax: params.some((p) => p.gain === reachGainMax),
      gainBetween: params.some((p) => p.gain > reachGainMin && p.gain < reachGainMax),
      centreLeft: params.some((p) => p.centre.x === 0),
      centreRight: params.some((p) => p.centre.x === p.playAspect),
      centreTop: params.some((p) => p.centre.y === 0),
      centreBottom: params.some((p) => p.centre.y === 1),
      centreInside: params.some(
        (p) => p.centre.x > 0 && p.centre.x < p.playAspect && p.centre.y > 0 && p.centre.y < 1,
      ),
    }).toEqual({
      playWider: true,
      playNarrower: true,
      sameAspect: true,
      playAspectMin: true,
      playAspectMax: true,
      frameAspectMin: true,
      frameAspectMax: true,
      gainMin: true,
      gainMax: true,
      gainBetween: true,
      centreLeft: true,
      centreRight: true,
      centreTop: true,
      centreBottom: true,
      centreInside: true,
    });
  });

  it('genVec2Camera stays within OUTSIDE_MARGIN of the frame and reaches in-frame and out-of-frame points and the edges 0 and 1', () => {
    const points = fc.sample(genVec2Camera(), SAMPLE);
    const inUnit = (v: number): boolean => v >= 0 && v <= 1;
    const inBound = (v: number): boolean => v >= -OUTSIDE_MARGIN && v <= 1 + OUTSIDE_MARGIN;
    const inFrame = (p: Vec2): boolean => inUnit(p.x) && inUnit(p.y);

    expect(points.filter((p) => !(inBound(p.x) && inBound(p.y)))).toEqual([]);
    expect({
      inFrame: points.some(inFrame),
      outOfFrame: points.some((p) => !inFrame(p)),
      outsideOnXOnly: points.some((p) => !inUnit(p.x) && inUnit(p.y)),
      outsideOnYOnly: points.some((p) => inUnit(p.x) && !inUnit(p.y)),
      xZero: points.some((p) => p.x === 0),
      xOne: points.some((p) => p.x === 1),
      yZero: points.some((p) => p.y === 0),
      yOne: points.some((p) => p.y === 1),
    }).toEqual({
      inFrame: true,
      outOfFrame: true,
      outsideOnXOnly: true,
      outsideOnYOnly: true,
      xZero: true,
      xOne: true,
      yZero: true,
      yOne: true,
    });
  });

  it('genVec2Screen stays within OUTSIDE_MARGIN of the play area and reaches points inside and outside it and its edges', () => {
    const samples = fc.sample(
      genMappingParams().chain(({ playAspect }) =>
        genVec2Screen(playAspect).map((s) => ({ A: playAspect, s })),
      ),
      SAMPLE,
    );
    const inArea = ({ A, s }: { A: number; s: Vec2 }): boolean =>
      s.x >= 0 && s.x <= A && s.y >= 0 && s.y <= 1;
    const inBound = ({ A, s }: { A: number; s: Vec2 }): boolean =>
      s.x >= -OUTSIDE_MARGIN &&
      s.x <= A + OUTSIDE_MARGIN &&
      s.y >= -OUTSIDE_MARGIN &&
      s.y <= 1 + OUTSIDE_MARGIN;

    expect(samples.filter((sample) => !inBound(sample))).toEqual([]);
    expect({
      inside: samples.some(inArea),
      outside: samples.some((sample) => !inArea(sample)),
      left: samples.some(({ s }) => s.x === 0),
      right: samples.some(({ A, s }) => s.x === A),
      top: samples.some(({ s }) => s.y === 0),
      bottom: samples.some(({ s }) => s.y === 1),
    }).toEqual({ inside: true, outside: true, left: true, right: true, top: true, bottom: true });
  });

  it('genGrid has the size of TUNING and reaches no valid cell, one, several separate regions, holes, short cells and valid cells on every edge', () => {
    const grids = fc.sample(genGrid(), SAMPLE);
    const { gridCols: cols, gridRows: rows, cellValidSamples: needed } = TUNING;
    const valid = grids.map((grid) => validCells(grid, TUNING));

    expect(
      grids.filter(
        (grid) =>
          !(
            grid.cols === cols &&
            grid.rows === rows &&
            grid.counts.length === cols * rows &&
            !grid.allValid &&
            grid.counts.every((count) => Number.isInteger(count) && count >= 0)
          ),
      ),
    ).toEqual([]);
    expect({
      noValidCell: valid.some((cells) => cells.length === 0),
      oneValidCell: valid.some((cells) => cells.length === 1),
      severalRegions: grids.some((grid) => regionCount(grid) >= 2),
      hole: grids.some(hasHole),
      shortCell: grids.some((grid) => grid.counts.some((count) => count > 0 && count < needed)),
      exactlyNeeded: grids.some((grid) => grid.counts.includes(needed)),
      aboveNeeded: grids.some((grid) => grid.counts.some((count) => count > needed)),
      firstColumn: valid.some((cells) => cells.some((cell) => cell.col === 0)),
      lastColumn: valid.some((cells) => cells.some((cell) => cell.col === cols - 1)),
      firstRow: valid.some((cells) => cells.some((cell) => cell.row === 0)),
      lastRow: valid.some((cells) => cells.some((cell) => cell.row === rows - 1)),
    }).toEqual({
      noValidCell: true,
      oneValidCell: true,
      severalRegions: true,
      hole: true,
      shortCell: true,
      exactlyNeeded: true,
      aboveNeeded: true,
      firstColumn: true,
      lastColumn: true,
      firstRow: true,
      lastRow: true,
    });
  });

  it('promote only adds samples, at least one, and reaches promotions that make a cell valid and ones that leave every cell as valid as it was', () => {
    const pairs = fc.sample(genGrid().chain((grid) => fc.tuple(fc.constant(grid), promote(grid))), SAMPLE);
    const total = (grid: ComfortGrid): number => grid.counts.reduce((sum, count) => sum + count, 0);
    const validCount = (grid: ComfortGrid): number => validCells(grid, TUNING).length;

    expect(
      pairs.filter(
        ([before, after]) =>
          !(
            after.cols === before.cols &&
            after.rows === before.rows &&
            after.allValid === before.allValid &&
            after.counts.length === before.counts.length &&
            after.counts.every((count, i) => count >= (before.counts[i] ?? Infinity)) &&
            total(after) > total(before)
          ),
      ),
    ).toEqual([]);
    expect({
      newValidCell: pairs.some(([before, after]) => validCount(after) > validCount(before)),
      sameValidCells: pairs.some(([before, after]) => validCount(after) === validCount(before)),
    }).toEqual({ newValidCell: true, sameValidCells: true });
  });

  it('demote leaves exactly one valid cell short of valid and every other count as it was, and returns a grid with no valid cell as it is', () => {
    const needed = TUNING.cellValidSamples;
    const pairs = fc.sample(genGrid().chain((grid) => fc.tuple(fc.constant(grid), demote(grid))), SAMPLE);
    const results = pairs.map(([before, after]) => {
      const changed = before.counts.flatMap((count, i) => (after.counts[i] === count ? [] : [i]));
      const at = changed[0];
      return {
        hadValid: validCells(before, TUNING).length > 0,
        same: after === before,
        sizeAndMark:
          after.cols === before.cols &&
          after.rows === before.rows &&
          after.allValid === before.allValid &&
          after.counts.length === before.counts.length,
        changed: changed.length,
        was: at === undefined ? undefined : before.counts[at],
        now: at === undefined ? undefined : after.counts[at],
        lostValid: validCells(before, TUNING).length - validCells(after, TUNING).length,
      };
    });

    expect(results.filter((r) => !r.hadValid && !r.same)).toEqual([]);
    expect(
      results.filter(
        (r) =>
          r.hadValid &&
          !(
            r.sizeAndMark &&
            r.changed === 1 &&
            r.was !== undefined &&
            r.was >= needed &&
            r.now !== undefined &&
            r.now >= 0 &&
            r.now < needed &&
            r.lostValid === 1
          ),
      ),
    ).toEqual([]);
    expect({
      noValidCell: results.some((r) => !r.hadValid),
      toZero: results.some((r) => r.hadValid && r.now === 0),
      toShort: results.some((r) => r.hadValid && r.now !== undefined && r.now > 0),
    }).toEqual({ noValidCell: true, toZero: true, toShort: true });
  });

  it('demote refuses a grid marked all-valid, on which no cell can stop being valid', () => {
    expect(() => demote(markAllValid(createGrid(TUNING)))).toThrow('all-valid');
  });

  // The same coverage rule as genDemand's check: each quarter of a range holds at least
  // MIN_QUARTER_SHARE of the draws that lie in it. fc.double spreads its draws over bit
  // patterns, so a range that starts at 0 is almost all in its first quarter. The message
  // of each assertion lists the shares, so a failure shows them.
  it('genUnit, genClosed, genAxis, genDtClamped and genDt put at least MIN_QUARTER_SHARE of their draws in each quarter of each range', () => {
    const { reachGainMin, reachGainMax } = TUNING;
    const cases: { name: string; values: number[]; lo: number; hi: number }[] = [
      { name: 'genUnit', values: fc.sample(genUnit(), SAMPLE), lo: 0, hi: 1 },
      {
        name: 'genClosed(ASPECT_MIN, ASPECT_MAX)',
        values: fc.sample(genClosed(ASPECT_MIN, ASPECT_MAX), SAMPLE),
        lo: ASPECT_MIN,
        hi: ASPECT_MAX,
      },
      {
        name: 'genClosed(reachGainMin, reachGainMax)',
        values: fc.sample(genClosed(reachGainMin, reachGainMax), SAMPLE),
        lo: reachGainMin,
        hi: reachGainMax,
      },
      { name: 'genDtClamped', values: fc.sample(genDtClamped(), SAMPLE), lo: 0, hi: MAX },
      { name: 'genDt, -maxClockStepMs..3 maxClockStepMs', values: fc.sample(genDt(), SAMPLE), lo: -MAX, hi: 3 * MAX },
    ];
    for (const extent of [1, ASPECT_MAX]) {
      const values = fc.sample(genAxis(extent), SAMPLE);
      cases.push({
        name: `genAxis(${extent}), whole range`,
        values,
        lo: -OUTSIDE_MARGIN,
        hi: extent + OUTSIDE_MARGIN,
      });
      cases.push({ name: `genAxis(${extent}), inside 0..extent`, values, lo: 0, hi: extent });
    }
    const thin = cases.flatMap(({ name, values, lo, hi }) => {
      const shares = quarterSharesOf(values, lo, hi);
      return Math.min(...shares) >= MIN_QUARTER_SHARE ? [] : [`${name}: quarter shares ${shares.join(', ')}`];
    });
    expect(thin).toEqual([]);
  });

  it('genHeadFrames puts at least MIN_QUARTER_SHARE of each range in each quarter, and reaches the dead zone and the clamp from both sides, nose gaps that run the whole ease, and deltas of 0 and maxClockStepMs', () => {
    const cases = fc.sample(genHeadFrames(), SAMPLE);
    const steps = cases.flatMap((c) => c.steps);
    const reach = TUNING.headClamp * HEAD_REACH;
    const edge = TUNING.headDeadZone * HEAD_EDGE_SHARE;
    const ranges: { name: string; values: number[]; lo: number; hi: number }[] = [
      { name: 'd.x', values: steps.map((s) => s.d.x), lo: -reach, hi: reach },
      { name: 'd.y', values: steps.map((s) => s.d.y), lo: -reach, hi: reach },
      { name: 'dtMs', values: steps.map((s) => s.dtMs), lo: 0, hi: MAX },
      { name: 'neutral nose x', values: cases.map((c) => c.neutral.nose.x), lo: HEAD_NEUTRAL_MIN, hi: HEAD_NEUTRAL_MAX },
      { name: 'neutral nose y', values: cases.map((c) => c.neutral.nose.y), lo: HEAD_NEUTRAL_MIN, hi: HEAD_NEUTRAL_MAX },
      { name: 'shoulder width', values: cases.map((c) => c.neutral.shoulderWidth), lo: HEAD_WIDTH_MIN, hi: HEAD_WIDTH_MAX },
      { name: 'frame aspect', values: cases.map((c) => c.frameAspect), lo: ASPECT_MIN, hi: ASPECT_MAX },
      {
        name: 'shoulder x',
        values: steps.flatMap((s) => [s.shoulders.left.pos.x, s.shoulders.right.pos.x, s.otherShoulders.left.pos.x, s.otherShoulders.right.pos.x]),
        lo: HEAD_SHOULDER_MIN,
        hi: HEAD_SHOULDER_MAX,
      },
      {
        name: 'shoulder y',
        values: steps.flatMap((s) => [s.shoulders.left.pos.y, s.shoulders.right.pos.y, s.otherShoulders.left.pos.y, s.otherShoulders.right.pos.y]),
        lo: HEAD_SHOULDER_MIN,
        hi: HEAD_SHOULDER_MAX,
      },
    ];
    const thin = ranges.flatMap(({ name, values, lo, hi }) => {
      const shares = quarterSharesOf(values, lo, hi);
      const outside = values.filter((v) => !(v >= lo && v <= hi)).length;
      return Math.min(...shares) >= MIN_QUARTER_SHARE && outside === 0 ? [] : [`${name}: quarter shares ${shares.join(', ')}, ${outside} outside`];
    });
    expect(thin).toEqual([]);

    // Nose gaps: the longest run of invalid-nose steps, in presence time.
    const longestGapMs = Math.max(
      ...cases.map((c) => {
        let run = 0;
        let longest = 0;
        for (const s of c.steps) {
          run = s.noseValid ? 0 : run + s.dtMs;
          longest = Math.max(longest, run);
        }
        return longest;
      }),
    );
    const nearDz = (d: number): boolean => Math.abs(Math.abs(d) - TUNING.headDeadZone) <= edge;
    const nearClamp = (d: number): boolean => Math.abs(Math.abs(d) - TUNING.headClamp) <= edge;
    const ds = steps.flatMap((s) => [s.d.x, s.d.y]);
    // The offsets that are not found by the spread over the whole range alone: within a tenth of
    // the edge width of the dead zone or the clamp, a few per cent of them, where the spread over
    // the range would give a fraction of one per cent.
    const tight = edge * HEAD_TIGHT_SHARE;
    const shareWithin = (target: number): number =>
      ds.filter((d) => Math.abs(Math.abs(d) - target) <= tight).length / ds.length;
    expect({
      tightAtDeadZone: shareWithin(TUNING.headDeadZone) >= HEAD_TIGHT_MIN_SHARE,
      tightAtClamp: shareWithin(TUNING.headClamp) >= HEAD_TIGHT_MIN_SHARE,
      longSequences: steps.length / cases.length >= HEAD_RUN_MAX,
    }).toEqual({ tightAtDeadZone: true, tightAtClamp: true, longSequences: true });
    expect({
      insideDeadZone: ds.some((d) => Math.abs(d) < TUNING.headDeadZone - edge),
      justInsideDeadZone: ds.some((d) => nearDz(d) && Math.abs(d) <= TUNING.headDeadZone),
      justOutsideDeadZone: ds.some((d) => nearDz(d) && Math.abs(d) > TUNING.headDeadZone),
      justInsideClamp: ds.some((d) => nearClamp(d) && Math.abs(d) < TUNING.headClamp),
      justOutsideClamp: ds.some((d) => nearClamp(d) && Math.abs(d) >= TUNING.headClamp),
      beyondClamp: ds.some((d) => Math.abs(d) > TUNING.headClamp + edge),
      bothSigns: ds.some((d) => d < 0) && ds.some((d) => d > 0),
      noseValid: steps.some((s) => s.noseValid),
      noseInvalid: steps.some((s) => !s.noseValid),
      gapRunsWholeEase: longestGapMs >= TUNING.headEaseToCentreMs,
      deltaZero: steps.some((s) => s.dtMs === 0),
      deltaMax: steps.some((s) => s.dtMs === MAX),
      shoulderValid: steps.some((s) => s.shoulders.left.valid && s.shoulders.right.valid),
      shoulderInvalid: steps.some((s) => !s.shoulders.left.valid || !s.shoulders.right.valid),
      shouldersDiffer: steps.some((s) => s.shoulders.left.pos.x !== s.otherShoulders.left.pos.x),
    }).toEqual({
      insideDeadZone: true,
      justInsideDeadZone: true,
      justOutsideDeadZone: true,
      justInsideClamp: true,
      justOutsideClamp: true,
      beyondClamp: true,
      bothSigns: true,
      noseValid: true,
      noseInvalid: true,
      gapRunsWholeEase: true,
      deltaZero: true,
      deltaMax: true,
      shoulderValid: true,
      shoulderInvalid: true,
      shouldersDiffer: true,
    });
  });

  it('genDemand stays in range and reaches, for the slots, both edges, near both edges and at least MIN_QUARTER_SHARE in each quarter of each axis; r and m at both ends and between; n of 1 and DEMAND_N_MAX; 1 and DEMAND_SLOTS_MAX slots; and n above the slot count', () => {
    const samples = fc.sample(
      genMappingParams().chain(({ playAspect }) =>
        genDemand(playAspect).map((demand) => ({ A: playAspect, demand })),
      ),
      SAMPLE,
    );
    const { hitRadiusMin, hitRadiusMax } = TUNING;
    // Each slot coordinate with the extent of its axis: 0..A for x, 0..1 for y.
    const xs = samples.flatMap(({ A, demand }) => demand.slots.map((s) => ({ v: s.x, extent: A })));
    const ys = samples.flatMap(({ demand }) => demand.slots.map((s) => ({ v: s.y, extent: 1 })));
    const quarterShares = (values: readonly { v: number; extent: number }[]): number[] => {
      const counts = [0, 0, 0, 0];
      for (const { v, extent } of values) {
        const quarter = Math.min(QUARTERS - 1, Math.floor((v / extent) * QUARTERS));
        counts[quarter] = (counts[quarter] ?? 0) + 1;
      }
      return counts.map((count) => count / values.length);
    };
    const near = (d: number, extent: number): boolean => d > 0 && d <= extent * NEAR_END_SHARE;
    const reaches = (values: readonly { v: number; extent: number }[]) => ({
      atStart: values.some(({ v }) => v === 0),
      atEnd: values.some(({ v, extent }) => v === extent),
      nearStart: values.some(({ v, extent }) => near(v, extent)),
      nearEnd: values.some(({ v, extent }) => near(extent - v, extent)),
    });
    const allTrue = { atStart: true, atEnd: true, nearStart: true, nearEnd: true };

    expect(
      samples.filter(
        ({ A, demand: { slots, n, r, m } }) =>
          !(
            slots.length >= 1 &&
            slots.length <= DEMAND_SLOTS_MAX &&
            slots.every((s) => s.x >= 0 && s.x <= A && s.y >= 0 && s.y <= 1) &&
            Number.isInteger(n) &&
            n >= 1 &&
            n <= DEMAND_N_MAX &&
            r >= hitRadiusMin &&
            r <= hitRadiusMax &&
            m >= 0 &&
            m <= MARGIN_MAX
          ),
      ),
    ).toEqual([]);
    for (const share of [...quarterShares(xs), ...quarterShares(ys)]) {
      expect(share).toBeGreaterThanOrEqual(MIN_QUARTER_SHARE);
    }
    expect({ x: reaches(xs), y: reaches(ys) }).toEqual({ x: allTrue, y: allTrue });
    const demands = samples.map((s) => s.demand);
    expect({
      rMin: demands.some((d) => d.r === hitRadiusMin),
      rMax: demands.some((d) => d.r === hitRadiusMax),
      rBetween: demands.some((d) => d.r > hitRadiusMin && d.r < hitRadiusMax),
      mZero: demands.some((d) => d.m === 0),
      mMax: demands.some((d) => d.m === MARGIN_MAX),
      mBetween: demands.some((d) => d.m > 0 && d.m < MARGIN_MAX),
      nOne: demands.some((d) => d.n === 1),
      nMax: demands.some((d) => d.n === DEMAND_N_MAX),
      oneSlot: demands.some((d) => d.slots.length === 1),
      mostSlots: demands.some((d) => d.slots.length === DEMAND_SLOTS_MAX),
      moreTargetsThanSlots: demands.some((d) => d.n > d.slots.length),
    }).toEqual({
      rMin: true,
      rMax: true,
      rBetween: true,
      mZero: true,
      mMax: true,
      mBetween: true,
      nOne: true,
      nMax: true,
      oneSlot: true,
      mostSlots: true,
      moreTargetsThanSlots: true,
    });
  });

  it('genHitAreas and genTargetPath stay in range and reach 1 to 3 targets, overlapping and apart, an activation id that changes and comes back, a radius and a centre that change under one id, removals and returns, and every kind of path point', () => {
    const cases = fc.sample(
      fc
        .integer({ min: DWELL_STEPS_MIN, max: DWELL_STEPS_MAX })
        .chain((count) => genHitAreas(count).chain((world) => genTargetPath(world).map((path) => ({ count, world, path })))),
      SAMPLE,
    );
    const { hitRadiusMin, hitRadiusMax } = TUNING;
    const areas = cases.flatMap((c) => c.world.areas.flat());
    const origins = cases.map((c) => c.world.bases[0]?.centre ?? { x: NaN, y: NaN });

    expect(
      cases.filter(
        ({ count, world, path }) =>
          !(
            world.areas.length === count &&
            path.length === count &&
            world.bases.length >= 1 &&
            world.bases.length <= DWELL_TARGETS_MAX &&
            world.areas.every(
              (step) =>
                new Set(step.map((a) => a.targetId)).size === step.length &&
                step.every(
                  (a) =>
                    a.radius >= hitRadiusMin &&
                    a.radius <= hitRadiusMax &&
                    Number.isFinite(a.centre.x) &&
                    Number.isFinite(a.centre.y) &&
                    /^a\d$/.test(a.activationId) &&
                    Number(a.activationId.slice(1)) < DWELL_ACTIVATIONS,
                ),
            ) &&
            path.every((p) => Number.isFinite(p.pos.x) && Number.isFinite(p.pos.y))
          ),
      ),
    ).toEqual([]);
    const thin = [
      { name: 'radius', values: areas.map((a) => a.radius), lo: hitRadiusMin, hi: hitRadiusMax },
      { name: 'first centre x', values: origins.map((o) => o.x), lo: 0, hi: ASPECT_MAX },
      { name: 'first centre y', values: origins.map((o) => o.y), lo: 0, hi: 1 },
    ].flatMap(({ name, values, lo, hi }) => {
      const shares = quarterSharesOf(values, lo, hi);
      return Math.min(...shares) >= MIN_QUARTER_SHARE ? [] : [`${name}: quarter shares ${shares.join(', ')}`];
    });
    expect(thin).toEqual([]);

    // What the supply of one target does between two steps, over every target of every case.
    let overlap = false;
    let multiSteps = 0;
    let deepSteps = 0;
    let apart = false;
    let activationChanges = false;
    let activationReturns = false;
    let radiusChanges = false;
    let centreChanges = false;
    let removedAndBack = false;
    let nothingSupplied = false;
    let validInside = false;
    let validOutside = false;
    let invalidInside = false;
    let invalidOutside = false;
    let longestRunSteps = 0;
    const targetCounts = new Set<number>();
    for (const { world, path } of cases) {
      targetCounts.add(world.bases.length);
      let restSteps = 0;
      let restKey: string | null = null;
      world.areas.forEach((step, i) => {
        if (step.length === 0) nothingSupplied = true;
        let deepHere = false;
        for (const a of step) {
          for (const b of step) {
            if (a.targetId >= b.targetId) continue;
            const between = dist(a.centre, b.centre);
            if (between < a.radius + b.radius) overlap = true;
            else apart = true;
            // The centre of one lies inside the circle of the other: more than a graze.
            if (between < Math.max(a.radius, b.radius)) deepHere = true;
          }
        }
        if (step.length >= 2) {
          multiSteps += 1;
          if (deepHere) deepSteps += 1;
        }
        const point = path[i];
        if (point !== undefined) {
          const on = step.find((a) => insideArea(true, point.pos, a));
          if (point.valid && on !== undefined) validInside = true;
          if (point.valid && on === undefined) validOutside = true;
          if (!point.valid && on !== undefined) invalidInside = true;
          if (!point.valid && on === undefined) invalidOutside = true;
          // A rest: consecutive steps valid and inside one hit area that does not change, at one position.
          const key =
            on === undefined
              ? null
              : `${on.targetId}|${on.activationId}|${on.radius}|${on.centre.x}|${on.centre.y}|${point.pos.x}|${point.pos.y}`;
          restSteps = point.valid && key !== null ? (key === restKey ? restSteps + 1 : 1) : 0;
          restKey = point.valid ? key : null;
          longestRunSteps = Math.max(longestRunSteps, restSteps);
        }
      });
      for (const base of world.bases) {
        const seq = world.areas.map((step) => step.find((a) => a.targetId === base.targetId));
        let wasPresent = false;
        let wasAbsentAfter = false;
        const seenIds: string[] = [];
        seq.forEach((a, i) => {
          const previous = seq[i - 1];
          if (a === undefined) {
            if (wasPresent) wasAbsentAfter = true;
            return;
          }
          if (wasAbsentAfter) removedAndBack = true;
          wasPresent = true;
          if (previous !== undefined) {
            if (previous.activationId !== a.activationId) activationChanges = true;
            else {
              if (previous.radius !== a.radius) radiusChanges = true;
              if (previous.centre.x !== a.centre.x || previous.centre.y !== a.centre.y) centreChanges = true;
            }
          }
          if (seenIds[seenIds.length - 1] !== a.activationId) {
            if (seenIds.includes(a.activationId)) activationReturns = true;
            seenIds.push(a.activationId);
          }
        });
      }
    }
    expect(multiSteps, 'steps with two or more targets').toBeGreaterThan(0);
    expect(deepSteps / multiSteps, 'the share of those steps in which two targets overlap deeply').toBeGreaterThanOrEqual(
      MIN_DEEP_OVERLAP_SHARE,
    );
    expect({
      oneTarget: targetCounts.has(1),
      twoTargets: targetCounts.has(2),
      threeTargets: targetCounts.has(DWELL_TARGETS_MAX),
      overlap,
      apart,
      activationChanges,
      activationReturns,
      radiusChanges,
      centreChanges,
      removedAndBack,
      nothingSupplied,
      validInside,
      validOutside,
      invalidInside,
      invalidOutside,
      aRestOfDwellLength: longestRunSteps >= TUNING.dwellMs / TUNING.maxClockStepMs,
      aRestLongerThanAMediumSegment: longestRunSteps > DWELL_MEDIUM_RUN_MAX,
    }).toEqual({
      oneTarget: true,
      twoTargets: true,
      threeTargets: true,
      overlap: true,
      apart: true,
      activationChanges: true,
      activationReturns: true,
      radiusChanges: true,
      centreChanges: true,
      removedAndBack: true,
      nothingSupplied: true,
      validInside: true,
      validOutside: true,
      invalidInside: true,
      invalidOutside: true,
      aRestOfDwellLength: true,
      aRestLongerThanAMediumSegment: true,
    });
  });

  it('genDwellRun has the steps, deltas and pointers it promises and, in the reducer, reaches selections, a second selection of one target, Outside releases, Invalid cancels, drops by activation change and by removal, a latch that blocks and one that ends, one pointer on two targets and two pointers on two', () => {
    const runs = fc.sample(genDwellRun(), SAMPLE);
    const steps = runs.flat();
    const spreadRuns = runs.filter((run) => run.some((s) => s.dt !== run[0]?.dt));
    const wristsOf = (run: readonly DwellStepCase[]): string =>
      [...new Set(run.flatMap((s) => s.pointers.map((p) => p.wrist)))].sort().join('+');

    expect(
      runs.filter(
        (run) =>
          !(
            run.length >= DWELL_STEPS_MIN &&
            run.length <= DWELL_STEPS_MAX &&
            run.every(
              (s) =>
                s.dt >= 0 &&
                s.dt <= MAX &&
                s.pointers.length >= 1 &&
                s.pointers.length <= 2 &&
                new Set(s.pointers.map((p) => p.wrist)).size === s.pointers.length &&
                s.pointers.every((p) => !p.valid || (Number.isFinite(p.pos.x) && Number.isFinite(p.pos.y))),
            )
          ),
      ),
    ).toEqual([]);
    const shares = quarterSharesOf(spreadRuns.flatMap((run) => run.map((s) => s.dt)), 0, MAX);
    expect(Math.min(...shares), `quarter shares of dt in the runs that are not constant: ${shares.join(', ')}`).toBeGreaterThanOrEqual(
      MIN_QUARTER_SHARE,
    );

    const tallies = runs.map(tallyRun);
    const selectingShare = tallies.filter((t) => t.selections > 0).length / runs.length;
    expect(selectingShare, 'the share of runs with a selection').toBeGreaterThanOrEqual(MIN_SELECTING_RUN_SHARE);
    expect({
      deltaZero: steps.some((s) => s.dt === 0),
      deltaMax: steps.some((s) => s.dt === MAX),
      allDeltasMax: runs.some((run) => run.every((s) => s.dt === MAX)),
      allDeltasHalf: runs.some((run) => run.every((s) => s.dt === MAX / 2)),
      onlyRight: runs.some((run) => wristsOf(run) === 'right'),
      onlyLeft: runs.some((run) => wristsOf(run) === 'left'),
      both: runs.some((run) => wristsOf(run) === 'left+right'),
      invalidPointerCarriesAPosition: steps.some((s) => s.pointers.some((p) => !p.valid && 'pos' in p)),
      aRestOfDwellLength: runs.some((run) => longestRestMs(run) >= TUNING.dwellMs),
      selection: tallies.some((t) => t.selections > 0),
      sameTargetTwice: tallies.some((t) => t.sameTargetTwice),
      outsideRelease: tallies.some((t) => t.outsideRelease),
      invalidCancel: tallies.some((t) => t.invalidCancel),
      droppedByActivation: tallies.some((t) => t.droppedByActivation),
      droppedByRemoval: tallies.some((t) => t.droppedByRemoval),
      latchBlocksAnInsidePointer: tallies.some((t) => t.latchBlocksAnInsidePointer),
      latchEnded: tallies.some((t) => t.latchEnded),
      onePointerOwnsTwoTargets: tallies.some((t) => t.onePointerOwnsTwoTargets),
      bothWristsOwn: tallies.some((t) => t.bothWristsOwn),
    }).toEqual({
      deltaZero: true,
      deltaMax: true,
      allDeltasMax: true,
      allDeltasHalf: true,
      onlyRight: true,
      onlyLeft: true,
      both: true,
      invalidPointerCarriesAPosition: true,
      aRestOfDwellLength: true,
      selection: true,
      sameTargetTwice: true,
      outsideRelease: true,
      invalidCancel: true,
      droppedByActivation: true,
      droppedByRemoval: true,
      latchBlocksAnInsidePointer: true,
      latchEnded: true,
      onePointerOwnsTwoTargets: true,
      bothWristsOwn: true,
    });
  });

  it('genTwoPointerInterleaving gives the owner the target first in both runs, changes only the other pointer, and reaches both owners, every approach length, and an other pointer that is inside, nearer the centre, outside and invalid', () => {
    const cases = fc.sample(genTwoPointerInterleaving(), SAMPLE);
    const otherOf = (owner: WristId): WristId => (owner === 'left' ? 'right' : 'left');
    const pointerOfWrist = (pointers: readonly PointerInput[], wrist: WristId): PointerInput | undefined =>
      pointers.find((p) => p.wrist === wrist);

    // The contract of the generator, checked in the reducer: the owner holds the target from the step it arrives.
    const broken = cases.flatMap(({ owner, acquireAt, steps, replaced }, n) => {
      const problems: string[] = [];
      for (const [name, run] of [['steps', steps], ['replaced', replaced]] as const) {
        let state: DwellState = createDwell();
        run.forEach((step, i) => {
          const area = step.hitAreas[0] as HitArea;
          const before = dwellView(state, 't0').owner;
          const other = pointerOfWrist(step.pointers, otherOf(owner));
          if (i <= acquireAt && other !== undefined && other.valid && insideArea(true, other.pos, area)) {
            problems.push(`case ${n} ${name}: the other pointer is inside at step ${i}`);
          }
          state = stepDwell(state, { dt: step.dt, pointers: step.pointers, hitAreas: step.hitAreas }).state;
          if (i === acquireAt && dwellView(state, 't0').owner !== owner) {
            problems.push(`case ${n} ${name}: the owner does not hold the target at step ${i}`);
          }
          if (i < acquireAt && before !== null) problems.push(`case ${n} ${name}: held before step ${acquireAt}`);
        });
      }
      const sameOwnerPath = steps.every((s, i) => {
        const r = replaced[i];
        const a = pointerOfWrist(s.pointers, owner);
        const b = r === undefined ? undefined : pointerOfWrist(r.pointers, owner);
        return r !== undefined && s.dt === r.dt && s.hitAreas === r.hitAreas && JSON.stringify(a) === JSON.stringify(b);
      });
      if (!sameOwnerPath || steps.length !== replaced.length) problems.push(`case ${n}: more than the other pointer changed`);
      if (steps.some((s) => s.pointers.length !== 2)) problems.push(`case ${n}: not two pointers in every step`);
      return problems;
    });
    expect(broken.slice(0, 5)).toEqual([]);

    const after = (c: (typeof cases)[number], visit: (other: PointerInput, owner: PointerInput, area: HitArea) => boolean): boolean =>
      c.steps.some((s, i) => {
        const other = pointerOfWrist(s.pointers, otherOf(c.owner));
        const mine = pointerOfWrist(s.pointers, c.owner);
        return i > c.acquireAt && other !== undefined && mine !== undefined && visit(other, mine, s.hitAreas[0] as HitArea);
      });
    expect({
      ownerLeft: cases.some((c) => c.owner === 'left'),
      ownerRight: cases.some((c) => c.owner === 'right'),
      noApproach: cases.some((c) => c.acquireAt === 0),
      longestApproach: cases.some((c) => c.acquireAt === DWELL_APPROACH_MAX),
      otherChanges: cases.some((c) => JSON.stringify(c.steps) !== JSON.stringify(c.replaced)),
      otherInsideAfterwards: cases.some((c) => after(c, (o, _m, a) => o.valid && insideArea(true, o.pos, a))),
      otherNearerTheCentre: cases.some((c) =>
        after(c, (o, m, a) => o.valid && m.valid && dist(o.pos, a.centre) < dist(m.pos, a.centre) && dist(o.pos, a.centre) <= a.radius),
      ),
      otherOutside: cases.some((c) => after(c, (o, _m, a) => o.valid && !insideArea(true, o.pos, a))),
      otherInvalid: cases.some((c) => after(c, (o) => !o.valid)),
    }).toEqual({
      ownerLeft: true,
      ownerRight: true,
      noApproach: true,
      longestApproach: true,
      otherChanges: true,
      otherInsideAfterwards: true,
      otherNearerTheCentre: true,
      otherOutside: true,
      otherInvalid: true,
    });
    const holds = cases.filter((c) => {
      let state: DwellState = createDwell();
      let heldFor = 0;
      for (const step of c.steps) {
        state = stepDwell(state, { dt: step.dt, pointers: step.pointers, hitAreas: step.hitAreas }).state;
        heldFor = dwellView(state, 't0').owner === c.owner ? heldFor + 1 : heldFor;
      }
      return heldFor >= 2 * DWELL_APPROACH_MAX;
    }).length;
    expect(holds / cases.length, 'the share of cases in which the owner holds the target for a while').toBeGreaterThanOrEqual(
      MIN_SELECTING_RUN_SHARE,
    );
  });

  it('genStintRun cuts its stints into exact steps, and reaches stints at, just under and just over each window, all three step sizes, steps of delta 0, and bounded stints that alternate for far longer than the windows', () => {
    const W = TUNING.outsideWindowMs;
    const V = TUNING.invalidWindowMs;
    const { hitRadiusMin, hitRadiusMax, maxClockStepMs } = TUNING;
    const free = fc.sample(genStintRun(false), SAMPLE);
    const bounded = fc.sample(genStintRun(true), SAMPLE);
    const all = [...free, ...bounded];

    const broken = all.flatMap((run, n) => {
      const problems: string[] = [];
      const first = run.steps[0];
      if (run.stints.length < STINT_COUNT_MIN || run.stints.length > STINT_COUNT_MAX) problems.push(`run ${n}: ${run.stints.length} stints`);
      if (first === undefined || stepKind(first) !== 'inside') problems.push(`run ${n}: the first step does not acquire`);
      if (!run.steps.every((s) => s.dt >= 0 && s.dt <= maxClockStepMs && s.hitAreas.length === 1 && s.pointers.length === 1)) {
        problems.push(`run ${n}: a step outside the contract`);
      }
      if (!(run.area.radius >= hitRadiusMin && run.area.radius <= hitRadiusMax)) problems.push(`run ${n}: radius ${run.area.radius}`);
      // Whole milliseconds, so that every sum of steps is exact.
      if (!run.stints.every((s) => Number.isInteger(s.ms) && s.ms >= 0)) problems.push(`run ${n}: a stint that is not whole milliseconds`);
      if (JSON.stringify(joinedSteps(run)) !== JSON.stringify(joinedStints(run))) problems.push(`run ${n}: the steps do not add up to the stints`);
      if (run.bounded) {
        // The premise of Req 17.22, measured from the steps.
        for (const j of joinedSteps(run)) {
          if (j.kind === 'outside' && j.ms > W) problems.push(`run ${n}: an Outside stint of ${j.ms} ms`);
          if (j.kind === 'invalid' && j.ms > V) problems.push(`run ${n}: an Invalid stint of ${j.ms} ms`);
        }
        run.stints.forEach((s, i) => {
          if (s.kind !== 'inside' && run.stints[i - 1]?.kind === s.kind) problems.push(`run ${n}: two ${s.kind} stints in a row`);
        });
      }
      return problems;
    });
    expect(broken.slice(0, 5)).toEqual([]);

    const stintMs = (runs: readonly StintRun[], kind: StintKind): number[] =>
      runs.flatMap((r) => joinedSteps(r).filter((j) => j.kind === kind).map((j) => j.ms));
    const stepsOf = (runs: readonly StintRun[]): DwellStepCase[] => runs.flatMap((r) => r.steps.slice(1));
    const longestAwayMs = (run: StintRun): number => {
      let sum = 0;
      let longest = 0;
      for (const j of joinedSteps(run)) {
        sum = j.kind === 'inside' ? 0 : sum + j.ms;
        longest = Math.max(longest, sum);
      }
      return longest;
    };
    const freeOutside = stintMs(free, 'outside');
    const freeInvalid = stintMs(free, 'invalid');
    const boundedOutside = stintMs(bounded, 'outside');
    const boundedInvalid = stintMs(bounded, 'invalid');
    const freeTallies = free.map((r) => tallyRun(r.steps));
    // One stint as drawn, before neighbours of one kind are joined: longer than the draws at the window.
    const drawn = (kind: StintKind): number[] => free.flatMap((r) => r.stints.filter((s) => s.kind === kind).map((s) => s.ms));
    // Runs of steps of one size inside a stint: a remainder cannot make four steps of half a step, or eight odd ones.
    const longestRunOfDelta = (run: StintRun, dt: number): number => {
      let longest = 0;
      let current = 0;
      for (const s of run.steps.slice(1)) {
        current = s.dt === dt ? current + 1 : 0;
        longest = Math.max(longest, current);
      }
      return longest;
    };
    const reached: Record<string, boolean> = {
      outsideJustUnder: freeOutside.includes(W - 1),
      outsideAtTheWindow: freeOutside.includes(W),
      outsideJustOver: freeOutside.includes(W + 1),
      outsideLong: drawn('outside').some((ms) => ms > W + 1),
      invalidJustUnder: freeInvalid.includes(V - 1),
      invalidAtTheWindow: freeInvalid.includes(V),
      invalidJustOver: freeInvalid.includes(V + 1),
      invalidLong: drawn('invalid').some((ms) => ms > V + 1),
      fullSteps: all.some((r) => longestRunOfDelta(r, maxClockStepMs) >= 3),
      halfSteps: all.some((r) => longestRunOfDelta(r, maxClockStepMs / 2) >= 4),
      oddSteps: all.some((r) => longestRunOfDelta(r, STINT_ODD_STEP_MS) >= 8),
      zeroSteps: stepsOf(all).some((s) => s.dt === 0),
      invalidPointerCarriesAPosition: stepsOf(all).some((s) => s.pointers.some((p) => !p.valid && 'pos' in p)),
      boundedOutsideAtTheWindow: boundedOutside.includes(W),
      boundedInvalidAtTheWindow: boundedInvalid.includes(V),
      boundedAwayFarPastTheWindows: bounded.some((r) => longestAwayMs(r) >= 2 * (W + V)),
      outsideReleaseInTheReducer: freeTallies.some((t) => t.outsideRelease),
      invalidCancelInTheReducer: freeTallies.some((t) => t.invalidCancel),
      selectionInTheReducer: freeTallies.some((t) => t.selections > 0),
    };
    expect(Object.keys(reached).filter((name) => reached[name] !== true), 'what the stint runs did not reach').toEqual([]);
    expect(
      bounded.filter((r) => holdsAtTheEnd(r.steps)).length / bounded.length,
      'the share of bounded runs in which the hold is still there at the end',
    ).toBeGreaterThanOrEqual(MIN_HELD_AT_END_SHARE);
  });

  it('genReselectRun selects one target again and again, with activation ids that repeat and come back, and reaches leaving outside, going invalid, staying inside and a latch that blocks', () => {
    const runs = fc.sample(genReselectRun(), SAMPLE);
    const { maxClockStepMs } = TUNING;
    const tallies = runs.map(tallyRun);
    // The activation ids in the order the steps offer them, neighbours of one id joined.
    const idsOf = (run: readonly DwellStepCase[]): string[] => {
      const ids: string[] = [];
      for (const s of run) {
        const id = s.hitAreas[0]?.activationId;
        if (id !== undefined && ids[ids.length - 1] !== id) ids.push(id);
      }
      return ids;
    };
    const broken = runs.flatMap((run, n) => {
      const problems: string[] = [];
      if (run.length < RESELECT_CYCLES_MIN * (TUNING.dwellMs / maxClockStepMs)) problems.push(`run ${n}: only ${run.length} steps`);
      if (!run.every((s) => s.pointers.length >= 1 && s.pointers.length <= 2 && s.hitAreas.length <= 1 && (s.dt === maxClockStepMs || s.dt === maxClockStepMs / 2))) {
        problems.push(`run ${n}: a step outside the contract`);
      }
      return problems;
    });
    expect(broken.slice(0, 5)).toEqual([]);
    const reached: Record<string, boolean> = {
      idReturnsAfterAnother: runs.some((run) => idsOf(run).some((id, i, ids) => ids.indexOf(id) !== i)),
      idsChange: runs.some((run) => idsOf(run).length >= 2),
      oneIdOnly: runs.some((run) => idsOf(run).length === 1),
      fullSteps: runs.some((run) => run.every((s) => s.dt === maxClockStepMs)),
      halfSteps: runs.some((run) => run.every((s) => s.dt === maxClockStepMs / 2)),
      anOutsideStep: runs.some((run) => run.some((s) => stepKind(s) === 'outside')),
      aTargetThatIsNotSupplied: runs.some((run) => run.some((s) => s.hitAreas.length === 0)),
      aSecondPointer: runs.some((run) => run.every((s) => s.pointers.length === 2)),
      aSecondPointerThatStaysInside: runs.some((run) =>
        run.every((s) => s.pointers.some((p) => p.wrist === 'left' && p.valid && s.hitAreas[0] !== undefined && insideArea(true, p.pos, s.hitAreas[0]))),
      ),
      anInvalidStepAtTheCentre: runs.some((run) => run.some((s) => s.pointers.some((p) => !p.valid && 'pos' in p))),
      theRightWristGoesInvalid: runs.some((run) => run.some((s) => s.pointers.some((p) => p.wrist === 'right' && !p.valid))),
      // An activation id selects once for good, so one target selects at most as often as there are ids.
      everyIdSelected: tallies.some((t) => t.selections >= DWELL_ACTIVATIONS),
      moreCyclesThanIds: runs.some((run) => run.length >= RESELECT_CYCLES_MAX * (TUNING.dwellMs / maxClockStepMs)),
      sameTargetTwice: tallies.some((t) => t.sameTargetTwice),
      latchBlocksAnInsidePointer: tallies.some((t) => t.latchBlocksAnInsidePointer),
      latchEnded: tallies.some((t) => t.latchEnded),
    };
    expect(Object.keys(reached).filter((name) => reached[name] !== true), 'what the re-selection runs did not reach').toEqual([]);
    expect(
      tallies.filter((t) => t.sameTargetTwice).length / runs.length,
      'the share of re-selection runs that select one target twice',
    ).toBeGreaterThanOrEqual(MIN_RESELECT_SHARE);
  });

  it('genTrackingRun keeps its steps in range, always leaves an active wrist valid when asked to, and reaches every wrist pattern, a wrist that is not active, pauses and hidden steps, nose gaps, and in the lifecycle holds, overlays, ends of holds at exact times, short valid stretches in a hold, and the hint', () => {
    const free = fc.sample(genTrackingRun(false), SAMPLE);
    const alwaysOne = fc.sample(genTrackingRun(true), SAMPLE);
    const all = [...free, ...alwaysOne];
    const { maxClockStepMs } = TUNING;
    const validActive = (run: TrackingRunCase, s: TrackingRunCase['steps'][number]): boolean => run.activeWrists.some((w) => s.wristValid[w]);

    const broken = all.flatMap((run, n) => {
      const problems: string[] = [];
      if (run.steps.length < TRACKING_STEPS_MIN || run.steps.length > TRACKING_STEPS_MAX) problems.push(`run ${n}: ${run.steps.length} steps`);
      if (run.activeWrists.length < 1) problems.push(`run ${n}: no active wrist`);
      if (!run.steps.every((s) => s.rawDt >= 0 && s.rawDt <= maxClockStepMs)) problems.push(`run ${n}: a delta outside 0..maxClockStepMs`);
      return problems;
    });
    expect(broken.slice(0, 5)).toEqual([]);
    expect(
      alwaysOne.filter((run) => run.steps.some((s) => !validActive(run, s))).length,
      'runs asked to keep an active wrist valid that have a step without one',
    ).toBe(0);

    const steps = free.flatMap((run) => run.steps.map((s) => ({ run, s })));
    const tallies = free.map(tallyTracking);
    const alwaysOneSteps = alwaysOne.flatMap((run) => run.steps.map((s) => ({ run, s })));
    const reached: Record<string, boolean> = {
      bothValid: steps.some(({ run, s }) => run.activeWrists.length === 2 && s.wristValid.left && s.wristValid.right),
      onlyLeftValid: steps.some(({ run, s }) => run.activeWrists.length === 2 && s.wristValid.left && !s.wristValid.right),
      onlyRightValid: steps.some(({ run, s }) => run.activeWrists.length === 2 && !s.wristValid.left && s.wristValid.right),
      noneValid: steps.some(({ run, s }) => !validActive(run, s)),
      anInactiveWristValidWhileNoActiveOne: steps.some(({ run, s }) => !validActive(run, s) && (s.wristValid.left || s.wristValid.right)),
      leftOnly: free.some((run) => run.activeWrists.length === 1 && run.activeWrists[0] === 'left'),
      rightOnly: free.some((run) => run.activeWrists.length === 1 && run.activeWrists[0] === 'right'),
      bothActive: free.some((run) => run.activeWrists.length === 2),
      paused: steps.some(({ s }) => s.paused),
      hidden: steps.some(({ s }) => s.hidden),
      running: steps.some(({ s }) => !s.paused && !s.hidden),
      deltaZero: steps.some(({ s }) => s.rawDt === 0),
      deltaMax: steps.some(({ s }) => s.rawDt === maxClockStepMs),
      allDeltasMax: free.some((run) => run.steps.every((s) => s.rawDt === maxClockStepMs)),
      allDeltasHalf: free.some((run) => run.steps.every((s) => s.rawDt === maxClockStepMs / 2)),
      noseGapWithAWristValid: steps.some(({ run, s }) => !s.noseValid && validActive(run, s)),
      noseFlicker: free.some((run) => run.steps.some((s, i) => !s.noseValid && run.steps[i - 1]?.noseValid === true && run.steps[i + 1]?.noseValid === true)),
      alwaysOneNoseInvalid: alwaysOneSteps.some(({ s }) => !s.noseValid),
      alwaysOneSingleWristOfTwo: alwaysOneSteps.some(({ run, s }) => run.activeWrists.length === 2 && s.wristValid.left !== s.wristValid.right),
      alwaysOnePaused: alwaysOneSteps.some(({ s }) => s.paused || s.hidden),
      holdBegan: tallies.some((t) => t.holdBegan),
      overlayShown: tallies.some((t) => t.overlayShown),
      holdEnded: tallies.some((t) => t.holdEnded),
      hintShown: tallies.some((t) => t.hintShown),
      lostExactlyAtTheThreshold: tallies.some((t) => t.lostExactlyAtTheThreshold),
      holdBeganJustOver: tallies.some((t) => t.holdBeganJustOver),
      endedExactlyAtTheResumeTime: tallies.some((t) => t.endedExactlyAtTheResumeTime),
      twoShortStretchesInOneHold: tallies.some((t) => t.mostShortStretchesInOneHold >= 2),
    };
    expect(Object.keys(reached).filter((name) => reached[name] !== true), 'what the tracking runs did not reach').toEqual([]);
    expect(
      tallies.filter((t) => t.holdBegan).length / free.length,
      'the share of tracking runs in which a hold begins',
    ).toBeGreaterThanOrEqual(MIN_HOLD_RUN_SHARE);
    // Gaps of 0..2000 ms (design section 10.1): the long ones are drawn, not only the short.
    expect(
      tallies.filter((t) => t.longestLostMs >= GAP_MAX_MS).length / free.length,
      'the share of tracking runs with a gap of GAP_MAX_MS or more',
    ).toBeGreaterThanOrEqual(MIN_LONG_GAP_RUN_SHARE);
  });

  it('genHelpSession keeps its sessions in range, and reaches every kind of event, every combination of flags, rounds left open and events outside a round, and in the policy offers, changes made at once and after a wait, a queue of two, 2 * helpMaxLevel changes, the fallback, a tie, and "continue with help" with nothing left', () => {
    const sessions = fc.sample(genHelpSession(), SAMPLE);
    const events = sessions.flat();
    const { difficultiesBeforeHelp } = TUNING;
    const startsOf = (session: readonly HelpEvent[]): number[] =>
      session.flatMap((e) => (e.kind === 'roundStarted' ? [e.steps] : []));

    const broken = sessions.flatMap((session, n) => {
      const problems: string[] = [];
      const steps = startsOf(session);
      if (steps.length < 1 || steps.length > HELP_ROUNDS_MAX) problems.push(`session ${n}: ${steps.length} rounds`);
      if (!steps.every((s) => Number.isInteger(s) && s >= 1 && s <= HELP_STEPS_MAX)) problems.push(`session ${n}: a step count outside 1..${HELP_STEPS_MAX}`);
      if (!session.every((e) => typeof e.dwellActive === 'boolean' && typeof e.playbackActive === 'boolean')) {
        problems.push(`session ${n}: a flag that is not a boolean`);
      }
      if (!session.every((e) => e.kind !== 'difficulty' || e.axis === 'motor' || e.axis === 'cognitive')) problems.push(`session ${n}: an unknown axis`);
      return problems;
    });
    expect(broken.slice(0, 5)).toEqual([]);

    const tallies = sessions.map(tallyHelp);
    const lengths = sessions.flatMap(helpBodyLengths);
    const ended = tallies.flatMap((t) => t.endedWith);
    const reached: Record<string, boolean> = {
      oneRound: sessions.some((s) => startsOf(s).length === 1),
      theMostRounds: sessions.some((s) => startsOf(s).length === HELP_ROUNDS_MAX),
      oneStep: sessions.some((s) => startsOf(s).includes(1)),
      theMostSteps: sessions.some((s) => startsOf(s).includes(HELP_STEPS_MAX)),
      neitherFlag: events.some((e) => !e.dwellActive && !e.playbackActive),
      dwellOnly: events.some((e) => e.dwellActive && !e.playbackActive),
      playbackOnly: events.some((e) => !e.dwellActive && e.playbackActive),
      bothFlags: events.some((e) => e.dwellActive && e.playbackActive),
      aMotorDifficulty: events.some((e) => e.kind === 'difficulty' && e.axis === 'motor'),
      aCognitiveDifficulty: events.some((e) => e.kind === 'difficulty' && e.axis === 'cognitive'),
      aCompletedStep: events.some((e) => e.kind === 'stepCompleted'),
      aContinueWithHelp: events.some((e) => e.kind === 'continueWithHelp'),
      aRoundEndAllowingAMotorStep: events.some((e) => e.kind === 'roundEnded' && e.motorStepAllowed),
      aRoundEndNotAllowingOne: events.some((e) => e.kind === 'roundEnded' && !e.motorStepAllowed),
      anEventBeforeTheFirstRound: sessions.some((s) => s[0]?.kind !== 'roundStarted'),
      aRoundWithNoEventsBetweenStartAndEnd: lengths.includes(0),
      aRoundWithTheMostEvents: lengths.includes(HELP_BODY_MAX),
      aRoundWithOneDifficultyFewerThanItNeeds: ended.includes(difficultiesBeforeHelp - 1),
      aRoundWithExactlyTheDifficultiesItNeeds: ended.includes(difficultiesBeforeHelp),
      aRoundWithMoreDifficultiesThanItNeeds: ended.some((d) => d > difficultiesBeforeHelp),
      aRoundLeftOpenAndReplaced: tallies.some((t) => t.roundReplaced),
      aSessionEndingInARound: tallies.some((t) => t.endedInsideARound),
      aRoundEndOutsideARound: tallies.some((t) => t.roundEndOutsideARound),
      continueWithHelpOutsideARound: tallies.some((t) => t.continueOutsideARound),
      continueWithHelpWithNothingLeft: tallies.some((t) => t.continueBeyondTheEnd),
      helpOffered: tallies.some((t) => t.offers > 0),
      aChangeAtOnce: tallies.some((t) => t.immediateRaise),
      aChangeAfterAWait: tallies.some((t) => t.deferredRaise),
      waitingForADwell: tallies.some((t) => t.heldByDwell),
      waitingForAPlayback: tallies.some((t) => t.heldByPlayback),
      waitingForBoth: tallies.some((t) => t.heldByBoth),
      behindAWaitingChange: tallies.some((t) => t.queuedBehindAWaitingChange),
      aQueueOfTwo: tallies.some((t) => t.longestQueue >= 2),
      theMostChanges: tallies.some((t) => t.atTheTop),
      aTieThatRaised: tallies.some((t) => t.tieRaise),
      theFallback: tallies.some((t) => t.fallback),
      nothingToRaise: tallies.some((t) => t.nothingToRaise),
    };
    expect(Object.keys(reached).filter((name) => reached[name] !== true), 'what the help sessions did not reach').toEqual([]);

    const share = (pick: (t: HelpTally) => boolean): number => tallies.filter(pick).length / tallies.length;
    const shares: Record<HelpShareName, number> = {
      raise: share((t) => t.raises > 0),
      immediateRaise: share((t) => t.immediateRaise),
      deferredRaise: share((t) => t.deferredRaise),
      queueOfTwo: share((t) => t.longestQueue >= 2),
      atTheTop: share((t) => t.atTheTop),
      fallback: share((t) => t.fallback),
      continueBeyondTheEnd: share((t) => t.continueBeyondTheEnd),
      waitForADwell: share((t) => t.heldByDwell),
      waitForAPlayback: share((t) => t.heldByPlayback),
      waitForBoth: share((t) => t.heldByBoth),
      behindAWaitingChange: share((t) => t.queuedBehindAWaitingChange),
    };
    const below = (Object.keys(HELP_SHARE_FLOORS) as HelpShareName[])
      .filter((name) => shares[name] < HELP_SHARE_FLOORS[name])
      .map((name) => `${name}: ${shares[name]} of the sessions, floor ${HELP_SHARE_FLOORS[name]}`);
    expect(below, 'the shares of help sessions below their floors').toEqual([]);
  });

  /**
   * The time limit of the settings-string coverage test, in milliseconds. It takes about 1.7 s on a quiet
   * machine, which is a third of vitest's default limit of 5 s, and went over that limit in one full run
   * of the suite on a busy machine. The other slow tests of the suite have 60 s. A test parameter.
   */
  const SETTINGS_COVERAGE_TIMEOUT_MS = 60_000;
  it('genSettingsString reaches non-JSON text, every top level that is not an object, wrong and missing versions, one invalid or missing field, keys such as "__proto__" and "constructor", deep nesting and very long text', () => {
    const strings = fc.sample(genSettingsString(), SAMPLE);
    const tallies = strings.map(kindsOfSettingsString);
    const share = (kind: SettingsKind): number => tallies.filter((k) => k.has(kind)).length / tallies.length;
    const hostileSeen = SETTINGS_HOSTILE_KEYS.filter((key) =>
      strings.some((s) => {
        try {
          const v: unknown = JSON.parse(s);
          return typeof v === 'object' && v !== null && Object.keys(v).includes(key);
        } catch {
          return false;
        }
      }),
    );
    expect(hostileSeen, 'hostile keys that appear as keys of a parsed string').toEqual([...SETTINGS_HOSTILE_KEYS]);
    expect(
      strings.some((s) => s.includes('['.repeat(DEEP_ENOUGH))),
      `nesting at least ${DEEP_ENOUGH} levels deep`,
    ).toBe(true);
    expect(strings.some((s, i) => s.length >= LONG_ENOUGH && tallies[i]?.has('long')), `a string at least ${LONG_ENOUGH} characters long`).toBe(true);
    const below = (Object.keys(SETTINGS_SHARE_FLOORS) as SettingsKind[])
      .filter((k) => share(k) < SETTINGS_SHARE_FLOORS[k])
      .map((k) => `${k}: ${share(k)} of the strings, floor ${SETTINGS_SHARE_FLOORS[k]}`);
    expect(below.join('; '), 'the shares of settings strings below their floors').toBe('');
  }, SETTINGS_COVERAGE_TIMEOUT_MS);
});
