import { describe, expect, it } from 'vitest';
import { formatTuningErrors, TUNING, validateTuning, type Tuning } from './tuning';

// Every tuning number comes from TUNING. The only numeric literals are the steering
// range edges below, tested on purpose, and small steps past an edge.

/** The steering range of every hit radius, motor radii included (Req 1.5). */
const HIT_RADIUS = { min: 0.07, max: 0.13 };
/** The steering range of the reach gain (Req 1.5). */
const REACH_GAIN = { min: 1.0, max: 1.6 };
/** The steering minimums for shared UI: 16 px text, 18 px button text, 300 ms light easing. */
const UI_MINIMUMS = [
  ['uiMinTextPx', 16],
  ['uiMinButtonTextPx', 18],
  ['uiMinLightEaseMs', 300],
] as const;
/** How far past an edge a rejected value lies; this small, it shows the check is exact. */
const EPS = 1e-9;

type NumberKey = { [K in keyof Tuning]: Tuning[K] extends number ? K : never }[keyof Tuning];

const variant = (patch: Partial<Tuning>): Tuning => ({ ...TUNING, ...patch });

/** A copy of `t` with one number changed. */
function withValue(t: Tuning, key: NumberKey, value: number): Tuning {
  const copy = { ...t };
  copy[key] = value;
  return copy;
}

