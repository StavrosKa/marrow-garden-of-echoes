// The stored settings (Requirement 20, design section 5): the pure half. parseSettings turns
// whatever string was stored into valid settings and never throws; serializeSettings writes the
// versioned JSON. The storage half is react/settingsStore.ts, because localStorage is a DOM API.
//
// Decisions the requirements leave open (each is recorded in docs/kiro-journal.md):
//  - The result is built field by field from the four known keys, each read only when it is an own
//    property of the parsed object. The parsed object is never spread, copied or assigned from, so
//    keys such as "__proto__" or "constructor" reach nothing.
//  - Valid JSON that is not an object (null, an array, a number, a string, true or false) is treated
//    as data in the wrong shape: all defaults, like non-JSON.
//  - A stored volume of -0 is read as 0, so that a round trip returns an equal value.
//  - `hands: null` in the stored data is "not chosen" and is valid; a missing hands field is the
//    same. Any other value that is not right, left or both gives the default, which is null.
//  - env.prefersReducedMotion counts only when it is exactly true.
import { TUNING } from './tuning';

/** The three motion levels (Req 20.1). */
export type MotionLevel = 'full' | 'gentle' | 'reduced';

/** The four stored settings and nothing else (Req 20.1). `hands` is null until the player chooses. */
export interface Settings {
  motion: MotionLevel;
  mute: boolean;
  /** 0..1, both ends included. */
  volume: number;
  hands: 'right' | 'left' | 'both' | null;
}

/** The version written by serializeSettings; any other stored version gives all defaults (Req 20.3). */
export const SETTINGS_VERSION = 1;

/**
 * The defaults when the browser has no preference (Req 20.6). The motion default depends on the
 * browser, so parseSettings computes it; this object holds the one for no preference.
 */
export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  motion: 'full',
  mute: false,
  volume: TUNING.defaultVolume,
  hands: null,
});

const MOTION_LEVELS: readonly string[] = ['full', 'gentle', 'reduced'];
const HANDS_CHOICES: readonly string[] = ['right', 'left', 'both'];

/** The own property `key` of a parsed value, or undefined when the value has no such own property. */
function ownField(value: object, key: string): unknown {
  return Object.hasOwn(value, key) ? (value as Record<string, unknown>)[key] : undefined;
}

function motionDefault(env: { prefersReducedMotion: boolean }): MotionLevel {
  return env.prefersReducedMotion === true ? 'reduced' : DEFAULT_SETTINGS.motion;
}

function defaults(env: { prefersReducedMotion: boolean }): Settings {
  return {
    motion: motionDefault(env),
    mute: DEFAULT_SETTINGS.mute,
    volume: DEFAULT_SETTINGS.volume,
    hands: DEFAULT_SETTINGS.hands,
  };
}

function readMotion(value: unknown, env: { prefersReducedMotion: boolean }): MotionLevel {
  if (typeof value === 'string' && MOTION_LEVELS.includes(value)) return value as MotionLevel;
  return motionDefault(env);
}

function readVolume(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1) {
    // Adding 0 turns -0 into 0 and changes no other number.
    return value + 0;
  }
  return DEFAULT_SETTINGS.volume;
}

function readHands(value: unknown): Settings['hands'] {
  if (typeof value === 'string' && HANDS_CHOICES.includes(value)) return value as 'right' | 'left' | 'both';
  return DEFAULT_SETTINGS.hands;
}

/**
 * Read stored data into valid settings. Never throws, for any input (Req 20.4). Data that is not
 * valid JSON, not an object or of another version gives all defaults; an invalid or missing field
 * gives the default of that field only (Req 20.3). A valid stored motion choice is used instead of
 * the browser preference (Req 20.7); with none stored, the preference decides (Req 20.6).
 */
export function parseSettings(raw: string | null, env: { prefersReducedMotion: boolean }): Settings {
  try {
    if (typeof raw !== 'string') return defaults(env);
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return defaults(env);
    if (ownField(parsed, 'version') !== SETTINGS_VERSION) return defaults(env);
    const mute = ownField(parsed, 'mute');
    return {
      motion: readMotion(ownField(parsed, 'motion'), env),
      mute: typeof mute === 'boolean' ? mute : DEFAULT_SETTINGS.mute,
      volume: readVolume(ownField(parsed, 'volume')),
      hands: readHands(ownField(parsed, 'hands')),
    };
  } catch {
    // JSON.parse can throw on non-JSON and on input nested too deeply for the engine.
    return defaults(env);
  }
}

/** Write the settings as versioned JSON (Req 20.2): the version and the four fields, nothing else. */
export function serializeSettings(s: Settings): string {
  return JSON.stringify({
    version: SETTINGS_VERSION,
    motion: s.motion,
    mute: s.mute,
    volume: s.volume,
    hands: s.hands,
  });
}
