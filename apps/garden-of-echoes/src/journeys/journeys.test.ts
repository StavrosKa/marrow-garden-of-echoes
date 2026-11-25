// Journeys and doors (requirements 2.1 to 2.7). The durations come from world-view's TUNING, so the test reads the
// same numbers as the travel engine. The depth checks use the forest layer table of scene/forestLayers.ts.
import { TUNING, type MotionLevel } from 'marrow/core';
import { createSession, stepSession } from '../session/machine';
import {
  checkDepthScaling,
  createTravel,
  resolveLayerTable,
  startTravel,
  validateLayerTable,
  TUNING as WORLD_TUNING,
  type SegmentSpec,
  type TravelPart,
  type TravelState,
} from 'world-view';
import { describe, expect, it } from 'vitest';
import { FOREST_LAYERS } from '../scene/forestLayers';
import { journeyTravel, loadSegments, validateSegments } from './journeys';
import shipped from './segments.json';

/** A part that moves the view: the travel style of world-view (the fade style is the other part). */
type MovePart = Extract<TravelPart, { readonly style: 'travel' }>;

const segments = loadSegments(shipped);

/** The travel of one journey or door, started at a motion level. */
function started(journey: keyof typeof segments, level: MotionLevel): TravelState {
  return startTravel(journeyTravel(segments, journey), level, WORLD_TUNING);
}

/** The part of a started travel, whatever its style. A travel that has not started has no part, and that fails the test. */
function partAny(state: TravelState): TravelPart {
  if (state.part === null) throw new Error('the travel has no part');
  return state.part;
}

/** The part of a started travel that moves the view (style travel). A cross-fade or no part fails the test. */
function partOf(state: TravelState): MovePart {
  if (state.part === null || state.part.style !== 'travel') throw new Error('the travel is not a move');
  return state.part;
}

/** The segment table as the validator reads it, so a test can break one field and keep the rest. */
function brokenSegments(change: (list: Record<string, unknown>[]) => void): unknown {
  const copy = structuredClone(shipped) as { segments: Record<string, unknown>[] };
  change(copy.segments);
  return copy;
}

