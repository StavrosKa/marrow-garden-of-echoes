// Sprite slots (requirements 22.1 to 22.4). The placeholders are plain shapes in the grey ramp and lanternWarm, and the
// stage logic never reads the slot source, so a PNG replaces only the slot.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { colourNumber, GREY_TOKENS, theme } from '../ui/theme';
import { SPRITE_NAMES, spriteSlot } from './spriteSlot';

const appSrc = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The colours the placeholders may use: the grey ramp and lanternWarm (art-and-motion.md, before the final art). */
const ALLOWED_COLOURS: ReadonlySet<number> = new Set([...GREY_TOKENS, 'lanternWarm'].map((token) => colourNumber(token as keyof typeof theme)));

describe('sprite slots', () => {
  it('22.3: the slot names are the file names of art-and-motion.md for this spec', () => {
    expect([...SPRITE_NAMES]).toEqual([
      'lantern-unlit',
      'lantern-lit',
      'spirit-blue',
      'spirit-gold',
      'hall-door-frame',
      'hall-door-leaf',
      'forest-sky',
      'forest-hills',
      'forest-fartrees-a',
      'glade1-ground',
      'glade1-trunk-left',
      'glade1-trunk-right',
    ]);
  });

  it('22.2 22.3: every name gives a slot with a drawable, so no stage gets an empty slot', () => {
    for (const name of SPRITE_NAMES) {
      const slot = spriteSlot(name);
      expect(slot.name).toBe(name);
      expect(slot.drawable.length).toBeGreaterThan(0);
    }
  });

  it('22.2: each placeholder is a plain shape in unit coordinates, across the whole sprite box', () => {
    for (const name of SPRITE_NAMES) {
      for (const shape of spriteSlot(name).drawable) {
        expect(['rect', 'ellipse', 'roundRect']).toContain(shape.kind);
        expect(shape.bounds).toEqual({ x0: 0, y0: 0, x1: 1, y1: 1 });
      }
    }
  });

  it('22.2: the placeholder colours are the grey ramp and lanternWarm only', () => {
    for (const name of SPRITE_NAMES) {
      for (const shape of spriteSlot(name).drawable) {
        expect(ALLOWED_COLOURS.has(shape.colour), name).toBe(true);
      }
    }
  });

  it('22.4 4.2: a lit lantern and an unlit lantern have different colours, so lighting one is visible', () => {
    const lit = spriteSlot('lantern-lit').drawable[0]?.colour;
    const unlit = spriteSlot('lantern-unlit').drawable[0]?.colour;
    expect(lit).toBe(colourNumber('lanternWarm'));
    expect(unlit).not.toBe(lit);
  });

  it('22.4: the stage logic and the session driver do not read the sprite slots, so a PNG changes only the slot', () => {
    for (const file of ['stages/lantern-glade/rules.ts', 'session/stageDriver.ts']) {
      const text = readFileSync(path.join(appSrc, ...file.split('/')), 'utf8');
      expect(text, file).not.toMatch(/spriteSlot|scene\/spriteSlot/);
    }
  });
});
