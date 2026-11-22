import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import * as core from './index';
import {
  DEFAULT_SETTINGS,
  parseSettings,
  serializeSettings,
  SETTINGS_VERSION,
  type MotionLevel,
  type Settings,
} from './settings';
import { genSettingsString, genSpread } from './testgen';
import { TUNING } from './tuning';

// Requirement 20.1 - 20.4, 20.6, 20.7. Every default volume comes from TUNING. The numbers in
// these tests are the edges of the volume range of Req 20.1 (0 and 1) and values just outside it.

/** Runs of the property, and the time its strings, some of them very long, may take. Test parameters. */
const RUNS = 300;
const SLOW_TEST_MS = 60_000;
vi.setConfig({ testTimeout: SLOW_TEST_MS });

const CALM = { prefersReducedMotion: false };
const REDUCED = { prefersReducedMotion: true };
const ENVS = [CALM, REDUCED] as const;
const MOTIONS: readonly MotionLevel[] = ['full', 'gentle', 'reduced'];

/** The default settings for a browser that does or does not prefer reduced motion (Req 20.6). */
const defaultsFor = (env: { prefersReducedMotion: boolean }): Settings => ({
  motion: env.prefersReducedMotion ? 'reduced' : 'full',
  mute: false,
  volume: TUNING.defaultVolume,
  hands: null,
});

/** Stored settings that differ from every default, whatever the browser prefers. */
const STORED: Settings = {
  motion: 'gentle',
  mute: true,
  volume: TUNING.defaultVolume / 2,
  hands: 'left',
};

/** The text of a stored document: the right version and the given fields. */
const doc = (fields: object, version: unknown = SETTINGS_VERSION): string =>
  JSON.stringify({ version, ...fields });

/** The text of STORED with one field replaced by a value (as JSON text, so that 1e999 and the like can be written). */
function withField(field: keyof Settings, jsonText: string): string {
  const parts = (Object.keys(STORED) as (keyof Settings)[]).map(
    (k) => `"${k}":${k === field ? jsonText : JSON.stringify(STORED[k])}`,
  );
  return `{"version":${SETTINGS_VERSION},${parts.join(',')}}`;
}

/** What a result may look like: four own keys, a plain object, values of the right kind (Req 20.1, 20.4). */
function problemsWith(s: Settings): string[] {
  const problems: string[] = [];
  if (Object.getPrototypeOf(s) !== Object.prototype) problems.push('the prototype is not Object.prototype');
  if (JSON.stringify(Object.keys(s).sort()) !== JSON.stringify([...Object.keys(STORED)].sort())) {
    problems.push(`keys ${JSON.stringify(Object.keys(s))}`);
  }
  if (!MOTIONS.includes(s.motion)) problems.push(`motion ${String(s.motion)}`);
  if (typeof s.mute !== 'boolean') problems.push(`mute ${String(s.mute)}`);
  if (typeof s.volume !== 'number' || !Number.isFinite(s.volume) || s.volume < 0 || s.volume > 1) {
    problems.push(`volume ${String(s.volume)}`);
  }
  if (s.hands !== null && s.hands !== 'right' && s.hands !== 'left' && s.hands !== 'both') {
    problems.push(`hands ${String(s.hands)}`);
  }
  return problems;
}

/** Nothing the parser did may leave a trace on every object. */
function prototypeIsClean(): boolean {
  const probe: Record<string, unknown> = {};
  return (
    Object.keys(Object.prototype).length === 0 &&
    ['motion', 'mute', 'volume', 'hands', 'version'].every((k) => probe[k] === undefined)
  );
}

/**
 * A second reading of Req 20.3, 20.6 and 20.7, written for the test and from the requirement: it uses
 * property descriptors and a table of choices, not the code of the parser.
 */
function oracle(raw: string, env: { prefersReducedMotion: boolean }): Settings {
  const fallback = defaultsFor(env);
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return fallback;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fallback;
  const own = (key: string): unknown => Reflect.getOwnPropertyDescriptor(value, key)?.value;
  if (own('version') !== SETTINGS_VERSION) return fallback;
  const motion = own('motion');
  const volume = own('volume');
  const hands = own('hands');
  return {
    motion: motion === 'full' || motion === 'gentle' || motion === 'reduced' ? motion : fallback.motion,
    mute: own('mute') === true,
    volume: typeof volume === 'number' && volume >= 0 && volume <= 1 ? volume + 0 : fallback.volume,
    hands: hands === 'right' || hands === 'left' || hands === 'both' ? hands : null,
  };
}