describe('journeys and doors', () => {
  it('2.1: a journey is the world-view travel of its segment, with no travel rule of its own', () => {
    expect(journeyTravel(segments, 'journeyA')).toEqual(createTravel(segments.journeyA));
    expect(journeyTravel(segments, 'doorHall')).toEqual(createTravel(segments.doorHall));
  });

  it('2.2: a Full journey lasts between the journey limits, and its part is the segment duration', () => {
    const part = partOf(started('journeyA', 'full'));
    expect(part.style).toBe('travel');
    expect(part.durationMs).toBe(segments.journeyA.durationMs);
    expect(part.durationMs).toBeGreaterThanOrEqual(WORLD_TUNING.journeyMinMs);
    expect(part.durationMs).toBeLessThanOrEqual(WORLD_TUNING.journeyMaxMs);
  });

  it('2.3: a Gentle journey lasts the Full duration times the Gentle travel multiplier', () => {
    const full = partOf(started('journeyA', 'full')).durationMs;
    const gentle = partOf(started('journeyA', 'gentle')).durationMs;
    expect(gentle).toBeCloseTo(full * WORLD_TUNING.gentleTravelMultiplier, 9);
  });

  it('2.4: a Reduced journey is a cross-fade of crossFadeMs, with no travel scaling', () => {
    const part = partAny(started('journeyA', 'reduced'));
    expect(part.style).toBe('fade');
    expect(part.remainingMs).toBe(WORLD_TUNING.crossFadeMs);
  });

  it('2.6: each door lasts doorMs at Full, is scaled at Gentle, and is a cross-fade at Reduced', () => {
    expect(segments.doorHall.durationMs).toBe(WORLD_TUNING.doorMs);
    expect(partOf(started('doorHall', 'full')).durationMs).toBe(WORLD_TUNING.doorMs);
    expect(partOf(started('doorHall', 'gentle')).durationMs).toBeCloseTo(WORLD_TUNING.doorMs * WORLD_TUNING.gentleTravelMultiplier, 9);
    expect(partAny(started('doorGarden', 'reduced')).remainingMs).toBe(WORLD_TUNING.crossFadeMs);
  });

  it('2.5 2.6: the segments chain, journey B ends where the hall door starts, and the door ends where the garden door starts', () => {
    expect(segments.journeyA.to).toBe(segments.journeyB.from);
    expect(segments.journeyB.to).toBe(segments.doorHall.from);
    expect(segments.doorHall.to).toBe(segments.doorGarden.from);
    expect(validateSegments(shipped).ok).toBe(true);
  });

  it('2.2: the validator rejects a journey whose duration is outside the journey limits', () => {
    const json = brokenSegments((list) => {
      (list[0] as Record<string, unknown>).durationMs = WORLD_TUNING.journeyMaxMs * 2;
    });
    const result = validateSegments(json);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.path)).toContain('segments[0].durationMs');
  });

  it('2.6: the validator rejects a door whose duration is not doorMs', () => {
    const json = brokenSegments((list) => {
      (list[2] as Record<string, unknown>).durationMs = WORLD_TUNING.journeyMinMs;
    });
    const result = validateSegments(json);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.path)).toContain('segments[2].durationMs');
  });

  it('2.5: the validator rejects a segment that does not start where the one before it ends', () => {
    const json = brokenSegments((list) => {
      (list[1] as Record<string, unknown>).from = 9;
    });
    const result = validateSegments(json);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.path)).toContain('journeyB.from');
  });

  it('2.1 2.2 2.6: loadSegments throws once, with every issue joined', () => {
    const json = brokenSegments((list) => {
      (list[0] as Record<string, unknown>).durationMs = WORLD_TUNING.journeyMaxMs * 2;
      (list[2] as Record<string, unknown>).durationMs = WORLD_TUNING.journeyMinMs;
    });
    expect(() => loadSegments(json)).toThrow(/segments\[0\]\.durationMs[\s\S]*segments\[2\]\.durationMs/);
  });

  it('2.1 2.6: the forest layer table is valid, and it passes the depth scaling rules for every segment', () => {
    expect(validateLayerTable(FOREST_LAYERS)).toEqual([]);
    const layers = resolveLayerTable(FOREST_LAYERS, WORLD_TUNING);
    for (const journey of ['journeyA', 'journeyB', 'doorHall', 'doorGarden'] as const) {
      const segment = segments[journey];
      const spec: SegmentSpec = { id: journey, kind: journey.startsWith('door') ? 'door' : 'journey', ...segment };
      expect(checkDepthScaling(layers, spec, WORLD_TUNING)).toEqual([]);
    }
  });
});

describe('the route after Whisper Glade (requirement 8.4)', () => {
  it('8.4: the route goes through journey B and the hall door to the placeholder Whisper Hall', () => {
    const input = { dtMs: TUNING.maxClockStepMs, motion: 'full' as const, suspension: { paused: false, holdActive: false } };
    let state = createSession(segments);
    state = stepSession(state, { kind: 'startAt', stage: 'whisper-glade' }, input).state;
    state = stepSession(state, { kind: 'stageCompleted', stage: 'whisper-glade' }, input).state;
    const travels: string[] = [];
    const activated: string[] = [];
    for (let i = 0; i < 100000 && !activated.includes('whisper-hall'); i++) {
      const step = stepSession(state, null, input);
      state = step.state;
      for (const effect of step.effects) {
        if (effect.kind === 'travelStarted') travels.push(effect.journey);
        if (effect.kind === 'stageActivated') activated.push(effect.stage);
      }
    }
    expect(travels).toEqual(['journeyB', 'doorHall']);
    expect(activated).toEqual(['whisper-hall']);
    expect(state.phase).toBe('PLAYING');
    expect(state.stage).toBe('whisper-hall');
  });
});

describe('journeys and doors: the table is the one the design gives', () => {
  it('2.5: journey B runs from 8 to 16, as design 4.1 gives it', () => {
    expect({ from: segments.journeyB.from, to: segments.journeyB.to }).toEqual({ from: 8, to: 16 });
  });

  it('2.6: the door into the hall is 16 to 17 and the door out is 17 to 18', () => {
    expect(segments.doorHall).toEqual({ from: 16, to: 17, durationMs: WORLD_TUNING.doorMs });
    expect(segments.doorGarden).toEqual({ from: 17, to: 18, durationMs: WORLD_TUNING.doorMs });
  });
});
