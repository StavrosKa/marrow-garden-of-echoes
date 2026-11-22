// The tone player (Req 27.1 to 27.5). A fake AudioContext records every call, so the tests check the gain
// targets, the ramp times and the oscillators without a browser. The volume default comes from TUNING; the
// tone values come from the app constants that the player exports.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TUNING } from 'marrow/core';
import {
  ATTACK_MS,
  createTonePlayer,
  MASTER_FACTOR,
  RAMP_MS,
  RELEASE_MS,
  TONE_MS,
  TONES_HZ,
  type ToneContext,
  type ToneGain,
  type ToneOscillator,
  type ToneParam,
} from './tonePlayer';

const MS = 1000;
const NOW = 10;

interface Event {
  readonly kind: 'set' | 'ramp' | 'cancel';
  readonly value?: number;
  readonly time: number;
}

/** An AudioParam that keeps its events. `value` is written only by the one place that sets it directly. */
class FakeParam implements ToneParam {
  value = 0;
  readonly events: Event[] = [];
  setValueAtTime(value: number, time: number): void {
    this.events.push({ kind: 'set', value, time });
  }
  linearRampToValueAtTime(value: number, time: number): void {
    this.events.push({ kind: 'ramp', value, time });
  }
  cancelScheduledValues(time: number): void {
    this.events.push({ kind: 'cancel', time });
  }
}

class FakeGain implements ToneGain {
  readonly gain = new FakeParam();
  readonly connections: unknown[] = [];
  connect(destination: unknown): void {
    this.connections.push(destination);
  }
}

class FakeOscillator implements ToneOscillator {
  type = '';
  readonly frequency = new FakeParam();
  readonly connections: unknown[] = [];
  readonly starts: number[] = [];
  readonly stops: number[] = [];
  connect(destination: unknown): void {
    this.connections.push(destination);
  }
  start(time: number): void {
    this.starts.push(time);
  }
  stop(time: number): void {
    this.stops.push(time);
  }
}

class FakeContext implements ToneContext {
  readonly currentTime = NOW;
  readonly destination = 'destination';
  readonly gains: FakeGain[] = [];
  readonly oscillators: FakeOscillator[] = [];
  resumed = 0;
  closed = 0;
  createGain(): ToneGain {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }
  createOscillator(): ToneOscillator {
    const oscillator = new FakeOscillator();
    this.oscillators.push(oscillator);
    return oscillator;
  }
  resume(): Promise<void> {
    this.resumed += 1;
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.closed += 1;
    return Promise.resolve();
  }
}

/** A player whose factory records how many contexts were made, and returns the last one. */
function playerWithFake() {
  const made: FakeContext[] = [];
  const player = createTonePlayer(() => {
    const context = new FakeContext();
    made.push(context);
    return context;
  });
  return { player, made };
}

/** The master gain of the first context: the first gain node the player made. */
function masterOf(context: FakeContext): FakeGain {
  const master = context.gains[0];
  if (master === undefined) throw new Error('the player made no master gain');
  return master;
}

/** The last ramp of the master gain. */
function lastMasterRamp(context: FakeContext): Event {
  const ramps = masterOf(context).gain.events.filter((event) => event.kind === 'ramp');
  const last = ramps.at(-1);
  if (last === undefined) throw new Error('the master gain has no ramp');
  return last;
}

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'tonePlayer.ts');

