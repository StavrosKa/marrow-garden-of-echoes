// The seeded choices and pose frames of a synthetic player (requirements 19.1, 19.6). The property tests draw their
// seeds and indexes from fc.integer, never from a ranged fc.double.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { seedRng, type Rng } from '../challenges/rng';
import type { Vec2 } from '../core';
import { chooseFor, framesFor } from './player';
import { SIM_PROFILES, type SimProfile } from './tuning';

const named = (name: SimProfile['name']): SimProfile => {
  const profile = SIM_PROFILES.find((candidate) => candidate.name === name);
  if (profile === undefined) throw new Error(`no profile ${name}`);
  return profile;
};

const SLOT: Vec2 = { x: 0.3, y: 0.6 };
const ASPECT = 16 / 9;

/** The choices of `count` presentations, alternating marks, from one generator. */
function choicesFrom(profile: SimProfile, start: Rng, count: number) {
  let rng = start;
  const out: { dwell: boolean; wrong: boolean }[] = [];
  for (let i = 0; i < count; i++) {
    const choice = chooseFor(profile, rng, i % 2 === 0 ? 'select' : 'pass');
    rng = choice.rng;
    out.push({ dwell: choice.dwell, wrong: choice.wrong });
  }
  return out;
}

describe('the seeded choices (player.ts)', () => {
  it('19.1 chooseFor gives the same choice for the same seed', () => {
    const profile = named('incorrect-answers');
    expect(choicesFrom(profile, seedRng(42), 200)).toEqual(choicesFrom(profile, seedRng(42), 200));
  });

  it('19.6 rate 0 never answers wrong and rate 1.0 always does', () => {
    const baseline = choicesFrom(named('baseline'), seedRng(7), 1000);
    expect(baseline.every((choice) => !choice.wrong)).toBe(true);
    const adversarial = choicesFrom(named('adversarial'), seedRng(7), 1000);
    expect(adversarial.every((choice) => choice.wrong)).toBe(true);
  });

  it('19.6 a wrong select is no dwell, and a wrong pass is a dwell', () => {
    const adversarial = named('adversarial');
    const select = chooseFor(adversarial, seedRng(3), 'select');
    expect(select).toMatchObject({ dwell: false, wrong: true });
    const pass = chooseFor(adversarial, seedRng(3), 'pass');
    expect(pass).toMatchObject({ dwell: true, wrong: true });
    const right = chooseFor(named('baseline'), seedRng(3), 'select');
    expect(right).toMatchObject({ dwell: true, wrong: false });
  });

  it('19.1 chooseFor returns the generator after its one draw', () => {
    const start = seedRng(5);
    const choice = chooseFor(named('jitter'), start, 'pass');
    expect(choice.rng).not.toBe(start);
  });
});

describe('the seeded pose frames (player.ts)', () => {
  it('19.1 framesFor gives the same frames for the same seed and span', () => {
    const profile = named('jitter');
    const span = { startMs: 1000, endMs: 1500 };
    const first = framesFor(profile, seedRng(9), SLOT, true, ASPECT, span);
    const second = framesFor(profile, seedRng(9), SLOT, true, ASPECT, span);
    expect(first.frames).toEqual(second.frames);
    expect(first.frames).toHaveLength(10);
  });

  it('19.1 framesFor gives different frames for different seeds', () => {
    const profile = named('jitter');
    const span = { startMs: 0, endMs: 500 };
    const first = framesFor(profile, seedRng(1), SLOT, true, ASPECT, span);
    const second = framesFor(profile, seedRng(2), SLOT, true, ASPECT, span);
    expect(first.frames[0]?.landmarks.rightWrist.pos).not.toEqual(second.frames[0]?.landmarks.rightWrist.pos);
  });

  it('19.1 the right wrist sits on the slot when it dwells, and at rest when it does not', () => {
    const profile = named('baseline');
    const on = framesFor(profile, seedRng(4), SLOT, true, ASPECT, { startMs: 0, endMs: 50 }).frames[0];
    expect(on?.landmarks.rightWrist).toEqual({ pos: SLOT, valid: true });
    const off = framesFor(profile, seedRng(4), SLOT, false, ASPECT, { startMs: 0, endMs: 50 }).frames[0];
    expect(off?.landmarks.rightWrist.pos).not.toEqual(SLOT);
  });

  it('19.1 the one-hand profile keeps the left wrist invalid', () => {
    const frames = framesFor(named('one-hand'), seedRng(4), SLOT, true, ASPECT, { startMs: 0, endMs: 500 }).frames;
    expect(frames.every((frame) => !frame.landmarks.leftWrist.valid)).toBe(true);
  });

  it('19.1 the tracking-gaps profile loses the right wrist for each gap, and no other time', () => {
    const profile = named('tracking-gaps');
    const frames = framesFor(profile, seedRng(4), SLOT, true, ASPECT, { startMs: 0, endMs: 8000 }).frames;
    expect(frames).toHaveLength(160);
    expect(frames.filter((frame) => !frame.landmarks.rightWrist.valid)).toHaveLength(8);
  });

  it('19.1 framesFor gives the same frames for the same seed and span, for every profile (300 cases)', () => {
    const indexes = fc.integer({ min: 0, max: SIM_PROFILES.length - 1 });
    const seeds = fc.integer({ min: 0, max: 4294967295 });
    fc.assert(
      fc.property(indexes, seeds, fc.integer({ min: 1, max: 40 }), (index, seed, frames) => {
        const profile = SIM_PROFILES[index];
        if (profile === undefined) throw new Error('no profile');
        const span = { startMs: 0, endMs: frames * profile.frameIntervalMs };
        const a = framesFor(profile, seedRng(seed), SLOT, true, ASPECT, span);
        const b = framesFor(profile, seedRng(seed), SLOT, true, ASPECT, span);
        expect(a.frames).toEqual(b.frames);
        expect(a.frames).toHaveLength(frames);
      }),
      { numRuns: 300 },
    );
  });

  it('19.1 replaying the choices from one seed gives the same choices, for every profile (300 cases)', () => {
    const indexes = fc.integer({ min: 0, max: SIM_PROFILES.length - 1 });
    const seeds = fc.integer({ min: 0, max: 4294967295 });
    fc.assert(
      fc.property(indexes, seeds, (index, seed) => {
        const profile = SIM_PROFILES[index];
        if (profile === undefined) throw new Error('no profile');
        expect(choicesFrom(profile, seedRng(seed), 20)).toEqual(choicesFrom(profile, seedRng(seed), 20));
      }),
      { numRuns: 300 },
    );
  });
});
