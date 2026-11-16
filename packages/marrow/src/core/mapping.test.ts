import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Vec2 } from './frame';
import { dist } from './geometry';
import { makeMapping, type MappingParams } from './mapping';
import { genMappingParams, genVec2Camera, genVec2Screen } from './testgen';

// TOLERANCE is the 1e-9 of Req 10.3, a test parameter (requirements Appendix B), and
// IDENTITY_GAIN is the scale 1. The other numbers are the edges of camera space (0
// and 1) and of the play area (0, A and 1), and the mirror 1 - x of Req 6.3.

/** The largest distance a round trip may move a point (Req 10.3). */
const TOLERANCE = 1e-9;
/**
 * The identity scale: no reach gain, as in simulated-input mode (Req 6.6, 10.5). Not
 * read from reachGainMin, which is a tuning value (tasks.md task 6.2).
 */
const IDENTITY_GAIN = 1;

/** Mapping parameters with a screen point for their play aspect. */
function genParamsAndScreen(): fc.Arbitrary<[MappingParams, Vec2]> {
  return genMappingParams().chain((params) =>
    fc.tuple(fc.constant(params), genVec2Screen(params.playAspect)),
  );
}

/** Two camera points p and q from genVec2Camera, with the same y and p.x <= q.x. */
function genSameYPair(): fc.Arbitrary<{ p: Vec2; q: Vec2 }> {
  return fc
    .tuple(genVec2Camera(), genVec2Camera())
    .map(([first, second]) => ({
      p: { x: Math.min(first.x, second.x), y: first.y },
      q: { x: Math.max(first.x, second.x), y: first.y },
    }));
}

/** The four corners of the play area for the play aspect A. */
function corners(A: number): Vec2[] {
  return [
    { x: 0, y: 0 },
    { x: A, y: 0 },
    { x: 0, y: 1 },
    { x: A, y: 1 },
  ];
}

/**
 * At gain 1, the camera image covers the play area: every corner of the play area
 * maps into the frame [0, 1]² within TOLERANCE, and on at least one axis the corners
 * reach both edges of the frame, so the image is no larger than it needs to be.
 */
function expectCoversPlayArea(params: MappingParams): void {
  const { toCamera } = makeMapping({ ...params, gain: IDENTITY_GAIN });
  const cams = corners(params.playAspect).map(toCamera);
  for (const value of cams.flatMap((p) => [p.x, p.y])) {
    expect(value).toBeGreaterThanOrEqual(-TOLERANCE);
    expect(value).toBeLessThanOrEqual(1 + TOLERANCE);
  }
  const touchesBothEdges = (axis: 'x' | 'y'): boolean => {
    const values = cams.map((p) => p[axis]);
    return Math.abs(Math.min(...values)) <= TOLERANCE && Math.abs(Math.max(...values) - 1) <= TOLERANCE;
  };
  expect(touchesBothEdges('x') || touchesBothEdges('y')).toBe(true);
}

// The properties below skip unwanted samples with fc.pre, never with .filter. A
// fast-check filter retries without limit, so a generator that could no longer give a
// wanted sample would hang the run. With fc.pre, fast-check fails the property once
// it has skipped more than 10,000 samples (100 per run, for the default 100 runs).
describe('makeMapping', () => {
  it('at gain 1 the camera image covers the play area, for A >= a', () => {
    fc.assert(
      fc.property(genMappingParams(), (params) => {
        fc.pre(params.playAspect >= params.frameAspect);
        expectCoversPlayArea(params);
      }),
    );
  });

  it('at gain 1 the camera image covers the play area, for A < a', () => {
    fc.assert(
      fc.property(genMappingParams(), (params) => {
        fc.pre(params.playAspect < params.frameAspect);
        expectCoversPlayArea(params);
      }),
    );
  });

  // The task line says "exactly", but rounding alone breaks exact equality for some
  // points, so this uses the 1e-9 of task 15.2, which tests the same construction.
  it('with a = A and gain 1, the wrist x = 1 - s.x / A, y = s.y maps to s within 1e-9 (Req 6.3)', () => {
    fc.assert(
      fc.property(genParamsAndScreen(), ([params, s]) => {
        const A = params.playAspect;
        const { toScreen } = makeMapping({ ...params, frameAspect: A, gain: IDENTITY_GAIN });
        const wrist = { x: 1 - s.x / A, y: s.y };
        expect(dist(toScreen(wrist), s)).toBeLessThanOrEqual(TOLERANCE);
      }),
    );
  });
});

// Req 10.2: for all mappings and camera points p, q with the same y and p.x < q.x,
// map(p).x > map(q).x. That cannot hold for every pair of doubles: 1 - 0 and
// 1 - Number.MIN_VALUE are the same number. On unrestricted pairs this test failed on
// exactly that pair (seed 52216672), so it skips pairs closer than TOLERANCE.
it('mapping_mirrors_once', () => {
  fc.assert(
    fc.property(genMappingParams(), genSameYPair(), (params, { p, q }) => {
      fc.pre(q.x - p.x >= TOLERANCE);
      const { toScreen } = makeMapping(params);
      expect(toScreen(p).x).toBeGreaterThan(toScreen(q).x);
    }),
  );
});

// Req 10.3: for all play aspects and frame aspects in ASPECT_MIN..ASPECT_MAX, gains in
// reachGainMin..reachGainMax, centres inside the play area, camera points p and
// screen points s, |toCamera(toScreen(p)) - p| <= 1e-9 and |toScreen(toCamera(s)) - s| <= 1e-9.
it('mapping_roundtrip', () => {
  fc.assert(
    fc.property(genMappingParams(), genVec2Camera(), (params, p) => {
      const { toScreen, toCamera } = makeMapping(params);
      expect(dist(toCamera(toScreen(p)), p)).toBeLessThanOrEqual(TOLERANCE);
    }),
  );
  fc.assert(
    fc.property(genParamsAndScreen(), ([params, s]) => {
      const { toScreen, toCamera } = makeMapping(params);
      expect(dist(toScreen(toCamera(s)), s)).toBeLessThanOrEqual(TOLERANCE);
    }),
  );
});

// Req 10.1: the mapping is the base mapping followed by the reach gain of the
// glossary, s' = c + g * (s - c). For all mappings and camera points p, toScreen(p) - c
// equals g * (toScreen at gain 1 of p - c) on both axes, within 1e-9. This pins the
// reach gain, and above all its centre c. mapping_roundtrip cannot see a wrong centre
// when both directions change together, because toCamera then stays the exact inverse.
it('mapping_gain_about_centre', () => {
  fc.assert(
    fc.property(genMappingParams(), genVec2Camera(), (params, p) => {
      const { gain: g, centre: c } = params;
      const screen = makeMapping(params).toScreen(p);
      const base = makeMapping({ ...params, gain: IDENTITY_GAIN }).toScreen(p);
      expect(Math.abs(screen.x - c.x - g * (base.x - c.x))).toBeLessThanOrEqual(TOLERANCE);
      expect(Math.abs(screen.y - c.y - g * (base.y - c.y))).toBeLessThanOrEqual(TOLERANCE);
    }),
  );
});