describe('the defaults (Req 20.6)', () => {
  it('are motion full, mute off, the tuning volume and hands not chosen, and cannot be changed', () => {
    expect(DEFAULT_SETTINGS).toEqual({ motion: 'full', mute: false, volume: TUNING.defaultVolume, hands: null });
    expect(Object.isFrozen(DEFAULT_SETTINGS)).toBe(true);
  });

  it.each([null, '', ' ', 'not json', '{', 'null', '{}', '[]', '7', '"text"', 'true'])(
    'give every field its default for %j, with and without the browser preference',
    (raw) => {
      for (const env of ENVS) expect(parseSettings(raw, env)).toEqual(defaultsFor(env));
    },
  );

  it('give every field its default when only the version is stored', () => {
    for (const env of ENVS) expect(parseSettings(doc({}), env)).toEqual(defaultsFor(env));
  });

  it('return a new object every time, never the shared default', () => {
    const a = parseSettings(null, CALM);
    expect(a).not.toBe(DEFAULT_SETTINGS);
    a.volume = 0;
    expect(parseSettings(null, CALM).volume).toBe(TUNING.defaultVolume);
  });
});

describe('the motion choice (Req 20.6, 20.7)', () => {
  it('uses the browser preference when nothing is stored: reduced if it prefers reduced motion, otherwise full', () => {
    expect(parseSettings(null, REDUCED).motion).toBe('reduced');
    expect(parseSettings(null, CALM).motion).toBe('full');
    expect(parseSettings(doc({ mute: true }), REDUCED).motion).toBe('reduced');
    expect(parseSettings(doc({ mute: true }), CALM).motion).toBe('full');
  });

  it('uses a stored choice in all four combinations of stored value and preference', () => {
    // Stored full against a browser that prefers reduced, and stored reduced against one that does not.
    expect(parseSettings(doc({ motion: 'full' }), REDUCED).motion).toBe('full');
    expect(parseSettings(doc({ motion: 'reduced' }), CALM).motion).toBe('reduced');
    // Stored full or reduced, agreeing with the preference, and nothing stored, are the other two of the four.
    expect(parseSettings(doc({ motion: 'reduced' }), REDUCED).motion).toBe('reduced');
    expect(parseSettings(doc({ motion: 'full' }), CALM).motion).toBe('full');
  });

  it.each(MOTIONS)('uses a stored %s whatever the browser prefers', (motion) => {
    for (const env of ENVS) expect(parseSettings(doc({ motion }), env).motion).toBe(motion);
  });

  it('falls back to the browser preference when the stored choice is not one of the three', () => {
    for (const bad of ['', 'Full', 'FULL', 'none', 'reduced ', 0, 1, null, true, [], {}, ['full']]) {
      expect(parseSettings(doc({ motion: bad }), REDUCED).motion).toBe('reduced');
      expect(parseSettings(doc({ motion: bad }), CALM).motion).toBe('full');
    }
  });

  it('counts the preference only when it is exactly true', () => {
    const odd = { prefersReducedMotion: 'yes' } as unknown as { prefersReducedMotion: boolean };
    expect(parseSettings(null, odd).motion).toBe('full');
    expect(parseSettings(doc({ motion: 'bogus' }), odd).motion).toBe('full');
  });
});

