// Tests for the Trace Source (Req 3.1 to 3.3, 7.1 to 7.5). They run in Node. The
// hand-written trace file is tested in tests/traces.test.ts (Req 7.6). The
// timestamps and positions below are data of the traces, not tuning values.
import { describe, expect, it } from 'vitest';
import type { PoseFrame } from '../core';
import * as inputBarrel from './index';
import { createTraceSource, validateTrace, type Trace } from './traceSource';

const landmark = (x: number, y: number, valid = true) => ({ pos: { x, y }, valid });

function frame(t: number, aspect = 1.5): PoseFrame {
  return {
    t,
    aspect,
    landmarks: {
      leftWrist: landmark(0.7, 0.5),
      rightWrist: landmark(0.3, 0.5),
      nose: landmark(0.5, 0.3),
      leftShoulder: landmark(0.6, 0.5),
      rightShoulder: landmark(0.4, 0.5),
    },
  };
}

/** A frame as plain data, so a test can break one field of it. */
function plain(t: number): Record<string, unknown> {
  return JSON.parse(JSON.stringify(frame(t))) as Record<string, unknown>;
}

function expectMessage(run: () => unknown, pattern: RegExp): void {
  expect(run).toThrow(pattern);
}

describe('advanceTo (Req 7.1 to 7.3)', () => {
  const a = frame(100);
  const b = frame(150);
  const c = frame(300);
  const trace: Trace = [a, b, c];

  it('exposes no frame before any advance', () => {
    const source = createTraceSource(trace);
    expect(source.latest()).toBeNull();
    expect(source.ended()).toBe(false);
  });

  it('exposes no frame for a t before the first timestamp', () => {
    const source = createTraceSource(trace);
    source.advanceTo(a.t - 1);
    expect(source.latest()).toBeNull();
    expect(source.ended()).toBe(false);
    source.advanceTo(0);
    expect(source.latest()).toBeNull();
  });

  it('exposes a frame at exactly its timestamp', () => {
    const source = createTraceSource(trace);
    source.advanceTo(a.t);
    expect(source.latest()).toBe(a);
    source.advanceTo(b.t);
    expect(source.latest()).toBe(b);
  });

  it('keeps the earlier frame between two timestamps, up to the one before the next', () => {
    const source = createTraceSource(trace);
    source.advanceTo((a.t + b.t) / 2);
    expect(source.latest()).toBe(a);
    source.advanceTo(b.t - 1e-9);
    expect(source.latest()).toBe(a);
    source.advanceTo((b.t + c.t) / 2);
    expect(source.latest()).toBe(b);
  });

  it('keeps the last frame after the last timestamp and reports the end only then', () => {
    const source = createTraceSource(trace);
    source.advanceTo(c.t);
    expect(source.latest()).toBe(c);
    expect(source.ended()).toBe(false);
    source.advanceTo(c.t + 1e-9);
    expect(source.latest()).toBe(c);
    expect(source.ended()).toBe(true);
    source.advanceTo(c.t + 1e6);
    expect(source.latest()).toBe(c);
    expect(source.ended()).toBe(true);
  });

  it('never queues: a jump over several frames exposes only the newest', () => {
    const source = createTraceSource(trace);
    source.advanceTo(c.t);
    expect(source.latest()).toBe(c);
    expect(source.latest()).not.toBe(a);
    expect(source.latest()).not.toBe(b);
  });

  it('returns the same object until a later frame is reached', () => {
    const source = createTraceSource(trace);
    source.advanceTo(a.t);
    const first = source.latest();
    source.advanceTo(a.t + 1);
    source.advanceTo(b.t - 1);
    expect(source.latest()).toBe(first);
    source.advanceTo(b.t);
    expect(source.latest()).not.toBe(first);
  });

  it('ignores an advance to a t that is not later than the latest one (decision)', () => {
    const source = createTraceSource(trace);
    source.advanceTo(b.t);
    source.advanceTo(a.t - 1000);
    expect(source.latest()).toBe(b);
    source.advanceTo(a.t);
    expect(source.latest()).toBe(b);
    source.advanceTo(b.t);
    expect(source.latest()).toBe(b);
    source.advanceTo(c.t);
    expect(source.latest()).toBe(c);
    source.advanceTo(0);
    expect(source.latest()).toBe(c);
    expect(source.ended()).toBe(false);
  });

  it('a backwards advance does not undo the end', () => {
    const source = createTraceSource(trace);
    source.advanceTo(c.t + 10);
    source.advanceTo(a.t);
    expect(source.latest()).toBe(c);
    expect(source.ended()).toBe(true);
  });

  it('ignores a t that is not a finite number', () => {
    const source = createTraceSource(trace);
    source.advanceTo(a.t);
    source.advanceTo(Number.NaN);
    source.advanceTo(Number.POSITIVE_INFINITY);
    source.advanceTo(Number.NEGATIVE_INFINITY);
    expect(source.latest()).toBe(a);
    expect(source.ended()).toBe(false);
    source.advanceTo(b.t);
    expect(source.latest()).toBe(b);
  });

  it('an empty trace exposes nothing and has ended', () => {
    const source = createTraceSource([]);
    expect(source.ended()).toBe(true);
    source.advanceTo(10);
    expect(source.latest()).toBeNull();
  });

  it('a trace of one frame', () => {
    const only = frame(5);
    const source = createTraceSource([only]);
    source.advanceTo(4);
    expect(source.latest()).toBeNull();
    source.advanceTo(5);
    expect(source.latest()).toBe(only);
    expect(source.ended()).toBe(false);
    source.advanceTo(6);
    expect(source.ended()).toBe(true);
  });

  it('is not changed by the caller changing the list afterwards', () => {
    const list = [a, b];
    const source = createTraceSource(list);
    list.length = 0;
    source.advanceTo(b.t);
    expect(source.latest()).toBe(b);
  });
});

