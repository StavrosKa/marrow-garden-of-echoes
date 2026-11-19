import fc from 'fast-check';
import type { Vec2 } from 'marrow/core';
import { describe, expect, it } from 'vitest';
import { smootherstep } from './ease';
import { createLock, stepLock, type LockState } from './lock';
import { parallaxShift } from './parallax';
import { resolveLayerTable } from './layers';
import { genFramePositive, genHead, genLayerTable, genLockSequence } from './testgen';
import { TUNING } from './tuning';

// The moved-head threshold of property 4: a live head that moved by more than this changed (Req 6.9).
const MOVED = 1e-9;
// Named test values: a quarter of the ease, and three heads for the examples.
const HALF = 0.5;
const QUARTER = HALF * HALF;
const ZERO = 0;
const HEAD_A: Vec2 = { x: HALF, y: ZERO };
const HEAD_B: Vec2 = { x: -HALF, y: HALF };
const HEAD_C: Vec2 = { x: ZERO, y: -HALF };

function same(a: Vec2, b: Vec2): boolean {
  return Object.is(a.x, b.x) && Object.is(a.y, b.y);
}

/** The state after one frame of the lock, starting from `state`. */
function step(state: LockState, liveHead: Vec2, lockRequested: boolean, dtMs: number) {
  return stepLock(state, { liveHead, lockRequested }, dtMs);
}

/** The lock state after a dwell has been holding HEAD_A: locked, held = HEAD_A. */
function lockedAtA(): LockState {
  const first = step(createLock(), HEAD_A, false, ZERO);
  return step(first.state, HEAD_B, true, ZERO).state;
}

