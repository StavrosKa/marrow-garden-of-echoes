// The Trace Source (design section 2.2, Req 7): plays an ordered list of PoseFrames,
// advanced only by the time the caller passes in. It reads no clock, touches no DOM
// and runs in Node (Req 7.1, 7.4).
//
// How time moves (Req 7.1 to 7.3):
// - Before the first advanceTo call the source has no time, so it exposes no frame.
// - advanceTo(t) exposes the last frame whose timestamp is at most t, or none when t
//   is before the first timestamp. Several frames passed in one call are skipped: the
//   source keeps no queue (Req 3.2).
// - The source never goes back. An advanceTo with a t that is not later than the
//   latest t it has seen, or that is not a finite number, changes nothing. This is how the
//   clocks of the core treat a negative or non-finite delta (clocks.ts).
// - The trace has ended once t is later than the last timestamp. At exactly the last
//   timestamp the last frame is exposed and the trace has not ended. An empty trace
//   has ended from the start.
import type { PoseFrame, PoseLandmarks } from '../core';
import type { PoseSource, StartOutcome } from './poseSource';

/** An ordered list of frames, with strictly increasing timestamps. */
export type Trace = readonly PoseFrame[];

export interface TraceSource extends PoseSource {
  /** Move the trace's time to `tMs`, in the frames' own timestamp scale. Never moves back. */
  advanceTo(tMs: number): void;
  /** True once the time is later than the last timestamp (Req 7.3). */
  ended(): boolean;
}

const LANDMARK_NAMES = [
  'leftWrist',
  'rightWrist',
  'nose',
  'leftShoulder',
  'rightShoulder',
] as const satisfies readonly (keyof PoseLandmarks)[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** The first problem of one frame, or null. Does not look at the previous frame. */
function frameProblem(frame: unknown): string | null {
  if (!isRecord(frame)) return 'is not an object';
  if (!isFiniteNumber(frame['t'])) return '"t" is missing or not a finite number';
  const aspect = frame['aspect'];
  if (!isFiniteNumber(aspect)) return '"aspect" is missing or not a finite number';
  if (aspect <= 0) return `"aspect" must be greater than 0, but is ${aspect}`;
  const landmarks = frame['landmarks'];
  if (!isRecord(landmarks)) return '"landmarks" is missing or not an object';
  for (const name of LANDMARK_NAMES) {
    const landmark = landmarks[name];
    if (!isRecord(landmark)) return `"landmarks.${name}" is missing or not an object`;
    if (typeof landmark['valid'] !== 'boolean') {
      return `"landmarks.${name}.valid" is missing or not true or false`;
    }
    const pos = landmark['pos'];
    if (!isRecord(pos)) return `"landmarks.${name}.pos" is missing or not an object`;
    for (const axis of ['x', 'y'] as const) {
      if (!isFiniteNumber(pos[axis])) {
        return `"landmarks.${name}.pos.${axis}" is missing or not a finite number`;
      }
    }
  }
  return null;
}

/**
 * Check a trace and return it unchanged (the same object), or throw an Error whose
 * message names the first bad frame by its index in the list, counted from 0 (Req 7.5).
 * A trace is bad when it is not a list, a frame lacks a field or has one of the wrong
 * kind, a frame's aspect is not above 0, or a timestamp is not later than the one
 * before it.
 */
export function validateTrace(raw: unknown): Trace {
  if (!Array.isArray(raw)) throw new Error('A trace must be a list of frames.');
  let previousT: number | null = null;
  for (let i = 0; i < raw.length; i++) {
    const frame: unknown = raw[i];
    const problem = frameProblem(frame);
    if (problem !== null) throw new Error(`Trace frame ${i}: ${problem}.`);
    const t = (frame as PoseFrame).t;
    if (previousT !== null && t <= previousT) {
      throw new Error(
        `Trace frame ${i}: "t" is ${t}, which is not later than ${previousT} in frame ${i - 1}.`,
      );
    }
    previousT = t;
  }
  return raw as Trace;
}

/**
 * A source that plays `trace`. It checks the trace first and throws the message of
 * `validateTrace` when the trace is malformed. `latest()` returns the same object
 * until a later frame is reached, so a consumer that compares references sees one
 * new frame per step.
 */
export function createTraceSource(trace: Trace): TraceSource {
  const frames: readonly PoseFrame[] = [...validateTrace(trace)];
  const lastT = frames.length > 0 ? (frames[frames.length - 1] as PoseFrame).t : null;
  let index = -1;
  let time = -Infinity;
  let disposed = false;

  return {
    start: (): Promise<StartOutcome> => Promise.resolve('ready'),
    latest: (): PoseFrame | null => (disposed ? null : (frames[index] ?? null)),
    advanceTo(tMs: number): void {
      if (disposed || !Number.isFinite(tMs) || tMs <= time) return;
      time = tMs;
      while (index + 1 < frames.length && (frames[index + 1] as PoseFrame).t <= tMs) index++;
    },
    ended: (): boolean => lastT === null || time > lastT,
    dispose(): void {
      disposed = true;
    },
  };
}
