// The drawing plan of the play area (Req 26.5 to 26.9, 26.6 for the hit area). The radius comes from TUNING; the
// geometry checks compare the shapes with it, so no number is written here except fractions and angles.
import { describe, expect, it } from 'vitest';
import { TUNING, type PointerInput, type Vec2 } from 'marrow/core';
import { easeOutCubic, ORB_RADIUS, planPlayArea, RING_STROKE, TARGET_STROKE, type TargetInput } from './playAreaPlan';
import { COMPLETE_EASE_MS } from './playgroundRounds';

const HIT = TUNING.hitRadius;
const CENTRE: Vec2 = { x: 0.8, y: 0.4 };

function target(overrides: Partial<TargetInput> = {}): TargetInput {
  return {
    id: 't1',
    centre: CENTRE,
    shown: true,
    completed: false,
    completedAtMs: null,
    owner: null,
    progress: 0,
    ...overrides,
  };
}

function planOne(targetInput: TargetInput, nowMs = 0, pointers: readonly PointerInput[] = []) {
  const plan = planPlayArea({ hitRadius: HIT, nowMs, easeMs: COMPLETE_EASE_MS, targets: [targetInput], pointers });
  const paint = plan.targets[0];
  if (paint === undefined) throw new Error('no target painted');
  return paint;
}

describe('the progress ring (Req 26.8)', () => {
  it('shows a ring only on a target with an owner and progress above 0', () => {
    expect(planOne(target({ owner: null, progress: 0 })).ring.visible).toBe(false);
    expect(planOne(target({ owner: 'right', progress: 0 })).ring.visible).toBe(false);
    expect(planOne(target({ owner: null, progress: 0.4 })).ring.visible).toBe(false);
    expect(planOne(target({ owner: 'right', progress: 0.4 })).ring.visible).toBe(true);
  });

  it('fills the ring by the progress fraction of its circumference', () => {
    const paint = planOne(target({ owner: 'left', progress: 0.25 }));
    const [filled, whole] = paint.ring.dash.split(' ').map(Number);
    expect(filled).toBeCloseTo(0.25 * (whole ?? NaN), 9);
    expect(whole).toBeCloseTo(2 * Math.PI * paint.ring.radius, 9);
  });
});

describe('the shapes stay inside the hit area (Req 26.6)', () => {
  it('puts the outer edge of the ring on the hit radius, including its stroke', () => {
    const paint = planOne(target({ owner: 'right', progress: 0.5 }));
    expect(paint.ring.strokeWidth).toBe(RING_STROKE);
    expect(paint.ring.radius + paint.ring.strokeWidth / 2).toBeCloseTo(HIT, 12);
    expect(paint.ring.radius - paint.ring.strokeWidth / 2).toBeGreaterThan(0);
  });

  it('draws the open target as a circle whose outer edge, stroke included, is the hit radius', () => {
    const paint = planOne(target());
    expect(paint.circle.visible).toBe(true);
    expect(paint.circle.strokeWidth).toBe(TARGET_STROKE);
    expect(paint.circle.radius + paint.circle.strokeWidth / 2).toBeCloseTo(HIT, 12);
    expect(paint.cx).toBe(CENTRE.x);
    expect(paint.cy).toBe(CENTRE.y);
  });

  it('draws the completed diamond with its corners at the stroke-inset radius, so the outer edge is the hit radius', () => {
    const paint = planOne(target({ completed: true, completedAtMs: 0 }), 0);
    const numbers = paint.diamond.path.match(/-?\d+(\.\d+)?(e-?\d+)?/g)?.map(Number) ?? [];
    expect(numbers).toHaveLength(8);
    for (let i = 0; i < numbers.length; i += 2) {
      const dx = (numbers[i] ?? NaN) - CENTRE.x;
      const dy = (numbers[i + 1] ?? NaN) - CENTRE.y;
      // Round joins add half the stroke beyond each corner, so the corner plus half the stroke is the hit radius.
      expect(Math.hypot(dx, dy) + paint.diamond.strokeWidth / 2).toBeCloseTo(HIT, 9);
    }
  });

  it('keeps every target shape inside the hit radius for any hit radius in its range', () => {
    for (const radius of [TUNING.hitRadiusMin, TUNING.hitRadius, TUNING.hitRadiusMax]) {
      const plan = planPlayArea({
        hitRadius: radius,
        nowMs: 1000,
        easeMs: COMPLETE_EASE_MS,
        targets: [target({ shown: true }), target({ id: 't2', completed: true, completedAtMs: 0 })],
        pointers: [],
      });
      for (const paint of plan.targets) {
        expect(paint.circle.radius + paint.circle.strokeWidth / 2).toBeLessThanOrEqual(radius + 1e-12);
        expect(paint.diamond.strokeWidth).toBe(TARGET_STROKE);
      }
    }
  });
});

describe('the completed shape', () => {
  it('replaces the circle with the diamond, eased from 0 at the selection to 1 at COMPLETE_EASE_MS', () => {
    const done = target({ completed: true, completedAtMs: 1000 });
    const at = (nowMs: number) => planOne(done, nowMs);
    expect(at(1000).circle.visible).toBe(false);
    expect(at(1000).diamond.visible).toBe(true);
    expect(at(1000).diamond.opacity).toBe(0);
    expect(at(1000 + COMPLETE_EASE_MS).diamond.opacity).toBe(1);
    expect(at(1000 + COMPLETE_EASE_MS / 2).diamond.opacity).toBeGreaterThan(0);
    expect(at(1000 + COMPLETE_EASE_MS / 2).diamond.opacity).toBeLessThan(1);
  });

  it('takes at least uiMinLightEaseMs to finish (Req 26.9)', () => {
    expect(COMPLETE_EASE_MS).toBeGreaterThanOrEqual(TUNING.uiMinLightEaseMs);
  });

  it('keeps the ring off a completed target', () => {
    expect(planOne(target({ completed: true, completedAtMs: 0, owner: 'right', progress: 0.5 })).ring.visible).toBe(false);
  });

  it('clamps the ease at both ends', () => {
    expect(easeOutCubic(-1)).toBe(0);
    expect(easeOutCubic(2)).toBe(1);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
  });
});

describe('a target that is not drawn', () => {
  it('draws neither the circle nor the diamond when it is not shown (sequential rounds)', () => {
    const paint = planOne(target({ shown: false }));
    expect(paint.circle.visible).toBe(false);
    expect(paint.diamond.visible).toBe(false);
  });
});

describe('the orbs (Req 26.7)', () => {
  it('draws a valid wrist at its screen position and hides an invalid one', () => {
    const plan = planPlayArea({
      hitRadius: HIT,
      nowMs: 0,
      easeMs: COMPLETE_EASE_MS,
      targets: [],
      pointers: [
        { wrist: 'right', valid: true, pos: { x: 0.3, y: 0.6 } },
        { wrist: 'left', valid: false },
      ],
    });
    expect(plan.orbs).toEqual([
      { wrist: 'right', visible: true, cx: 0.3, cy: 0.6, radius: ORB_RADIUS },
      { wrist: 'left', visible: false, cx: 0, cy: 0, radius: ORB_RADIUS },
    ]);
  });
});
