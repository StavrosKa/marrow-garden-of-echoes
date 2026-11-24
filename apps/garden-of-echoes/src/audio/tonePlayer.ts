// The tone player of the input playground (Req 27, design section 14.5). Web Audio oscillators only, no audio
// files. The AudioContext is created and resumed only by `start()`, which the Start handler calls (Req 27.1).
// Every change of the master gain is a ramp of RAMP_MS, never a jump (Req 27.4).
//
// The app values below live here, beside the code that uses them (Appendix B, app values). None is in tuning.ts.
// playFrequency(hz) is the garden's note player (garden-level design 2.10). The playground's playTarget uses the
// same sound, so its tones and its tests are unchanged.
import { TUNING } from 'marrow/core';

/** The three pentatonic tones of a round, C5, E5 and G5 in equal temperament, one per target (Req 27.3). */
export const TONES_HZ: readonly number[] = [523.25, 659.25, 783.99];

/** How long one tone sounds (Req 27.3: about 400 ms). */
export const TONE_MS = 400;

/** The soft attack and release of one tone. They lie inside TONE_MS. Chosen for this spec; not in Appendix B. */
export const ATTACK_MS = 40;
export const RELEASE_MS = 120;

/** The master gain is volume times this cap (Req 27.4). */
export const MASTER_FACTOR = 0.5;

/** Every change of the master gain, from volume or mute, takes this long (Req 27.4). */
export const RAMP_MS = 100;

const MS_PER_SECOND = 1000;

/** The part of an AudioParam that the player uses. */
export interface ToneParam {
  value: number;
  setValueAtTime(value: number, time: number): void;
  linearRampToValueAtTime(value: number, time: number): void;
  cancelScheduledValues(time: number): void;
}

/** The part of a GainNode that the player uses. */
export interface ToneGain {
  readonly gain: ToneParam;
  connect(destination: unknown): void;
}

/** The part of an OscillatorNode that the player uses. */
export interface ToneOscillator {
  type: string;
  readonly frequency: ToneParam;
  connect(destination: unknown): void;
  start(time: number): void;
  stop(time: number): void;
}

/** The part of an AudioContext that the player uses, so tests can use a fake with the same members. */
export interface ToneContext {
  readonly currentTime: number;
  readonly destination: unknown;
  createGain(): ToneGain;
  createOscillator(): ToneOscillator;
  resume(): Promise<void>;
  close(): Promise<void>;
}

export interface TonePlayer {
  /** Creates the context on the first call and resumes it on later ones. Call it only from the Start handler. */
  start(): void;
  /** Plays the tone of target `index` (wrapped by the number of tones). Does nothing before `start()`. */
  playTarget(index: number): void;
  /** Plays one sine tone of `hz` for TONE_MS. Does nothing before `start()`. */
  playFrequency(hz: number): void;
  /** The volume, 0..1, from the settings. The master gain becomes volume times MASTER_FACTOR. */
  setVolume(volume: number): void;
  setMuted(muted: boolean): void;
  /** Closes the context. Later calls do nothing. */
  dispose(): void;
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * A player over one context factory. Nothing is created until `start()` is called. The factory is the only
 * place that touches the browser, so the tests pass a fake.
 */
export function createTonePlayer(createContext: () => ToneContext): TonePlayer {
  let context: ToneContext | null = null;
  let master: ToneGain | null = null;
  let volume = TUNING.defaultVolume;
  let muted = false;
  /** The gain value the master holds or is ramping to, so the next ramp starts from it. */
  let level = 0;
  let disposed = false;

  function target(): number {
    return muted ? 0 : volume * MASTER_FACTOR;
  }

  /** Ramps the master gain from its current level to the target over RAMP_MS (Req 27.4, 27.5). */
  function ramp(): void {
    if (context === null || master === null) return;
    const now = context.currentTime;
    const param = master.gain;
    param.cancelScheduledValues(now);
    param.setValueAtTime(level, now);
    param.linearRampToValueAtTime(target(), now + RAMP_MS / MS_PER_SECOND);
    level = target();
  }

  /** One sine tone with a soft attack and release, into the master gain. Silent before start and after dispose. */
  function sound(hz: number): void {
    if (disposed || context === null || master === null) return;
    const now = context.currentTime;
    const end = now + TONE_MS / MS_PER_SECOND;
    const oscillator = context.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.value = hz;
    // The envelope shapes one tone: silence, a soft attack, a hold, and a soft release to silence at the end.
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0, now);
    envelope.gain.linearRampToValueAtTime(1, now + ATTACK_MS / MS_PER_SECOND);
    envelope.gain.setValueAtTime(1, end - RELEASE_MS / MS_PER_SECOND);
    envelope.gain.linearRampToValueAtTime(0, end);
    oscillator.connect(envelope);
    envelope.connect(master);
    oscillator.start(now);
    oscillator.stop(end);
  }

  return {
    start(): void {
      if (disposed) return;
      if (context !== null) {
        void context.resume();
        return;
      }
      context = createContext();
      master = context.createGain();
      master.connect(context.destination);
      void context.resume();
      ramp();
    },
    playTarget(index: number): void {
      const count = TONES_HZ.length;
      const tone = TONES_HZ[((index % count) + count) % count] ?? 0;
      sound(tone);
    },
    playFrequency(hz: number): void {
      sound(hz);
    },
    setVolume(next: number): void {
      volume = clampUnit(next);
      ramp();
    },
    setMuted(next: boolean): void {
      muted = next;
      ramp();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (context !== null) void context.close();
      context = null;
      master = null;
    },
  };
}
