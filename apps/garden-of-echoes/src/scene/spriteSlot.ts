// Sprite slots (garden-level design 2.9; requirements 22.1 to 22.4). A stage asks for a sprite by its file name, and the
// slot says what to draw. Today each slot is a placeholder made of plain shapes in code, in the grey ramp and the
// lantern colour only (art-and-motion.md). When the owner's PNG arrives, only this file's source changes, and no stage
// logic changes. The shapes use unit coordinates: 0 to 1 across the sprite's own box.
import type { ShapeSpec } from 'world-view/pixi';
import { colourNumber, type ThemeToken } from '../ui/theme';

/** The file names of art-and-motion.md for the sprites of this spec. A slot is requested by one of these names. */
export const SPRITE_NAMES = [
  'lantern-unlit',
  'lantern-lit',
  'spirit-blue',
  'spirit-gold',
  'hall-door-frame',
  'hall-door-leaf',
] as const;

export type SpriteName = (typeof SPRITE_NAMES)[number];

export interface SpriteSlot {
  readonly name: SpriteName;
  /** The placeholder shapes, in unit coordinates. */
  readonly drawable: readonly ShapeSpec[];
}

/** The colour of each placeholder. Only the grey ramp and lanternWarm are used before the final art pass. */
const COLOUR: Readonly<Record<SpriteName, ThemeToken>> = {
  'lantern-unlit': 'grey6',
  'lantern-lit': 'lanternWarm',
  'spirit-blue': 'grey6',
  'spirit-gold': 'lanternWarm',
  'hall-door-frame': 'grey3',
  'hall-door-leaf': 'grey2',
};

/** The shape of each placeholder: a lantern is a rounded body, and a door is a plain frame. */
const KIND: Readonly<Record<SpriteName, ShapeSpec['kind']>> = {
  'lantern-unlit': 'roundRect',
  'lantern-lit': 'roundRect',
  'spirit-blue': 'ellipse',
  'spirit-gold': 'ellipse',
  'hall-door-frame': 'rect',
  'hall-door-leaf': 'rect',
};

/**
 * The drawable of a sprite slot. Every name in SPRITE_NAMES has one, so a stage never gets an empty slot. The
 * name is a stable key, and the source behind it can change without a change to the caller (Req 22.4).
 */
export function spriteSlot(name: SpriteName): SpriteSlot {
  const shape: ShapeSpec = {
    kind: KIND[name],
    bounds: { x0: 0, y0: 0, x1: 1, y1: 1 },
    colour: colourNumber(COLOUR[name]),
  };
  return { name, drawable: [shape] };
}
