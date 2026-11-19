// The layer table (Req 1.4, 2.10; design 5.2, 5.3): the rules of a table of layers and the
// resolved layers that the projection reads. No rule names a layer: layers are found by their
// place in the table, never by id or name.
import type { ValidationIssue } from './issues';
import { TUNING, type Tuning } from './tuning';
import type { LayerRef } from './types';

const ZERO = 0;
const ONE = 1;

/** One row of a layer table as the content states it. */
export interface LayerTableEntry {
  /** `layer-0`, `layer-1`, ... in table order. */
  readonly id: string;
  readonly depth: number;
  readonly anchor: number;
  /** A backdrop layer is drawn as a rectangle that covers the viewport (Req 4.1). */
  readonly backdrop: boolean;
  /** The layer that carries the targets. Exactly one layer has it, and it has no `factor`. */
  readonly interaction?: boolean;
  /** Parallax factor, 0..1. Absent on the interaction layer, whose factor is `interactionFactor`. */
  readonly factor?: number;
  /** What a backdrop layer is filled with. Only its presence is checked here. */
  readonly fill?: unknown;
}

/** A layer with its factor resolved, ready for the projection. */
export interface LayerDef extends LayerRef {
  readonly id: string;
  readonly backdrop: boolean;
  readonly interaction: boolean;
}

/**
 * The layers of a table that passed `validateLayerTable`. The interaction layer gets
 * `interactionFactor`; any other layer gets its own factor (NaN if it has none, so a table
 * that was not validated fails loudly).
 */
export function resolveLayerTable(
  entries: readonly LayerTableEntry[],
  tuning: Tuning = TUNING,
): LayerDef[] {
  return entries.map((entry) => ({
    id: entry.id,
    depth: entry.depth,
    anchor: entry.anchor,
    backdrop: entry.backdrop,
    interaction: entry.interaction === true,
    factor: entry.interaction === true ? tuning.interactionFactor : (entry.factor ?? NaN),
  }));
}

/** The factor a layer is drawn with: `interactionFactor` for the interaction layer, else its own. */
function resolvedFactor(entry: LayerTableEntry, tuning: Tuning): number | undefined {
  return entry.interaction === true ? tuning.interactionFactor : entry.factor;
}

/**
 * Every rule of a layer table, as issues with the path `layers[i]...` (Req 1.4, 2.10):
 * count in `layersMin..layersMax`; ids `layer-0..` in order; depth strictly decreasing along
 * the table (farthest first); every factor in 0..1 and not decreasing along the table (so it
 * does not increase with depth); exactly one interaction layer, without a factor;
 * `interactionFactor` below the largest factor of the other layers; `depth - anchor >
 * nearPlane`; every backdrop layer has a fill.
 */
export function validateLayerTable(
  entries: readonly LayerTableEntry[],
  tuning: Tuning = TUNING,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (path: string, value: unknown, message: string): void => {
    issues.push({ path, value, message });
  };
  if (!(entries.length >= tuning.layersMin && entries.length <= tuning.layersMax)) {
    add(
      'layers',
      entries.length,
      `layers has ${entries.length} entries; it needs layersMin..layersMax = ${tuning.layersMin}..${tuning.layersMax}`,
    );
  }
  let interactionCount = ZERO;
  // The last layer that carried a usable factor, for the order check.
  let previous: { index: number; factor: number } | undefined;
  entries.forEach((entry, i) => {
    const at = `layers[${i}]`;
    const expectedId = `layer-${i}`;
    if (entry.id !== expectedId) {
      add(`${at}.id`, entry.id, `${at}.id = ${JSON.stringify(entry.id)} must be "${expectedId}" (ids follow the table order)`);
    }
    const before = i > ZERO ? entries[i - ONE] : undefined;
    if (before !== undefined && !(entry.depth < before.depth)) {
      add(
        `${at}.depth`,
        entry.depth,
        `${at}.depth = ${entry.depth} is not below layers[${i - ONE}].depth = ${before.depth} (layers must be listed from the farthest to the nearest)`,
      );
    }
    if (!Number.isFinite(entry.depth)) add(`${at}.depth`, entry.depth, `${at}.depth = ${entry.depth} must be a finite number`);
    if (!Number.isFinite(entry.anchor)) add(`${at}.anchor`, entry.anchor, `${at}.anchor = ${entry.anchor} must be a finite number`);
    if (Number.isFinite(entry.depth) && Number.isFinite(entry.anchor) && !(entry.depth - entry.anchor > tuning.nearPlane)) {
      add(
        `${at}.depth`,
        entry.depth,
        `${at}.depth - anchor = ${entry.depth - entry.anchor} must be above nearPlane = ${tuning.nearPlane}`,
      );
    }
    if (entry.interaction === true) {
      interactionCount += ONE;
      if (entry.factor !== undefined) {
        add(`${at}.factor`, entry.factor, `${at}.factor must be absent on the interaction layer (it is tuning.interactionFactor)`);
      }
    } else if (entry.factor === undefined) {
      add(`${at}.factor`, entry.factor, `${at}.factor is required on every layer except the interaction layer`);
    } else if (!(entry.factor >= ZERO && entry.factor <= ONE)) {
      add(`${at}.factor`, entry.factor, `${at}.factor = ${entry.factor} is out of range [${ZERO}, ${ONE}]`);
    }
    const factor = resolvedFactor(entry, tuning);
    if (factor !== undefined && Number.isFinite(factor)) {
      if (previous !== undefined && factor < previous.factor) {
        add(
          `${at}.factor`,
          factor,
          `${at}.factor = ${factor} is below layers[${previous.index}].factor = ${previous.factor} (the factor must not increase with depth)`,
        );
      }
      previous = { index: i, factor };
    }
    if (entry.backdrop && entry.fill === undefined) {
      add(`${at}.fill`, entry.fill, `${at}.fill is required on a backdrop layer`);
    }
  });
  if (interactionCount !== ONE) {
    add('layers', interactionCount, `layers needs exactly one interaction layer; it has ${interactionCount}`);
  }
  const others = entries
    .filter((entry) => entry.interaction !== true && entry.factor !== undefined && Number.isFinite(entry.factor))
    .map((entry) => entry.factor as number);
  if (others.length > ZERO) {
    const largest = Math.max(...others);
    if (!(tuning.interactionFactor < largest)) {
      add(
        'layers',
        tuning.interactionFactor,
        `interactionFactor = ${tuning.interactionFactor} must be below the largest factor of the other layers = ${largest}`,
      );
    }
  }
  return issues;
}
