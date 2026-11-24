// Test helper, not a test file: the placed round of a lantern content file. Each slot becomes an interaction-layer
// point with the factor of the interaction layer, as placeRound gives them for a whole-frame reach. Rule tests use it
// so that the rule runs on the same points the driver gives it.
import { createHelp, TUNING } from 'marrow/core';
import { TUNING as WORLD_TUNING, type WorldPoint } from 'world-view';
import { snapshotRound } from '../../session/roundSnapshot';
import type { PlacedRound } from '../shared/placeRound';
import { LANTERN_COUNT, type LanternGladeContent } from './content';

export function placedFor(content: LanternGladeContent): PlacedRound {
  const points: WorldPoint[] = content.slots.slice(0, LANTERN_COUNT).map((slot) => ({
    x: slot.x,
    y: slot.y,
    depth: slot.depth,
    anchor: slot.anchor,
    factor: WORLD_TUNING.interactionFactor,
  }));
  return { kind: 'simultaneous', points, snapshot: snapshotRound(createHelp(TUNING), TUNING), bandSlotsUsed: 0 };
}