describe('a stored version (Req 20.2, 20.3)', () => {
  it('is written by serializeSettings, with the four settings and nothing else', () => {
    const written: unknown = JSON.parse(serializeSettings(STORED));
    expect(written).toEqual({ version: SETTINGS_VERSION, ...STORED });
    expect(Object.keys(written as object)).toEqual(['version', 'motion', 'mute', 'volume', 'hands']);
  });

  it('writes only the four settings even when the object has more', () => {
    const more = { ...STORED, calibration: [1, 2], pose: { x: 1 }, extra: 'x' } as Settings;
    expect(Object.keys(JSON.parse(serializeSettings(more)) as object).sort()).toEqual(
      ['hands', 'motion', 'mute', 'version', 'volume'],
    );
  });

  it.each([SETTINGS_VERSION + 1, SETTINGS_VERSION - 1, 0, -1, 1.5, '1', null, true, [1], {}, 1e308])(
    'gives all defaults, not a single field, for version %j',
    (version) => {
      for (const env of ENVS) {
        expect(parseSettings(doc(STORED, version), env)).toEqual(defaultsFor(env));
      }
    },
  );

  it('gives all defaults when the version is missing', () => {
    for (const env of ENVS) expect(parseSettings(JSON.stringify(STORED), env)).toEqual(defaultsFor(env));
  });

  it('reads the stored fields of the right version', () => {
    for (const env of ENVS) expect(parseSettings(doc(STORED), env)).toEqual(STORED);
  });
});

describe('the round trip (Req 20.2)', () => {
  const genSettings = (): fc.Arbitrary<Settings> =>
    fc.record({
      motion: fc.constantFrom<MotionLevel>(...MOTIONS),
      mute: fc.boolean(),
      volume: genSpread(0, 1),
      hands: fc.constantFrom<Settings['hands']>('right', 'left', 'both', null),
    });

  it('returns the settings that serializeSettings wrote, whatever the browser prefers', () => {
    fc.assert(
      fc.property(genSettings(), fc.boolean(), (s, reduced) => {
        expect(parseSettings(serializeSettings(s), { prefersReducedMotion: reduced })).toEqual(s);
      }),
      { numRuns: 300 },
    );
  });

  it('keeps both ends of the volume range and reads -0 as 0', () => {
    for (const volume of [0, 1, TUNING.defaultVolume]) {
      expect(parseSettings(serializeSettings({ ...STORED, volume }), CALM).volume).toBe(volume);
    }
    expect(Object.is(parseSettings(withField('volume', '-0'), CALM).volume, 0)).toBe(true);
  });

  it('serializes a volume that is not a number as one that takes its default', () => {
    for (const volume of [NaN, Infinity, -Infinity]) {
      expect(parseSettings(serializeSettings({ ...STORED, volume }), CALM)).toEqual({
        ...STORED,
        volume: TUNING.defaultVolume,
      });
    }
  });
});

describe('one invalid field (Req 20.3)', () => {
  it('leaves the other three fields as stored, for every field and several bad values', () => {
    const bad: Record<keyof Settings, string[]> = {
      motion: ['"loud"', '3', 'null', '[]', '{}', 'true'],
      mute: ['"true"', '1', '0', 'null', '[]', '{}'],
      volume: ['"0.5"', 'null', 'true', '[]', '{}', '2', '-1'],
      hands: ['"up"', '"Right"', '"both "', '1', 'true', '[]', '{}', '"__proto__"'],
    };
    for (const env of ENVS) {
      const expectedDefault = defaultsFor(env);
      for (const field of Object.keys(bad) as (keyof Settings)[]) {
        for (const text of bad[field]) {
          const got = parseSettings(withField(field, text), env);
          expect(got, `${field} = ${text}`).toEqual({ ...STORED, [field]: expectedDefault[field] });
        }
      }
    }
  });

  it('gives a missing field its default and keeps the others', () => {
    for (const env of ENVS) {
      for (const field of Object.keys(STORED) as (keyof Settings)[]) {
        const fields: Record<string, unknown> = { ...STORED };
        delete fields[field];
        expect(parseSettings(doc(fields), env)).toEqual({ ...STORED, [field]: defaultsFor(env)[field] });
      }
    }
  });

  it('reads hands null as not chosen and accepts right, left and both', () => {
    for (const hands of ['right', 'left', 'both', null] as const) {
      expect(parseSettings(withField('hands', JSON.stringify(hands)), CALM).hands).toBe(hands);
    }
  });

  it('accepts a mute of true and of false, and nothing else', () => {
    expect(parseSettings(withField('mute', 'false'), CALM).mute).toBe(false);
    expect(parseSettings(withField('mute', 'true'), CALM).mute).toBe(true);
    expect(parseSettings(withField('mute', '"true"'), CALM).mute).toBe(DEFAULT_SETTINGS.mute);
  });
});

