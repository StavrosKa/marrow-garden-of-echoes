// Travel (Req 7, 8; design 4.3-4.4): carries the view from `from` to `to` on the session clock, in one
// move (Full, Gentle) or as a cross-fade (Reduced). A change to less motion during a travel applies to
// it at once (Req 8.6); a change to more motion applies from the next travel.
import { TUNING as MARROW_TUNING, type MotionLevel } from 'marrow/core';
import { smootherstep } from './ease';
import { motionRank } from './motion';
import { TUNING, type Tuning } from './tuning';

const ZERO = 0;
const ONE = 1;
const HALF = 0.5;

export interface TravelSegment {
  readonly from: number;
  readonly to: number;
  readonly durationMs: number;
}

export type TravelPhase = 'idle' | 'travelling' | 'arrived';
export type TravelStyle = 'travel' | 'fade';

interface PartBase {
  /** The value of p when the part starts: 0 for the first part, the current p after a level change. */
  readonly b: number;
  /** The sum of the unpaused deltas of this part, in ms. */
  readonly elapsedMs: number;
  /** R of this part, in ms: the time until the part is done. */
  readonly remainingMs: number;
}

/** A move of the view along the segment (style travel). `durationMs` is D of the part. */
export interface MovePart extends PartBase {
  readonly style: 'travel';
  readonly durationMs: number;
}

/** A cross-fade (style fade). The distance is `d0` until the cover reaches the switch, then `to`. */
export interface FadePart extends PartBase {
  readonly style: 'fade';
  readonly d0: number;
  /** True from the first step in which q >= 0.5 (the distance has switched to `to`). */
  readonly switched: boolean;
}

export type TravelPart = MovePart | FadePart;

export interface TravelState {
  readonly segment: TravelSegment;
  readonly phase: TravelPhase;
  /** The travel level: the level at the start, lowered by a change to less motion. Never raised. */
  readonly level: MotionLevel;
  /** The running part; null while idle. */
  readonly part: TravelPart | null;
  /** The last reported progress. */
  readonly p: number;
  /** The last reported distance: `from` while idle, `to` after arrival. */
  readonly distance: number;
  /** The last reported cover. */
  readonly cover: number;
}

export interface TravelInput {
  /** The session clock delta, in ms. */
  readonly dtMs: number;
  readonly paused: boolean;
  /** The current motion level, read each frame from the settings store (Req 8.5). */
  readonly motion: MotionLevel;
}

export type TravelEvent = { readonly kind: 'arrived' };

export interface TravelStep {
  readonly state: TravelState;
  readonly events: readonly TravelEvent[];
  /** The reported distance along the segment. */
  readonly travel: number;
  readonly progress: number;
  readonly cover: number;
  readonly travelling: boolean;
}

export function createTravel(segment: TravelSegment): TravelState {
  return { segment, phase: 'idle', level: 'full', part: null, p: ZERO, distance: segment.from, cover: ZERO };
}

/** A move part of a travel level, starting at progress `b`: D is the segment duration, times the Gentle multiplier at Gentle. */
function movePart(level: MotionLevel, segment: TravelSegment, b: number, tuning: Tuning): MovePart {
  const durationMs = level === 'gentle' ? segment.durationMs * tuning.gentleTravelMultiplier : segment.durationMs;
  return { style: 'travel', b, elapsedMs: ZERO, remainingMs: durationMs * (ONE - b), durationMs };
}

/** A fade part from progress `b`, holding `d0`. Its length is X = max(crossFadeMs * (1 - b), minFadeMs) (Req 8.4). */
function fadePart(b: number, d0: number, tuning: Tuning): FadePart {
  const remainingMs = Math.max(tuning.crossFadeMs * (ONE - b), tuning.minFadeMs);
  return { style: 'fade', b, elapsedMs: ZERO, remainingMs, d0, switched: false };
}

/**
 * The cover of a fade at fade position q (Req 8.4, design 4.3): a smootherstep of the triangle
 * 1 - |2q - 1|, stretched so that it is exactly 1 for |q - 0.5| <= h, where h = maxClockStepMs / minFadeMs.
 * A step of at most maxClockStepMs crosses the switch by at most h, so the switch step is on the plateau.
 */
