// The hit circle of a target and the position it is drawn at (Req 10.4-10.6, design 9.1 item 2).
// No test here loads PixiJS: the display objects are fakes.
import fc from 'fast-check';
import type { Vec2 } from 'marrow/core';
import { describe, expect, it } from 'vitest';
import { createGlide, stepGlide } from '../core/glide';
import { createLock, stepLock } from '../core/lock';
import { motionProfile } from '../core/motion';
import { depthScale, worldToScreen } from '../core/projection';
import {
  genCulledView,
  genFrame,
  genLayerRef,
  genLockSequence,
  genMotionLevels,
  genTargets,
  genView,
  type TargetsCase,
} from '../core/testgen';
import type { ProjectionFrame, View } from '../core/types';
import { FakeDisplay } from './fakes';
import { applyTargets } from './targets';
import type { HitCircle } from './types';

/** The displays of the targets of a case, one fake display per target. */
function displaysFor(targetsCase: TargetsCase): Map<string, FakeDisplay> {
  return new Map(targetsCase.targets.map((target) => [target.id, new FakeDisplay()]));
}

/** Checks one frame of the case: display positions and visibility, and the circles. */
function expectFrame(
  targetsCase: TargetsCase,
  displays: ReadonlyMap<string, FakeDisplay>,
  circles: readonly HitCircle[],
  view: View,
  frame: ProjectionFrame,
): void {
  for (const target of targetsCase.targets) {
    const display = displays.get(target.id);
    if (display === undefined) throw new Error(`no display for ${target.id}`);
    const expected = worldToScreen(target.point, view, frame);
    const circle = circles.find((c) => c.id === target.id);
    const shouldHaveCircle = targetsCase.active.has(target.id) && !targetsCase.travelling;

    if (expected === null) {
      // Culled: hidden, and no circle whatever the flags.
      expect(display.visible).toBe(false);
      expect(circle).toBeUndefined();
      continue;
    }
    // The drawn position is the one projection gives, to the bit.
    expect(Object.is(display.x, expected.x)).toBe(true);
    expect(Object.is(display.y, expected.y)).toBe(true);
    const scale = depthScale(target.point, view.travel);
    expect(Object.is(display.scale, scale)).toBe(true);
    expect(display.visible).toBe(targetsCase.shown.has(target.id));

    if (shouldHaveCircle) {
      expect(circle).toBeDefined();
      if (circle === undefined) continue;
      // The circle centre is the rendered position, to the bit.
      expect(Object.is(circle.centre.x, display.x)).toBe(true);
      expect(Object.is(circle.centre.y, display.y)).toBe(true);
      expect(Object.is(circle.radius, target.r * scale)).toBe(true);
    } else {
      expect(circle).toBeUndefined();
    }
  }
  // Every circle belongs to a target of the case.
  for (const circle of circles) {
    expect(targetsCase.targets.some((target) => target.id === circle.id)).toBe(true);
  }
}

describe('targets', () => {
  it('hit circle equals rendered target position', () => {
    fc.assert(
      fc.property(
        genTargets(),
        genLayerRef().chain((layer) => fc.oneof(genView(layer), genCulledView(layer))),
        genFrame(),
        genMotionLevels(),
        genLockSequence(),
        (targetsCase, view, frame, levels, lockFrames) => {
          const displays = displaysFor(targetsCase);
          let glide = createGlide();
          let lock = createLock();
          lockFrames.forEach((step, i) => {
            // The head that drives the lock comes from the real glide, for the level of this frame.
            const level = levels[i % levels.length];
            if (level === undefined) throw new Error('no motion level');
            const multiplier = motionProfile(level).headMultiplier;
            const target: Vec2 = { x: step.liveHead.x * multiplier, y: step.liveHead.y * multiplier };
            glide = stepGlide(glide, target, step.dtMs);
            const locked = stepLock(lock, { liveHead: glide.out, lockRequested: step.lockRequested }, step.dtMs);
            lock = locked.state;
            const interactionView: View = { travel: view.travel, head: locked.interactionHead };
            const circles = applyTargets(
              targetsCase.targets,
              targetsCase.shown,
              targetsCase.active,
              targetsCase.travelling,
              interactionView,
              frame,
              displays,
            );
            expectFrame(targetsCase, displays, circles, interactionView, frame);
          });
        },
      ),
    );
  });
});
