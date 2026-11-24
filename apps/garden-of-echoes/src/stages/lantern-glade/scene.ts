// The Lantern Glade scene data (garden-level design 2.8, 4.1, 4.2; requirements 4.1, 4.2, 22.2 to 22.4). The lanterns
// are the targets of the Scene Manager: each one sits at its placed point, and its colour comes from its sprite slot,
// unlit or lit. The stage's logic does not change when the sprites change (Req 22.4).
import type { SceneTarget } from 'world-view/pixi';
import type { GardenState } from '../../session/stageDriver';
import { spriteSlot, type SpriteName } from '../../scene/spriteSlot';
import { targetIdOf } from './rules';

/** The colour of a lantern's placeholder, from its sprite slot. */
function colourOf(name: SpriteName): number {
  return spriteSlot(name).drawable[0]?.colour ?? 0;
}

/**
 * The lantern targets for the Scene Manager, in lantern order. A lantern is lit once its index is below the active one.
 * Before placement, or after the stage has left Lantern Glade, there are none.
 */
export function lanternSceneTargets(state: GardenState): SceneTarget[] {
  const placed = state.placed;
  const stage = state.stage;
  if (placed === null || stage === null || stage.kind !== 'lantern') return [];
  return placed.points.map((point, index) => ({
    id: targetIdOf(index),
    point,
    r: placed.snapshot.radius,
    colour: colourOf(index < stage.rule.next ? 'lantern-lit' : 'lantern-unlit'),
  }));
}

/** A key of the lantern targets that changes when a lantern is lit or the placement changes, so the scene is updated only then. */
export function lanternSceneKey(state: GardenState): string {
  const stage = state.stage;
  const lit = stage !== null && stage.kind === 'lantern' ? stage.rule.next : -1;
  return `${state.placed?.points.length ?? 0}:${lit}:${state.placed?.snapshot.radius ?? 0}`;
}