describe('the tone player', () => {
  it('creates no AudioContext before start, whatever else is called', () => {
    const { player, made } = playerWithFake();
    player.setVolume(0.4);
    player.setMuted(true);
    player.playTarget(0);
    expect(made).toHaveLength(0);
  });

  it('creates one context on start and resumes it; a later start only resumes', () => {
    const { player, made } = playerWithFake();
    player.start();
    expect(made).toHaveLength(1);
    expect(made[0]?.resumed).toBe(1);
    player.start();
    expect(made).toHaveLength(1);
    expect(made[0]?.resumed).toBe(2);
  });

  it('starts with the master gain at volume times 0.5, reached by a ramp of 100 ms', () => {
    const { player, made } = playerWithFake();
    player.start();
    const context = made[0];
    if (context === undefined) throw new Error('no context');
    const ramp = lastMasterRamp(context);
    expect(ramp.value).toBeCloseTo(TUNING.defaultVolume * MASTER_FACTOR, 12);
    expect(ramp.time).toBeCloseTo(NOW + RAMP_MS / MS, 12);
    expect(masterOf(context).gain.events[0]).toEqual({ kind: 'cancel', time: NOW });
  });

  it('ramps every volume change over 100 ms from the current level, never a jump', () => {
    const { player, made } = playerWithFake();
    player.start();
    const context = made[0];
    if (context === undefined) throw new Error('no context');
    player.setVolume(0.8);
    const ramp = lastMasterRamp(context);
    expect(ramp.value).toBeCloseTo(0.8 * MASTER_FACTOR, 12);
    expect(ramp.time - NOW).toBeCloseTo(RAMP_MS / MS, 12);
    // The change starts from the level the master already held, not from zero.
    const events = masterOf(context).gain.events;
    const set = events.filter((event) => event.kind === 'set').at(-1);
    expect(set?.value).toBeCloseTo(TUNING.defaultVolume * MASTER_FACTOR, 12);
    expect(set?.time).toBe(NOW);
  });

  it('mute ramps the master to 0, and unmute ramps it back to volume times 0.5', () => {
    const { player, made } = playerWithFake();
    player.start();
    const context = made[0];
    if (context === undefined) throw new Error('no context');
    player.setMuted(true);
    expect(lastMasterRamp(context).value).toBe(0);
    expect(lastMasterRamp(context).time - NOW).toBeCloseTo(RAMP_MS / MS, 12);
    player.setMuted(false);
    expect(lastMasterRamp(context).value).toBeCloseTo(TUNING.defaultVolume * MASTER_FACTOR, 12);
  });

  it('never writes the gain value directly, so no change is a jump', () => {
    const { player, made } = playerWithFake();
    player.start();
    player.setVolume(0.2);
    player.setMuted(true);
    player.playTarget(1);
    const context = made[0];
    if (context === undefined) throw new Error('no context');
    expect(masterOf(context).gain.value).toBe(0);
  });

  it('plays a sine at C5, E5 and G5 for about 400 ms, one tone per target index', () => {
    const { player, made } = playerWithFake();
    player.start();
    const context = made[0];
    if (context === undefined) throw new Error('no context');
    player.playTarget(0);
    player.playTarget(1);
    player.playTarget(2);
    player.playTarget(3);
    expect(TONES_HZ).toEqual([523.25, 659.25, 783.99]);
    const frequencies = context.oscillators.map((oscillator) => oscillator.frequency.value);
    expect(frequencies).toEqual([523.25, 659.25, 783.99, 523.25]);
    for (const oscillator of context.oscillators) {
      expect(oscillator.type).toBe('sine');
      expect(oscillator.starts).toEqual([NOW]);
      expect(oscillator.stops[0]).toBeCloseTo(NOW + TONE_MS / MS, 12);
    }
  });

  it('shapes each tone with a soft attack and a soft release inside its length', () => {
    expect(ATTACK_MS + RELEASE_MS).toBeLessThan(TONE_MS);
    const { player, made } = playerWithFake();
    player.start();
    player.playTarget(0);
    const context = made[0];
    if (context === undefined) throw new Error('no context');
    // The envelope is the gain node made after the master: the second gain of the context.
    const envelope = context.gains[1];
    if (envelope === undefined) throw new Error('no envelope');
    const ramps = envelope.gain.events.filter((event) => event.kind === 'ramp');
    expect(ramps[0]?.value).toBe(1);
    expect(ramps[0]?.time).toBeCloseTo(NOW + ATTACK_MS / MS, 12);
    expect(ramps.at(-1)?.value).toBe(0);
    expect(ramps.at(-1)?.time).toBeCloseTo(NOW + TONE_MS / MS, 12);
  });

  it('is silent while muted: the tone still plays into a master held at 0', () => {
    const { player, made } = playerWithFake();
    player.start();
    player.setMuted(true);
    player.playTarget(0);
    const context = made[0];
    if (context === undefined) throw new Error('no context');
    expect(lastMasterRamp(context).value).toBe(0);
    expect(context.oscillators[0]?.connections).toEqual([context.gains[1]]);
  });

  it('dispose closes the context once, and later calls do nothing', () => {
    const { player, made } = playerWithFake();
    player.start();
    player.dispose();
    player.dispose();
    player.playTarget(0);
    player.start();
    const context = made[0];
    if (context === undefined) throw new Error('no context');
    expect(context.closed).toBe(1);
    expect(context.oscillators).toHaveLength(0);
    expect(made).toHaveLength(1);
  });

  it('uses oscillators only and no audio files (Req 27.2)', () => {
    const source = readFileSync(SCRIPT, 'utf8');
    expect(source).not.toMatch(/createBufferSource|decodeAudioData|\.(mp3|wav|ogg|m4a)\b/);
    expect(source).toContain('createOscillator');
  });
});