describe('the volume (Req 20.1, 20.6)', () => {
  const OUTSIDE = [
    '1.0000000000000002',
    '-5e-324',
    '-0.0000001',
    '2',
    '-1',
    '1e308',
    '-1e308',
    '1e999',
    '-1e999',
    '"0.5"',
    '"NaN"',
    '"Infinity"',
    '"1"',
    'null',
    'true',
    '[0.5]',
  ];

  it.each(OUTSIDE)('gives the default for %s, for that field only', (text) => {
    const got = parseSettings(withField('volume', text), CALM);
    expect(got.volume).toBe(TUNING.defaultVolume);
    expect({ ...got, volume: STORED.volume }).toEqual(STORED);
  });

  it('keeps 0, 1, the default and numbers between them', () => {
    for (const v of ['0', '1', '1.0', '0.0', String(TUNING.defaultVolume), '5e-324', '0.9999999999999999']) {
      expect(parseSettings(withField('volume', v), CALM).volume).toBe(Number(v));
    }
  });

  it('gives all defaults, not one field, when the text itself is not JSON (NaN and Infinity written out)', () => {
    for (const text of [`{"version":${SETTINGS_VERSION},"volume":NaN,"mute":true}`, `{"version":${SETTINGS_VERSION},"volume":Infinity,"mute":true}`]) {
      expect(parseSettings(text, CALM)).toEqual(defaultsFor(CALM));
    }
  });
});