function fadeCover(q: number, tuning: Tuning): number {
  const h = MARROW_TUNING.maxClockStepMs / tuning.minFadeMs;
  return smootherstep(Math.min(ONE, (ONE - Math.abs(q + q - ONE)) / (ONE - h - h)));
}

/**
 * Starts a travel at `level`. It does nothing unless the state is idle (Req 7.7): a repeated or late
 * start never begins a second travel. The first part has b = 0 (Req 8.6).
 */
export function startTravel(state: TravelState, level: MotionLevel, tuning: Tuning = TUNING): TravelState {
  if (state.phase !== 'idle') return state;
  const part = level === 'reduced' ? fadePart(ZERO, state.segment.from, tuning) : movePart(level, state.segment, ZERO, tuning);
  return { ...state, phase: 'travelling', level, part, p: ZERO, distance: state.segment.from, cover: ZERO };
}

/** The result of a step that leaves the travel running. */
function running(state: TravelState, level: MotionLevel, part: TravelPart, p: number, distance: number, cover: number): TravelStep {
  return {
    state: { ...state, level, part, p, distance, cover },
    events: [],
    travel: distance,
    progress: p,
    cover,
    travelling: true,
  };
}

/**
 * One step of the travel on the session clock. In idle and arrived it returns the stored values with no
 * event. While travelling it runs the five stages of design 4.3 in this order. A step without time (paused,
 * or a delta that is zero, negative or not finite) returns the stored progress, distance and cover; only
 * the level change of stage 1 can apply in it.
 */
export function stepTravel(state: TravelState, input: TravelInput, tuning: Tuning = TUNING): TravelStep {
  if (state.phase !== 'travelling' || state.part === null) {
    return { state, events: [], travel: state.distance, progress: state.p, cover: state.cover, travelling: false };
  }
  const segment = state.segment;
  let level = state.level;
  let part: TravelPart = state.part;

  // Stage 1: level change by travel level (Req 8.6). A change applies only if it goes below the travel level.
  if (motionRank(input.motion) < motionRank(level)) {
    level = input.motion;
    part = level === 'reduced' ? fadePart(state.p, state.distance, tuning) : movePart(level, segment, state.p, tuning);
  }

  // Stage 2: add time (Req 7.3, 7.6, 7.8). Only an unpaused, finite, positive delta is added. Without time,
  // the stored progress, distance and cover are returned unchanged.
  if (input.paused || !Number.isFinite(input.dtMs) || !(input.dtMs > ZERO)) {
    return { state: { ...state, level, part }, events: [], travel: state.distance, progress: state.p, cover: state.cover, travelling: true };
  }
  part = { ...part, elapsedMs: part.elapsedMs + input.dtMs };

  // Stage 3: arrival (Req 7.5). The distance and p are assigned, not computed; one event is emitted.
  if (part.elapsedMs >= part.remainingMs - tuning.arrivalToleranceMs) {
    return {
      state: { ...state, level, phase: 'arrived', part, p: ONE, distance: segment.to, cover: ZERO },
      events: [{ kind: 'arrived' }],
      travel: segment.to,
      progress: ONE,
      cover: ZERO,
      travelling: false,
    };
  }

  // Stage 4: move part (Req 7.3, 7.4). The distance is from + (to - from) * smootherstep(p), kept inside [from, to].
  if (part.style === 'travel') {
    const p = part.b + (ONE - part.b) * Math.min(ONE, part.elapsedMs / part.remainingMs);
    // Rounding can put the eased value a few ulps outside 0..1 (Req 7.11).
    const eased = Math.min(ONE, Math.max(ZERO, smootherstep(p)));
    const distance = segment.from + (segment.to - segment.from) * eased;
    return running(state, level, part, p, distance, ZERO);
  }

  // Stage 5: fade part (Req 8.4). The distance is d0 below q = 0.5 and `to` from the first step with q >= 0.5,
  // which lies on the cover plateau, so the cover is 1 there by the formula.
  const q = part.elapsedMs / part.remainingMs;
  const p = part.b + (ONE - part.b) * q;
  const cover = fadeCover(q, tuning);
  if (q < HALF) return running(state, level, part, p, part.d0, cover);
  const switched = part.switched ? part : { ...part, switched: true };
  return running(state, level, switched, p, segment.to, cover);
}