const messagesOf = (t: Tuning): string[] => validateTuning(t).map((error) => error.message);

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** "<name> = <value> is out of range [<min>, <max>]", optionally with " (integers only)". */
const outOfRange = (name: string, value: number): RegExp =>
  new RegExp(`^${escapeRegExp(`${name} = ${value} is out of range [`)}[^\\]]+\\]( \\(integers only\\))?$`);

/** Every hit radius, motor radii included, at one value, so the relations between them hold. */
const hitRadiiAt = (value: number): Tuning =>
  variant({
    hitRadius: value,
    hitRadiusMin: value,
    hitRadiusMax: value,
    motorRadii: TUNING.motorRadii.map(() => value),
  });

/** Both reach gains at one value, so reachGainMin <= reachGainMax holds. */
const reachGainsAt = (value: number): Tuning => variant({ reachGainMin: value, reachGainMax: value });

describe('TUNING', () => {
  it('is frozen, and motorRadii is frozen on its own', () => {
    expect(Object.isFrozen(TUNING)).toBe(true);
    expect(Object.isFrozen(TUNING.motorRadii)).toBe(true);
  });
});

describe('validateTuning: steering ranges and minimums', () => {
  const hitRange = `[${HIT_RADIUS.min}, ${HIT_RADIUS.max}]`;
  const gainRange = `[${REACH_GAIN.min}, ${REACH_GAIN.max}]`;
  const below = (edge: number): number => edge - EPS;
  const above = (edge: number): number => edge + EPS;

  for (const edge of [HIT_RADIUS.min, HIT_RADIUS.max]) {
    it(`accepts every hit radius at the edge ${edge}`, () => {
      expect(validateTuning(hitRadiiAt(edge))).toEqual([]);
    });
  }

  for (const key of ['hitRadius', 'hitRadiusMin', 'hitRadiusMax'] as const) {
    it(`rejects ${key} just outside ${hitRange}`, () => {
      const low = below(HIT_RADIUS.min);
      const high = above(HIT_RADIUS.max);
      expect(messagesOf(withValue(hitRadiiAt(HIT_RADIUS.min), key, low))).toEqual([
        `${key} = ${low} is out of range ${hitRange}`,
      ]);
      expect(messagesOf(withValue(hitRadiiAt(HIT_RADIUS.max), key, high))).toEqual([
        `${key} = ${high} is out of range ${hitRange}`,
      ]);
    });
  }

  it(`rejects each motorRadii entry just outside ${hitRange}`, () => {
    TUNING.motorRadii.forEach((_, i) => {
      const withEntry = (edge: number, value: number): Tuning => ({
        ...hitRadiiAt(edge),
        motorRadii: TUNING.motorRadii.map((__, j) => (j === i ? value : edge)),
      });
      const low = below(HIT_RADIUS.min);
      const high = above(HIT_RADIUS.max);
      expect(messagesOf(withEntry(HIT_RADIUS.min, low))).toEqual([
        `motorRadii[${i}] = ${low} is out of range ${hitRange}`,
      ]);
      expect(messagesOf(withEntry(HIT_RADIUS.max, high))).toEqual([
        `motorRadii[${i}] = ${high} is out of range ${hitRange}`,
      ]);
    });
  });

  for (const edge of [REACH_GAIN.min, REACH_GAIN.max]) {
    it(`accepts both reach gains at the edge ${edge}`, () => {
      expect(validateTuning(reachGainsAt(edge))).toEqual([]);
    });
  }

  for (const key of ['reachGainMin', 'reachGainMax'] as const) {
    it(`rejects ${key} just outside ${gainRange}`, () => {
      const low = below(REACH_GAIN.min);
      const high = above(REACH_GAIN.max);
      expect(messagesOf(withValue(reachGainsAt(REACH_GAIN.min), key, low))).toEqual([
        `${key} = ${low} is out of range ${gainRange}`,
      ]);
      expect(messagesOf(withValue(reachGainsAt(REACH_GAIN.max), key, high))).toEqual([
        `${key} = ${high} is out of range ${gainRange}`,
      ]);
    });
  }

  for (const [key, minimum] of UI_MINIMUMS) {
    it(`accepts ${key} at its steering minimum ${minimum} and rejects it just below`, () => {
      expect(validateTuning(withValue(TUNING, key, minimum))).toEqual([]);
      const low = below(minimum);
      const messages = messagesOf(withValue(TUNING, key, low));
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatch(outOfRange(key, low));
      expect(messages[0]).toContain(`is out of range [${minimum}, `);
    });
  }
});

describe('validateTuning: every key has a declared range', () => {
  const NEVER_VALID = [NaN, Infinity, -Infinity, Number.MAX_VALUE, -Number.MAX_VALUE];
  const numberKeys = (Object.keys(TUNING) as (keyof Tuning)[]).filter(
    (key): key is NumberKey => typeof TUNING[key] === 'number',
  );

  it('reports NaN as out of range, naming the key, the value and the range', () => {
    expect(validateTuning(variant({ hitRadius: NaN }))).toEqual([
      {
        key: 'hitRadius',
        value: NaN,
        message: `hitRadius = NaN is out of range [${HIT_RADIUS.min}, ${HIT_RADIUS.max}]`,
      },
    ]);
  });

  for (const key of numberKeys) {
    it(`reports ${key} once when it is NaN, infinite or beyond every limit`, () => {
      for (const value of NEVER_VALID) {
        const errors = validateTuning(withValue(TUNING, key, value));
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({ key, value });
        expect(errors[0]?.message).toMatch(outOfRange(key, value));
      }
    });
  }

  it('reports each motorRadii entry once when it is NaN, infinite or beyond every limit', () => {
    TUNING.motorRadii.forEach((_, i) => {
      for (const value of NEVER_VALID) {
        const radii = TUNING.motorRadii.map((radius, j) => (j === i ? value : radius));
        const errors = validateTuning(variant({ motorRadii: radii }));
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({ key: 'motorRadii', value });
        expect(errors[0]?.message).toMatch(outOfRange(`motorRadii[${i}]`, value));
      }
    });
  });
});

describe('validateTuning: integer keys', () => {
  const INTEGER_KEYS = [
    'gridCols',
    'gridRows',
    'cellValidSamples',
    'difficultiesBeforeHelp',
    'helpMaxLevel',
    'cameraWidth',
    'cameraHeight',
  ] as const;

  for (const key of INTEGER_KEYS) {
    it(`rejects a fractional ${key}`, () => {
      const value = TUNING[key] + 0.5;
      const messages = messagesOf(withValue(TUNING, key, value));
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatch(
        new RegExp(`^${escapeRegExp(`${key} = ${value} is out of range [`)}\\d+, \\d+\\] \\(integers only\\)$`),
      );
    });
  }
});

describe('validateTuning: relations between keys (design section 4)', () => {
  it('calibEarliestMs <= calibNominalMs <= calibCapMs', () => {
    const { calibNominalMs: nominal, calibCapMs: cap } = TUNING;
    expect(messagesOf(variant({ calibEarliestMs: nominal + 1 }))).toEqual([
      `calibEarliestMs = ${nominal + 1} must be at most calibNominalMs = ${nominal}`,
    ]);
    expect(messagesOf(variant({ calibNominalMs: cap + 1 }))).toEqual([
      `calibNominalMs = ${cap + 1} must be at most calibCapMs = ${cap}`,
    ]);
    expect(validateTuning(variant({ calibEarliestMs: nominal }))).toEqual([]);
    expect(validateTuning(variant({ calibNominalMs: cap }))).toEqual([]);
  });

  it('reachGainMin <= reachGainMax', () => {
    expect(messagesOf(variant({ reachGainMin: REACH_GAIN.max, reachGainMax: REACH_GAIN.min }))).toEqual([
      `reachGainMin = ${REACH_GAIN.max} must be at most reachGainMax = ${REACH_GAIN.min}`,
    ]);
    expect(validateTuning(variant({ reachGainMin: TUNING.reachGainMax }))).toEqual([]);
  });

  it('hitRadiusMin <= hitRadius <= hitRadiusMax', () => {
    const { min, max } = HIT_RADIUS;
    expect(messagesOf({ ...hitRadiiAt(min), hitRadiusMin: max })).toContain(
      `hitRadiusMin = ${max} must be at most hitRadius = ${min}`,
    );
    expect(messagesOf({ ...hitRadiiAt(max), hitRadiusMax: min })).toContain(
      `hitRadius = ${max} must be at most hitRadiusMax = ${min}`,
    );
  });

  it('every motorRadii entry lies within [hitRadiusMin, hitRadiusMax]', () => {
    const { min, max } = HIT_RADIUS;
    const last = TUNING.motorRadii.length - 1;
    const lastEntryAt = (others: number, value: number): Tuning => ({
      ...hitRadiiAt(others),
      motorRadii: TUNING.motorRadii.map((_, i) => (i === last ? value : others)),
    });
    expect(messagesOf(lastEntryAt(min, max))).toEqual([
      `motorRadii[${last}] = ${max} must be within [hitRadiusMin, hitRadiusMax] = [${min}, ${min}]`,
    ]);
    expect(messagesOf(lastEntryAt(max, min))).toEqual([
      `motorRadii[${last}] = ${min} must be within [hitRadiusMin, hitRadiusMax] = [${max}, ${max}]`,
    ]);
  });

  it('motorRadii has helpMaxLevel + 1 entries', () => {
    const needed = TUNING.helpMaxLevel + 1;
    expect(messagesOf(variant({ motorRadii: TUNING.motorRadii.slice(0, -1) }))).toEqual([
      `motorRadii has ${needed - 1} entries; it needs helpMaxLevel + 1 = ${needed}`,
    ]);
    expect(messagesOf(variant({ motorRadii: [...TUNING.motorRadii, TUNING.hitRadius] }))).toEqual([
      `motorRadii has ${needed + 1} entries; it needs helpMaxLevel + 1 = ${needed}`,
    ]);
    expect(messagesOf(variant({ helpMaxLevel: TUNING.helpMaxLevel + 1 }))).toEqual([
      `motorRadii has ${needed} entries; it needs helpMaxLevel + 1 = ${needed + 1}`,
    ]);
  });

  it('motorRadii[0] equals hitRadius', () => {
    const { min, max } = HIT_RADIUS;
    const firstAtMax: Tuning = {
      ...hitRadiiAt(min),
      hitRadiusMax: max,
      motorRadii: TUNING.motorRadii.map((_, i) => (i === 0 ? max : min)),
    };
    expect(messagesOf(firstAtMax)).toEqual([`motorRadii[0] = ${max} must equal hitRadius = ${min}`]);
  });

  it('headDeadZone < headClamp, so equal values are rejected', () => {
    const clamp = TUNING.headClamp;
    expect(messagesOf(variant({ headDeadZone: clamp }))).toEqual([
      `headDeadZone = ${clamp} must be less than headClamp = ${clamp}`,
    ]);
  });

  it('trackingHoldAfterMs <= trackingOverlayAfterMs', () => {
    const overlay = TUNING.trackingOverlayAfterMs;
    expect(messagesOf(variant({ trackingHoldAfterMs: overlay + 1 }))).toEqual([
      `trackingHoldAfterMs = ${overlay + 1} must be at most trackingOverlayAfterMs = ${overlay}`,
    ]);
    expect(validateTuning(variant({ trackingHoldAfterMs: overlay }))).toEqual([]);
  });
});

describe('formatTuningErrors', () => {
  it('writes the design example as one line under a heading', () => {
    expect(formatTuningErrors(validateTuning(variant({ reachGainMax: 1.8 })))).toBe(
      'Tuning is invalid:\n- reachGainMax = 1.8 is out of range [1, 1.6]',
    );
  });

  it('writes every problem on its own line, in order', () => {
    const errors = validateTuning(
      variant({ hitRadius: NaN, dwellMs: NaN, calibEarliestMs: TUNING.calibNominalMs + 1 }),
    );
    expect(errors).toHaveLength(3);
    expect(formatTuningErrors(errors).split('\n')).toEqual([
      'Tuning is invalid:',
      ...errors.map((error) => `- ${error.message}`),
    ]);
  });

  it('returns an empty string when there is no problem', () => {
    expect(formatTuningErrors([])).toBe('');
  });
});
