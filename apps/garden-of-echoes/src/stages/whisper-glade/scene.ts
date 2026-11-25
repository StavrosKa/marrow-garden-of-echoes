// The Whisper Glade scene data (garden-level design 2.8, 2.9; requirements 5.6, 8.1, 22.2 to 22.4). The spirits and the
// path options are the targets of the Scene Manager, each at its placed point. A spirit's sprite follows its shape (a blue
// drop, a gold leaf), so the colour and the shape of the sprite agree (Req 5.6). The stage's logic does not read the sprite.
import type { SceneTarget } from 'world-view/pixi';
import type { GardenState, WhisperShape } from '../../session/stageDriver';
import { spriteSlot, type SpriteName } from '../../scene/spriteSlot';

/** The sprite of a whisper target. The blue drop is spirit-blue, the gold leaf spirit-gold; the path options use the lantern sprites. */
export function spriteOfShape(shape: WhisperShape): SpriteName {
  switch (shape) {
    case 'drop':
      return 'spirit-blue';
    case 'leaf':
      return 'spirit-gold';
    case 'fireflies':
      return 'lantern-lit';
    case 'candles':
      return 'lantern-unlit';
  }
}

/** The colour of a sprite slot's placeholder. */
function colourOf(name: SpriteName): number {
  return spriteSlot(name).drawable[0]?.colour ?? 0;
}

/**
 * The Whisper Glade targets for the Scene Manager: each target that the placement holds, with the hit radius of the round.
 * The Scene Manager draws only the targets that are shown, so the list holds every placed target.
 */
export function whisperSceneTargets(state: GardenState): SceneTarget[] {
  const stage = state.stage;
  const placed = state.placed;
  if (stage === null || stage.kind !== 'whisper' || placed === null) return [];
  return stage.targets.flatMap((target) =>
    placed.points.includes(target.point)
      ? [{ id: target.id, point: target.point, r: placed.snapshot.radius, colour: colourOf(spriteOfShape(target.shape)) }]
      : [],
  );
}

/** A key of the Whisper Glade targets that changes when the placement changes, so the scene is updated only then. */
export function whisperSceneKey(state: GardenState): string {
  return `whisper:${state.rounds}:${state.placed?.snapshot.radius ?? 0}`;
}