describe('lock holds interaction layer, decorative layers move', () => {
  it('lock holds interaction layer, decorative layers move', () => {
    const case_ = fc.tuple(genLayerTable(), genFramePositive(), genLockSequence());
    fc.assert(
      fc.property(case_, ([table, frame, sequence]) => {
        const layers = resolveLayerTable(table);
        const decorative = layers.filter((layer) => !layer.interaction && layer.factor > ZERO);
        // The table has a decorative layer with a factor above 0, so the last assertion is not vacuous.
        expect(decorative.length).toBeGreaterThan(ZERO);

        let state = createLock();
        let previous: { interactionHead: Vec2; liveHead: Vec2; requested: boolean } | undefined;
        let held: Vec2 | undefined;
        for (const frame_ of sequence) {
          const result = stepLock(state, { liveHead: frame_.liveHead, lockRequested: frame_.lockRequested }, frame_.dtMs);
          // Req 6.3: the decorative head is the live head in every frame.
          expect(same(result.decorativeHead, frame_.liveHead)).toBe(true);
          if (frame_.lockRequested) {
            if (previous?.requested !== true) {
              // The first locked frame of a run holds the previous frame's interaction head (Req 6.2).
              if (previous !== undefined) expect(same(result.interactionHead, previous.interactionHead)).toBe(true);
              held = result.interactionHead;
            }
            // Req 6.2: while locked, the interaction head is the held value, exactly.
            expect(same(result.interactionHead, held!)).toBe(true);
            // Req 6.9: the interaction-layer offset does not change.
            const shift = parallaxShift(TUNING.interactionFactor, result.interactionHead, frame);
            const heldShift = parallaxShift(TUNING.interactionFactor, held!, frame);
            expect(Object.is(shift.x, heldShift.x) && Object.is(shift.y, heldShift.y)).toBe(true);
          }
          // Req 6.9: in a frame where the live head moved, a decorative layer with a factor above 0 shifts differently.
          if (previous !== undefined) {
            const moved = Math.max(Math.abs(frame_.liveHead.x - previous.liveHead.x), Math.abs(frame_.liveHead.y - previous.liveHead.y));
            if (moved > MOVED) {
              const changed = decorative.some((layer) => {
                const before = parallaxShift(layer.factor, previous!.liveHead, frame);
                const after = parallaxShift(layer.factor, frame_.liveHead, frame);
                return before.x !== after.x || before.y !== after.y;
              });
              expect(changed).toBe(true);
            }
          }
          previous = { interactionHead: result.interactionHead, liveHead: frame_.liveHead, requested: frame_.lockRequested };
          state = result.state;
        }
      }),
    );
  });

  it('lock holds interaction layer, decorative layers move: row 1, free and lockRequested gives locked with held = last', () => {
    const free = step(createLock(), HEAD_A, false, ZERO).state;
    const result = step(free, HEAD_B, true, ZERO);
    expect(result.state.mode).toBe('locked');
    expect(same(result.state.held, HEAD_A)).toBe(true);
    expect(same(result.interactionHead, HEAD_A)).toBe(true);
    expect(same(result.decorativeHead, HEAD_B)).toBe(true);
  });

  it('lock holds interaction layer, decorative layers move: row 2, free and not requested gives liveHead', () => {
    const result = step(createLock(), HEAD_A, false, ZERO);
    expect(result.state.mode).toBe('free');
    expect(Object.is(result.interactionHead, HEAD_A)).toBe(true);
    expect(same(result.decorativeHead, HEAD_A)).toBe(true);
  });

  it('lock holds interaction layer, decorative layers move: row 3, locked and lockRequested holds the held value exactly', () => {
    const result = step(lockedAtA(), HEAD_C, true, TUNING.lockEaseMs);
    expect(result.state.mode).toBe('locked');
    expect(same(result.interactionHead, HEAD_A)).toBe(true);
    expect(same(result.decorativeHead, HEAD_C)).toBe(true);
  });

  it('lock holds interaction layer, decorative layers move: row 4, locked and not requested starts an ease from held', () => {
    const dt = TUNING.lockEaseMs * QUARTER;
    const result = step(lockedAtA(), HEAD_C, false, dt);
    expect(result.state.mode).toBe('easing');
    expect(result.state.easeElapsedMs).toBe(dt);
    const w = smootherstep(dt / TUNING.lockEaseMs);
    expect(result.interactionHead.x).toBeCloseTo(HEAD_A.x + (HEAD_C.x - HEAD_A.x) * w, 12);
    expect(result.interactionHead.y).toBeCloseTo(HEAD_A.y + (HEAD_C.y - HEAD_A.y) * w, 12);
  });

  it('lock holds interaction layer, decorative layers move: row 5, easing and lockRequested gives locked with held = last', () => {
    const eased = step(lockedAtA(), HEAD_C, false, TUNING.lockEaseMs * QUARTER);
    const result = step(eased.state, HEAD_B, true, ZERO);
    expect(result.state.mode).toBe('locked');
    expect(Object.is(result.interactionHead, eased.interactionHead)).toBe(true);
    expect(same(result.state.held, eased.interactionHead)).toBe(true);
  });

  it('lock holds interaction layer, decorative layers move: row 6, easing and not requested before lockEaseMs stays easing', () => {
    const dt = TUNING.lockEaseMs * QUARTER;
    const eased = step(lockedAtA(), HEAD_C, false, dt);
    const result = step(eased.state, HEAD_C, false, dt);
    expect(result.state.mode).toBe('easing');
    expect(result.state.easeElapsedMs).toBe(dt + dt);
    const w = smootherstep((dt + dt) / TUNING.lockEaseMs);
    expect(result.interactionHead.x).toBeCloseTo(HEAD_A.x + (HEAD_C.x - HEAD_A.x) * w, 12);
  });

  it('lock holds interaction layer, decorative layers move: row 7, easing and not requested past lockEaseMs gives liveHead', () => {
    const eased = step(lockedAtA(), HEAD_C, false, TUNING.lockEaseMs * QUARTER);
    const result = step(eased.state, HEAD_B, false, TUNING.lockEaseMs);
    expect(result.state.mode).toBe('free');
    expect(Object.is(result.interactionHead, HEAD_B)).toBe(true);
  });

  it('lock holds interaction layer, decorative layers move: ease reaches liveHead exactly after lockEaseMs (6.4)', () => {
    const dt = TUNING.lockEaseMs * QUARTER;
    let state = lockedAtA();
    const values: Vec2[] = [];
    for (let i = 0; i < 4; i++) {
      const result = step(state, HEAD_C, false, dt);
      values.push(result.interactionHead);
      state = result.state;
    }
    // Three steps are short of lockEaseMs: the head is between held and liveHead.
    expect(same(values[2]!, HEAD_C)).toBe(false);
    // The fourth step completes the ease: the value is liveHead itself, and it stays there.
    expect(Object.is(values[3]!.x, HEAD_C.x) && Object.is(values[3]!.y, HEAD_C.y)).toBe(true);
    expect(state.mode).toBe('free');
    const after = step(state, HEAD_B, false, dt);
    expect(Object.is(after.interactionHead, HEAD_B)).toBe(true);
  });

  it('lock holds interaction layer, decorative layers move: re-lock during an ease has no jump (6.5)', () => {
    const eased = step(lockedAtA(), HEAD_C, false, TUNING.lockEaseMs * QUARTER);
    const relocked = step(eased.state, HEAD_B, true, TUNING.lockEaseMs * QUARTER);
    expect(Object.is(relocked.interactionHead, eased.interactionHead)).toBe(true);
    // Held stays at the value of the ease while the hold lasts.
    const later = step(relocked.state, HEAD_C, true, TUNING.lockEaseMs);
    expect(Object.is(later.interactionHead, eased.interactionHead)).toBe(true);
  });

  it('lock holds interaction layer, decorative layers move: no lock gives liveHead (6.6)', () => {
    const heads = [HEAD_A, HEAD_B, HEAD_C, HEAD_A];
    let state = createLock();
    for (const head of heads) {
      const result = step(state, head, false, TUNING.lockEaseMs * QUARTER);
      expect(Object.is(result.interactionHead, head)).toBe(true);
      state = result.state;
    }
  });

  it('lock holds interaction layer, decorative layers move: a delta of 0 does not advance the ease', () => {
    const eased = step(lockedAtA(), HEAD_C, false, TUNING.lockEaseMs * QUARTER);
    const paused = step(eased.state, HEAD_C, false, ZERO);
    expect(paused.state.mode).toBe('easing');
    expect(paused.state.easeElapsedMs).toBe(eased.state.easeElapsedMs);
    expect(Object.is(paused.interactionHead.x, eased.interactionHead.x)).toBe(true);
    expect(Object.is(paused.interactionHead.y, eased.interactionHead.y)).toBe(true);
  });

  it('lock holds interaction layer, decorative layers move: head samples from genHead stay in the square', () => {
    fc.assert(
      fc.property(genHead(), (head) => {
        const result = step(createLock(), head, false, ZERO);
        expect(Math.abs(result.interactionHead.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(result.interactionHead.y)).toBeLessThanOrEqual(1);
      }),
    );
  });
});
