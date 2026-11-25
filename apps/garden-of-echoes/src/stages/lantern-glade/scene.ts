// The Lantern Glade scene data (garden-level design 2.8, 4.1, 4.2; requirements 4.1, 4.2, 22.2 to 22.4). The lanterns
// are the targets of the Scene Manager: each one sits at its placed point, and its colour comes from its sprite slot,
// unlit or lit. The stage's logic does not change when the sprites change (Req 22.4).
import type { SceneTarget } from 'world-view/pixi';
import type { GardenState } from '../../session/stageDriver';
import type { MotionLevel } from 'marrow/core';
import { flickerFactor } from '../../scene/flicker';
import { spriteSlot, type SpriteName } from '../../scene/spriteSlot';
import { lightLevel, targetIdOf, type LanternState } from './rules';

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

/** A lit lantern's target id and the colour its light is drawn in this frame (0xRRGGBB). */
export interface LitColour {
  readonly id: string;
  readonly colour: number;
}

/** The three channels of a 0xRRGGBB colour, unclipped (the value the flicker bound is measured on). */
export function unclippedLight(lightColour: number, level: number, flicker: number): readonly [number, number, number] {
  const factor = level * flicker;
  return [((lightColour >> 16) & 0xff) * factor, ((lightColour >> 8) & 0xff) * factor, (lightColour & 0xff) * factor];
}

/** A colour from three unclipped channels: each is rounded and clamped to 0..255 (Req 17.2). */
export function clampedColour(channels: readonly [number, number, number]): number {
  const [r, g, b] = channels.map((value) => Math.min(0xff, Math.max(0, Math.round(value))));
  return ((r ?? 0) << 16) | ((g ?? 0) << 8) | (b ?? 0);
}

/**
 * The colour of each lit lantern in this frame: the light colour times the light level times the flicker, clamped per
 * channel (Req 17.2, 17.3). The light level is the ease of the most recently lit lantern, and it is 1 for every other
 * lit lantern. The flicker is one factor for the whole glade, from the session time, so Pause freezes it. Unlit lanterns
 * are not listed, so they keep their steady colour (Req 17.2).
 */
export function lanternColoursOf(state: LanternState, sessionMs: number, motion: MotionLevel, lightColour: number): LitColour[] {
  const flicker = flickerFactor(motion, sessionMs);
  const newest = state.next - 1;
  const lit: LitColour[] = [];
  for (let index = 0; index < state.next && index < state.points.length; index++) {
    const level = index === newest ? lightLevel(state) : 1;
    lit.push({ id: targetIdOf(index), colour: clampedColour(unclippedLight(lightColour, level, flicker)) });
  }
  return lit;
}

/** A key of the lantern targets that changes when a lantern is lit or the placement changes, so the scene is updated only then. */
export function lanternSceneKey(state: GardenState): string {
  const stage = state.stage;
  const lit = stage !== null && stage.kind === 'lantern' ? stage.rule.next : -1;
  return `${state.placed?.points.length ?? 0}:${lit}:${state.placed?.snapshot.radius ?? 0}`;
}
