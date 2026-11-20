// The targets of one frame (Req 10.4-10.6; design 7.3 step 6). Each target gets one targetScreen
// call. Its display position, its depth scale and its hit circle all come from that one result, so
// the circle centre and the drawn position are the same numbers.
import { targetScreen } from '../core/target';
import { TUNING, type Tuning } from '../core/tuning';
import type { ProjectionFrame, View } from '../core/types';
import type { DisplayLike } from './ports';
import type { HitCircle, SceneTarget } from './types';

/**
 * Writes the position, depth scale and visibility of every target to its display object, and
 * returns the hit circles. A display is hidden when its target is culled or not shown. A circle is
 * returned only for an active, not culled target, and none is returned while `travelling` is true.
 * `out` must hold a display for every target.
 */
export function applyTargets(
  targets: readonly SceneTarget[],
  shown: ReadonlySet<string>,
  active: ReadonlySet<string>,
  travelling: boolean,
  interactionView: View,
  frame: ProjectionFrame,
  out: ReadonlyMap<string, DisplayLike>,
  tuning: Tuning = TUNING,
): HitCircle[] {
  const circles: HitCircle[] = [];
  for (const target of targets) {
    const display = out.get(target.id);
    if (display === undefined) throw new Error(`applyTargets: no display for target "${target.id}"`);
    const placed = targetScreen(target.point, target.r, interactionView, frame, tuning);
    if (placed === null) {
      display.visible = false;
      continue;
    }
    display.position.set(placed.position.x, placed.position.y);
    display.setDepthScale(placed.scale);
    display.visible = shown.has(target.id);
    if (active.has(target.id) && !travelling) {
      circles.push({
        id: target.id,
        centre: { x: placed.position.x, y: placed.position.y },
        radius: placed.radius,
      });
    }
  }
  return circles;
}