describe('start and dispose (Req 3.1, 3.3)', () => {
  const trace: Trace = [frame(1), frame(2)];

  it('start resolves ready', async () => {
    await expect(createTraceSource(trace).start()).resolves.toBe('ready');
  });

  it('runs in Node, with no DOM', () => {
    expect(typeof document).toBe('undefined');
    expect(typeof window).toBe('undefined');
  });

  it('dispose twice does nothing the second time', () => {
    const source = createTraceSource(trace);
    source.advanceTo(2);
    source.dispose();
    expect(source.latest()).toBeNull();
    expect(() => {
      source.dispose();
    }).not.toThrow();
    expect(source.latest()).toBeNull();
    source.advanceTo(100);
    expect(source.latest()).toBeNull();
    expect(source.ended()).toBe(false);
  });

  it('exposes the three PoseSource members', () => {
    const source = createTraceSource(trace);
    expect(typeof source.start).toBe('function');
    expect(typeof source.latest).toBe('function');
    expect(typeof source.dispose).toBe('function');
  });
});

describe('malformed traces name the first bad frame (Req 7.5)', () => {
  const good = (t: number) => plain(t);
  function withBad(index: number, mutate: (f: Record<string, unknown>) => void): unknown[] {
    const list = [good(10), good(20), good(30), good(40)];
    mutate(list[index] as Record<string, unknown>);
    return list;
  }
  const landmarksOf = (f: Record<string, unknown>) => f['landmarks'] as Record<string, Record<string, unknown>>;

  it('returns a good trace unchanged', () => {
    const list = [good(10), good(20)];
    expect(validateTrace(list)).toBe(list);
    expect(validateTrace([])).toEqual([]);
  });

  it('rejects a value that is not a list', () => {
    expectMessage(() => validateTrace(null), /list of frames/);
    expectMessage(() => validateTrace({ frames: [] }), /list of frames/);
    expectMessage(() => validateTrace('trace'), /list of frames/);
  });

  const cases: [string, (f: Record<string, unknown>) => void, RegExp][] = [
    ['a missing t', (f) => void delete f['t'], /"t" is missing/],
    ['a t that is a string', (f) => void (f['t'] = '5'), /"t" is missing or not a finite number/],
    ['a t that is NaN', (f) => void (f['t'] = Number.NaN), /"t" is missing/],
    ['a missing aspect', (f) => void delete f['aspect'], /"aspect" is missing/],
    ['an aspect of zero', (f) => void (f['aspect'] = 0), /"aspect" must be greater than 0, but is 0/],
    ['a negative aspect', (f) => void (f['aspect'] = -1.5), /"aspect" must be greater than 0, but is -1.5/],
    ['an aspect of NaN', (f) => void (f['aspect'] = Number.NaN), /"aspect" is missing or not a finite number/],
    ['an aspect that is infinite', (f) => void (f['aspect'] = Number.POSITIVE_INFINITY), /"aspect" is missing or not a finite number/],
    ['missing landmarks', (f) => void delete f['landmarks'], /"landmarks" is missing/],
    ['landmarks that are a list', (f) => void (f['landmarks'] = []), /"landmarks" is missing/],
    ['a missing left wrist', (f) => void delete landmarksOf(f)['leftWrist'], /"landmarks.leftWrist" is missing/],
    ['a missing right wrist', (f) => void delete landmarksOf(f)['rightWrist'], /"landmarks.rightWrist" is missing/],
    ['a missing nose', (f) => void delete landmarksOf(f)['nose'], /"landmarks.nose" is missing/],
    ['a missing left shoulder', (f) => void delete landmarksOf(f)['leftShoulder'], /"landmarks.leftShoulder" is missing/],
    ['a missing right shoulder', (f) => void delete landmarksOf(f)['rightShoulder'], /"landmarks.rightShoulder" is missing/],
    ['a landmark that is null', (f) => void (landmarksOf(f)['nose'] = null as never), /"landmarks.nose" is missing/],
    ['a missing valid', (f) => void delete (landmarksOf(f)['nose'] as Record<string, unknown>)['valid'], /"landmarks.nose.valid" is missing/],
    ['a valid that is a number', (f) => void ((landmarksOf(f)['nose'] as Record<string, unknown>)['valid'] = 1), /"landmarks.nose.valid" is missing or not true or false/],
    ['a missing pos', (f) => void delete (landmarksOf(f)['leftWrist'] as Record<string, unknown>)['pos'], /"landmarks.leftWrist.pos" is missing/],
    ['a missing x', (f) => void delete ((landmarksOf(f)['rightWrist'] as Record<string, unknown>)['pos'] as Record<string, unknown>)['x'], /"landmarks.rightWrist.pos.x" is missing/],
    ['a y that is a string', (f) => void (((landmarksOf(f)['rightWrist'] as Record<string, unknown>)['pos'] as Record<string, unknown>)['y'] = '0.5'), /"landmarks.rightWrist.pos.y" is missing or not a finite number/],
    ['an x that is NaN', (f) => void (((landmarksOf(f)['leftShoulder'] as Record<string, unknown>)['pos'] as Record<string, unknown>)['x'] = Number.NaN), /"landmarks.leftShoulder.pos.x"/],
    ['an empty frame', (f) => void Object.keys(f).forEach((k) => delete f[k]), /"t" is missing/],
  ];

  for (const [name, mutate, pattern] of cases) {
    it(`${name}: the message names frame 2 and the field`, () => {
      const list = withBad(2, mutate);
      expectMessage(() => validateTrace(list), new RegExp(`^Trace frame 2: .*${pattern.source}`));
      expectMessage(() => createTraceSource(list as unknown as Trace), /^Trace frame 2: /);
    });
    it(`${name}: in frame 0 the message names frame 0`, () => {
      const list = withBad(0, mutate);
      expectMessage(() => validateTrace(list), new RegExp(`^Trace frame 0: .*${pattern.source}`));
    });
  }

  it('a frame that is not an object', () => {
    for (const bad of [null, 7, 'x', [], undefined]) {
      expectMessage(() => validateTrace([good(1), bad]), /^Trace frame 1: is not an object\./);
    }
  });

  it('a hole in the list is a bad frame', () => {
    const list: unknown[] = [good(1)];
    list[2] = good(3);
    expectMessage(() => validateTrace(list), /^Trace frame 1: /);
  });

  it('names the first bad frame when several are bad', () => {
    const list = withBad(1, (f) => void delete f['aspect']);
    (list[3] as Record<string, unknown>)['t'] = 'x';
    expectMessage(() => validateTrace(list), /^Trace frame 1: /);
    const reversed = withBad(3, (f) => void delete f['aspect']);
    (reversed[2] as Record<string, unknown>)['t'] = 'x';
    expectMessage(() => validateTrace(reversed), /^Trace frame 2: /);
  });

  it('a timestamp equal to the one before is not increasing', () => {
    const list = [good(10), good(20), good(20), good(30)];
    expectMessage(() => validateTrace(list), /^Trace frame 2: "t" is 20, which is not later than 20 in frame 1\./);
  });

  it('a timestamp below the one before is not increasing', () => {
    const list = [good(10), good(20), good(30), good(25)];
    expectMessage(() => validateTrace(list), /^Trace frame 3: "t" is 25, which is not later than 30 in frame 2\./);
  });

  it('a timestamp one step later than the one before is accepted, also a negative one', () => {
    expect(() => validateTrace([good(-5), good(-4.5), good(0)])).not.toThrow();
  });

  it('a field problem in a frame is named before the order of its timestamp', () => {
    const list = [good(10), good(5)];
    delete (list[1] as Record<string, unknown>)['aspect'];
    expectMessage(() => validateTrace(list), /^Trace frame 1: "aspect"/);
  });

  it('createTraceSource throws the same message', () => {
    const list = [good(10), good(10)];
    let fromValidate = '';
    let fromSource = '';
    try {
      validateTrace(list);
    } catch (e) {
      fromValidate = (e as Error).message;
    }
    try {
      createTraceSource(list as unknown as Trace);
    } catch (e) {
      fromSource = (e as Error).message;
    }
    expect(fromValidate).not.toBe('');
    expect(fromSource).toBe(fromValidate);
  });
});

describe('the barrel of marrow/input', () => {
  it('exports the trace source and its validator', () => {
    expect(inputBarrel.createTraceSource).toBe(createTraceSource);
    expect(inputBarrel.validateTrace).toBe(validateTrace);
  });
});
