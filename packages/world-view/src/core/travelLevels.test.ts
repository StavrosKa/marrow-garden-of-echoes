import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { motionRank } from './motion';
import { createTravel, startTravel, stepTravel, type TravelPart, type TravelState, type TravelStep } from './travel';
import { COVER_SLOPE_MAX, DISTANCE_FLOOR, genLevelRun, genSegment } from './testgen';
import { TUNING } from './tuning';

// The 10000-step cases use fewer runs and a 60 s limit, as marrow's slow tests do.
const LONG_RUNS = 50;
const LONG_TIMEOUT_MS = 60000;
const ZERO = 0;
const ONE = 1;
/** The seed of the bug in docs/bugs-found.md: a paused step after a switch moved the cover (Req 8.12). */
const BUG_SEED = 774323422;

/** What a step reports, for the "more motion changes nothing" comparison (Req 8.6.3, 8.13). */
function reported(step: TravelStep): object {
  const part = step.state.part;
  return {
    travel: step.travel,
    progress: step.progress,
    cover: step.cover,
    style: part?.style,
    durationMs: part?.style === 'travel' ? part.durationMs : undefined,
    remainingMs: part?.remainingMs,
  };
}

function styleOf(part: TravelPart | null): string | undefined {
  return part?.style;
}

/** The level-run property of Req 8.11-8.13, for one segment and one run of steps. */
function levelRunHolds(segment: { from: number; to: number; durationMs: number }, inputs: Parameters<typeof stepTravel>[1][]): void {
  const gentleDuration = segment.durationMs * TUNING.gentleTravelMultiplier;
  let state: TravelState = startTravel(createTravel(segment), inputs[ZERO]!.motion);
  let arrivals = ZERO;
  let styleChanges = ZERO;
  let durationChanges = ZERO;
  for (const input of inputs) {
    const before = state;
    const step = stepTravel(before, input);
    const after = step.state;

    // Req 8.6.3, 8.13: a change to more motion changes none of the travel's values in its step.
    if (before.phase === 'travelling' && motionRank(input.motion) > motionRank(before.level)) {
      expect(reported(step)).toEqual(reported(stepTravel(before, { ...input, motion: before.level })));
    }

    // Req 8.11: the distance stays in [from, to] and never decreases; progress never decreases.
    expect(step.travel).toBeGreaterThanOrEqual(before.distance);
    expect(step.travel).toBeGreaterThanOrEqual(segment.from);
    expect(step.travel).toBeLessThanOrEqual(segment.to);
    expect(step.progress).toBeGreaterThanOrEqual(before.p);

    // Req 8.11: at most one arrived event; none in a paused step.
    for (const event of step.events) {
      expect(event.kind).toBe('arrived');
      expect(input.paused).toBe(false);
      arrivals += ONE;
    }
    expect(arrivals).toBeLessThanOrEqual(ONE);
    if (after.phase === 'arrived') {
      expect(step.travel).toBe(segment.to);
      expect(after.distance).toBe(segment.to);
      expect(after.p).toBe(ONE);
    }

    // Req 8.13: the travel level never rises during a travel.
    if (before.phase === 'travelling') expect(motionRank(after.level)).toBeLessThanOrEqual(motionRank(before.level));

    // Req 8.13: the style changes at most once, and only from travel to fade.
    if (styleOf(before.part) !== styleOf(after.part) && after.part !== null && before.part !== null) {
      expect(styleOf(before.part)).toBe('travel');
      expect(styleOf(after.part)).toBe('fade');
      styleChanges += ONE;
    }
    expect(styleChanges).toBeLessThanOrEqual(ONE);

    // Req 8.13: D changes at most once, and only from the Full duration to the Gentle duration.
    if (after.part?.style === 'travel' && before.part?.style === 'travel' && after.part.durationMs !== before.part.durationMs) {
      expect(after.part.durationMs).toBe(gentleDuration);
      durationChanges += ONE;
    }
    expect(durationChanges).toBeLessThanOrEqual(ONE);

    // Req 8.12: the cover is 0 in the travel style, and its change per step is bounded by the slope.
    if (after.part?.style === 'travel') expect(step.cover).toBe(ZERO);
    const dtMs = input.paused ? ZERO : input.dtMs;
    expect(Math.abs(step.cover - before.cover)).toBeLessThanOrEqual((COVER_SLOPE_MAX * dtMs) / TUNING.minFadeMs + DISTANCE_FLOOR);

    // Req 8.12: a fade lasts at least minFadeMs of unpaused time.
    if (after.part?.style === 'fade') expect(after.part.remainingMs).toBeGreaterThanOrEqual(TUNING.minFadeMs);

    // Req 8.11: once the unpaused time since the last applied change reaches R + tolerance, exactly one arrival has occurred.
    if (after.part !== null && after.part.elapsedMs >= after.part.remainingMs + TUNING.arrivalToleranceMs) {
      expect(arrivals).toBe(ONE);
    }
    state = after;
  }
}

describe('travel across motion level changes', () => {
  it('travel across motion level changes', () => {
    fc.assert(
      fc.property(genSegment(), genLevelRun(), (segment, inputs) => {
        levelRunHolds(segment, inputs);
      }),
      { numRuns: LONG_RUNS },
    );
  }, LONG_TIMEOUT_MS);

  it('travel across motion level changes: regression seed 774323422 (docs/bugs-found.md)', () => {
    fc.assert(
      fc.property(genSegment(), genLevelRun(), (segment, inputs) => {
        levelRunHolds(segment, inputs);
      }),
      { numRuns: LONG_RUNS, seed: BUG_SEED },
    );
  }, LONG_TIMEOUT_MS);
});
