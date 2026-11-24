// Placement with the resting band (Requirement 10.3, 10.5; design section 2.4). A slot in
// the resting band is one whose hit circle reaches the bottom of the camera frame, where
// the hands rest. Such a slot is used only when the other slots cannot give n targets at
// once. The band itself is placeTargets with one extra rule; placeTargets is not changed.
//
// The band's upper edge is a camera y. The bandY value comes from ATTENTION_TUNING
// (restingBandY), passed in by the caller, so this file holds no literal for it.
import { placeTargets, type Mapping, type PlacementResult, type Tuning, type Vec2 } from '../core';

/** The comfort grids of placeTargets. Derived, because marrow/core does not export WristGrids. */
type WristGrids = Parameters<typeof placeTargets>[1];

/** What the band rule is asked to place (the arguments of placeTargets, without grids or mapping). */
export interface BandInput {
  readonly slots: readonly Vec2[];
  readonly n: number;
  readonly r: number;
  readonly m: number;
}

/** The placement, and how many of the slots it uses are in the resting band (Req 10.5). */
export interface BandPlacement {
  readonly result: PlacementResult;
  readonly bandSlotsUsed: number;
}

/**
 * Whether any part of the hit circle of radius r around the slot lies in the resting band
 * (Req 10.3): its lowest point, mapped to camera space, is at camera y bandY or more. The
 * mapping is monotone in y, so that point has the largest camera y on the circle.
 */
export function inRestingBand(slot: Vec2, r: number, mapping: Mapping, bandY: number): boolean {
  return mapping.toCamera({ x: slot.x, y: slot.y + r }).y >= bandY;
}

/** The camera y of the top point of the hit circle, the smallest on the circle. The band's upper edge is compared with it. */
function topCameraY(slot: Vec2, r: number, mapping: Mapping): number {
  return mapping.toCamera({ x: slot.x, y: slot.y - r }).y;
}

/** The slots a result uses: the chosen ones, or the usable list for a sequential result. */
function usedSlots(result: PlacementResult): readonly Vec2[] {
  return result.kind === 'none' ? [] : result.slots;
}

/**
 * The placement of a demand, with the resting band (Req 10.3, 10.5). Out-of-band slots are
 * tried first, in the caller's order.
 *  1. If they give `simultaneous`, that result is used and no band slot is used.
 *  2. Otherwise band slots are added one at a time, in the order of their top point's camera y
 *     (nearest the upper edge first, ties by caller index). The first count of band slots that
 *     gives `simultaneous` is used. A band slot is used only to reach n targets at once.
 *  3. If no count gives `simultaneous` and the out-of-band slots alone are `sequential`, they
 *     are used with no band slot, because a sequential result is already completable.
 *  4. If the out-of-band slots give `none`, the smallest count of band slots that gives a usable
 *     slot is used. If no slot is usable, the result is `none`.
 * The input slots array is not changed. The result keeps the caller's slot objects.
 */
export function planPlacement(
  input: BandInput,
  grids: WristGrids,
  mapping: Mapping,
  tuning: Tuning,
  bandY: number,
): BandPlacement {
  const { slots, n, r, m } = input;
  const outOfBand: Vec2[] = [];
  const band: { readonly slot: Vec2; readonly top: number; readonly index: number }[] = [];
  slots.forEach((slot, index) => {
    if (inRestingBand(slot, r, mapping, bandY)) {
      band.push({ slot, top: topCameraY(slot, r, mapping), index });
    } else {
      outOfBand.push(slot);
    }
  });
  band.sort((a, b) => a.top - b.top || a.index - b.index);
  const bandSorted = band.map((entry) => entry.slot);
  const bandSet = new Set<Vec2>(bandSorted);
  const countBand = (result: PlacementResult): number =>
    usedSlots(result).reduce((count, slot) => (bandSet.has(slot) ? count + 1 : count), 0);

  const out = placeTargets({ slots: outOfBand, n, r, m }, grids, mapping, tuning);
  if (out.kind === 'simultaneous') return { result: out, bandSlotsUsed: 0 };

  // The first prefix of the band that gives a usable slot, used when the out-of-band slots
  // give none. Only read after the loop finds no simultaneous count.
  let firstUsable: PlacementResult | null = null;
  for (let k = 1; k <= bandSorted.length; k++) {
    const result = placeTargets(
      { slots: [...outOfBand, ...bandSorted.slice(0, k)], n, r, m },
      grids,
      mapping,
      tuning,
    );
    if (result.kind === 'simultaneous') return { result, bandSlotsUsed: countBand(result) };
    if (firstUsable === null && result.kind !== 'none') firstUsable = result;
  }
  if (out.kind === 'sequential') return { result: out, bandSlotsUsed: 0 };
  if (firstUsable !== null) return { result: firstUsable, bandSlotsUsed: countBand(firstUsable) };
  return { result: { kind: 'none' }, bandSlotsUsed: 0 };
}