describe('keys that name something on every object (Req 20.4)', () => {
  const VALID = '{"motion":"gentle","mute":true,"volume":0.1,"hands":"left"}';

  it.each([
    `{"version":${SETTINGS_VERSION},"__proto__":${VALID}}`,
    `{"__proto__":${VALID},"version":${SETTINGS_VERSION}}`,
    `{"version":${SETTINGS_VERSION},"constructor":${VALID}}`,
    `{"version":${SETTINGS_VERSION},"constructor":{"prototype":${VALID}}}`,
    `{"version":${SETTINGS_VERSION},"prototype":${VALID},"toString":${VALID},"hasOwnProperty":${VALID},"valueOf":${VALID}}`,
    `{"__proto__":{"__proto__":${VALID}},"version":${SETTINGS_VERSION}}`,
    `{"version":${SETTINGS_VERSION},"__proto__":{"version":${SETTINGS_VERSION},"motion":"gentle","polluted":true}}`,
  ])('reach nothing in %s', (raw) => {
    const got = parseSettings(raw, CALM);
    expect(got).toEqual(defaultsFor(CALM));
    expect(problemsWith(got)).toEqual([]);
    expect(Object.keys(got)).not.toContain('__proto__');
    expect(prototypeIsClean()).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('are not read as the settings of an object whose own fields are the stored ones', () => {
    const got = parseSettings(`{"__proto__":${VALID},"version":${SETTINGS_VERSION},"motion":"reduced"}`, CALM);
    expect(got).toEqual({ ...defaultsFor(CALM), motion: 'reduced' });
    expect(Object.getPrototypeOf(got)).toBe(Object.prototype);
  });

  it('are not read from the prototype: a field that only Object.prototype has is not a stored field', () => {
    const names = ['version', 'motion', 'mute', 'volume', 'hands'];
    const polluted: Record<string, unknown> = {
      version: SETTINGS_VERSION,
      motion: 'gentle',
      mute: true,
      volume: TUNING.defaultVolume / 2,
      hands: 'left',
    };
    try {
      for (const name of names) {
        Object.defineProperty(Object.prototype, name, { value: polluted[name], configurable: true, writable: true });
      }
      // Without the version of its own, the stored object is of no version, whatever the prototype says.
      expect(parseSettings('{"motion":"full"}', CALM)).toEqual(defaultsFor(CALM));
      // With its own version, the fields it lacks are the defaults, not the prototype's.
      expect(parseSettings(`{"version":${SETTINGS_VERSION}}`, CALM)).toEqual(defaultsFor(CALM));
      expect(parseSettings(`{"version":${SETTINGS_VERSION},"volume":0.5}`, CALM)).toEqual({ ...defaultsFor(CALM), volume: 0.5 });
    } finally {
      for (const name of names) Reflect.deleteProperty(Object.prototype, name);
    }
    expect(prototypeIsClean()).toBe(true);
  });

  it('are not copied into the result with the stored fields next to them', () => {
    const got = parseSettings(
      `{"version":${SETTINGS_VERSION},"motion":"gentle","extra":1,"__proto__":{"a":1},"constructor":2}`,
      CALM,
    );
    expect(got).toEqual({ ...defaultsFor(CALM), motion: 'gentle' });
    expect(Object.keys(got).sort()).toEqual(['hands', 'motion', 'mute', 'volume']);
  });
});

describe('input of any shape (Req 20.4)', () => {
  it.each([
    ['null', 'null'],
    ['an array', '[1,2,3]'],
    ['an array of settings', `[${doc(STORED)}]`],
    ['a number', '7'],
    ['a string', '"text"'],
    ['a string holding settings', JSON.stringify(doc(STORED))],
    ['true', 'true'],
  ])('gives all defaults for a top level that is %s', (_name, raw) => {
    for (const env of ENVS) expect(parseSettings(raw, env)).toEqual(defaultsFor(env));
  });

  it('does not throw for JSON nested a hundred thousand levels deep, closed or not', () => {
    const n = 100_000;
    const texts = [`${'['.repeat(n)}${']'.repeat(n)}`, '['.repeat(n), `${'{"a":'.repeat(n)}1${'}'.repeat(n)}`, doc({ motion: 'gentle' }).replace('"gentle"', `${'['.repeat(n)}${']'.repeat(n)}`)];
    for (const raw of texts) {
      for (const env of ENVS) expect(() => parseSettings(raw, env)).not.toThrow();
    }
    expect(parseSettings(texts[0] ?? '', CALM)).toEqual(defaultsFor(CALM));
  });

  it('does not throw for very long strings, and treats them as invalid values', () => {
    const long = 'a'.repeat(5_000_000);
    expect(parseSettings(long, CALM)).toEqual(defaultsFor(CALM));
    expect(parseSettings(withField('hands', JSON.stringify(long)), CALM)).toEqual({ ...STORED, hands: null });
    expect(parseSettings(withField('motion', JSON.stringify(long)), CALM)).toEqual({ ...STORED, motion: 'full' });
    expect(parseSettings(`{"version":${SETTINGS_VERSION},"${long}":1,"motion":"gentle"}`, CALM).motion).toBe('gentle');
  });

  it('does not throw for a lone surrogate, a control character or a byte-order mark', () => {
    for (const raw of ['\ud800', '\u0000', '\ufeff' + doc(STORED), '{"version":1,"motion":"\ud800"}', '\u2028']) {
      for (const env of ENVS) expect(() => parseSettings(raw, env)).not.toThrow();
    }
  });

  it('does not throw for a value that is not a string at all', () => {
    for (const raw of [undefined, 5, {}, [], Symbol('x'), () => 1] as unknown[]) {
      expect(parseSettings(raw as string, CALM)).toEqual(defaultsFor(CALM));
    }
  });
});

describe('parseSettings (Req 20.4)', () => {
  // Never throws, always returns the four valid settings, equals the reading of Req 20.3, and leaves every object untouched.
  it('settings_parse_never_throws', () => {
    fc.assert(
      fc.property(genSettingsString(), fc.boolean(), (raw, reduced) => {
        const env = { prefersReducedMotion: reduced };
        const got = parseSettings(raw, env);
        expect(problemsWith(got)).toEqual([]);
        expect(got).toEqual(oracle(raw, env));
        // What it returns is stable: writing it and reading it again gives the same settings.
        expect(parseSettings(serializeSettings(got), env)).toEqual(got);
        expect(prototypeIsClean()).toBe(true);
      }),
      { numRuns: RUNS },
    );
  });
});

describe('the barrel', () => {
  it('exports the settings names of design section 6', () => {
    expect(core.DEFAULT_SETTINGS).toBe(DEFAULT_SETTINGS);
    expect(core.SETTINGS_VERSION).toBe(SETTINGS_VERSION);
    expect(core.parseSettings).toBe(parseSettings);
    expect(core.serializeSettings).toBe(serializeSettings);
  });
});
