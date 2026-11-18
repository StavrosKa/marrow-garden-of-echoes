// The traces in tests/traces (Req 7.6) are hand-written and synthetic. Every file
// there must pass validateTrace, and the short one is played through the Trace Source.
// This test lives in tests/ because it reads files, which the packages' own tests
// (no Node types there) do not.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTraceSource, validateTrace } from 'marrow/input';
import { describe, expect, it } from 'vitest';

const tracesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'traces');
const shortTraceName = 'short-wave.json';

function load(name: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(tracesDir, name), 'utf8'));
}

describe('the hand-written traces', () => {
  const names = fs.readdirSync(tracesDir).filter((name) => name.endsWith('.json'));

  it('the folder holds the short trace', () => {
    expect(names).toContain(shortTraceName);
  });

  it('every trace file passes validateTrace', () => {
    for (const name of names) {
      expect(() => validateTrace(load(name)), name).not.toThrow();
    }
  });

  it('the short trace has a few frames', () => {
    const trace = validateTrace(load(shortTraceName));
    expect(trace.length).toBeGreaterThanOrEqual(2);
    expect(trace.length).toBeLessThanOrEqual(10);
  });

  it('the short trace plays frame by frame when advanced to each timestamp', () => {
    const trace = validateTrace(load(shortTraceName));
    const source = createTraceSource(trace);
    const first = trace[0];
    if (first === undefined) throw new Error('the short trace is empty');
    source.advanceTo(first.t - 1);
    expect(source.latest()).toBeNull();
    for (const frame of trace) {
      source.advanceTo(frame.t);
      expect(source.latest()).toBe(frame);
      expect(source.ended()).toBe(false);
    }
    const last = trace[trace.length - 1];
    if (last === undefined) throw new Error('the short trace is empty');
    source.advanceTo(last.t + 1);
    expect(source.latest()).toBe(last);
    expect(source.ended()).toBe(true);
  });
});
