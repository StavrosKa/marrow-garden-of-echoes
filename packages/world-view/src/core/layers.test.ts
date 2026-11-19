import { describe, expect, it } from 'vitest';
import { resolveLayerTable, validateLayerTable, type LayerTableEntry } from './layers';
import { TUNING } from './tuning';

// The rows of Appendix B, the TABLE layer table: depth, factor, backdrop flag. Anchor 0 for all.
// The interaction layer ("main") carries no factor: its factor is tuning.interactionFactor.
const TABLE: LayerTableEntry[] = [
  { id: 'layer-0', depth: 4000, anchor: 0, backdrop: true, factor: 0.0, fill: { colour: 'fill' } },
  { id: 'layer-1', depth: 600, anchor: 0, backdrop: true, factor: 0.03, fill: { colour: 'fill' } },
  { id: 'layer-2', depth: 120, anchor: 0, backdrop: false, factor: 0.1 },
  { id: 'layer-3', depth: 24, anchor: 0, backdrop: false, interaction: true },
  { id: 'layer-4', depth: 18, anchor: 0, backdrop: false, factor: 0.6 },
  { id: 'layer-5', depth: 14, anchor: 0, backdrop: false, factor: 1.0 },
];
const [SKY, HILLS, TREES, MAIN, FOG, FRONT] = TABLE as [
  LayerTableEntry, LayerTableEntry, LayerTableEntry, LayerTableEntry, LayerTableEntry, LayerTableEntry,
];
// Boundaries of the rules, derived from tuning.
const ONE = TUNING.nearPlane / TUNING.nearPlane;
const ZERO = TUNING.nearPlane - TUNING.nearPlane;

/** The table with the layer at `index` replaced by its change. */
function change(index: number, update: Partial<LayerTableEntry>): LayerTableEntry[] {
  return TABLE.map((entry, i) => (i === index ? { ...entry, ...update } : entry));
}

function paths(entries: readonly LayerTableEntry[], tuning = TUNING): string[] {
  return validateLayerTable(entries, tuning).map((issue) => issue.path);
}

describe('layer table rules', () => {
  it('layer table rules: the TABLE table of Appendix B passes', () => {
    expect(validateLayerTable(TABLE)).toEqual([]);
  });

  it('layer table rules: resolveLayerTable gives the interaction layer interactionFactor', () => {
    const layers = resolveLayerTable(TABLE);
    expect(layers.map((layer) => layer.factor)).toEqual([
      SKY.factor,
      HILLS.factor,
      TREES.factor,
      TUNING.interactionFactor,
      FOG.factor,
      FRONT.factor,
    ]);
    expect(layers.map((layer) => layer.interaction)).toEqual([false, false, false, true, false, false]);
    expect(layers.map((layer) => layer.backdrop)).toEqual([true, true, false, false, false, false]);
  });

  it('layer table rules: the count must be in layersMin..layersMax', () => {
    const tooFew = TABLE.slice(ZERO, TUNING.layersMin - ONE);
    const tooMany = [...TABLE, { ...FRONT, id: `layer-${TABLE.length}`, depth: FRONT.depth - ONE }];
    for (const entries of [tooFew, tooMany]) {
      const issue = validateLayerTable(entries).find((candidate) => candidate.path === 'layers');
      expect(issue?.message).toContain(`layersMin..layersMax = ${TUNING.layersMin}..${TUNING.layersMax}`);
      expect(issue?.value).toBe(entries.length);
    }
    // layersMax (the TABLE table) and layersMin (the TABLE table without the far trees) are accepted.
    expect(TABLE).toHaveLength(TUNING.layersMax);
    const smallest = TABLE.filter((entry) => entry !== TREES).map((entry, i) => ({ ...entry, id: `layer-${i}` }));
    expect(smallest).toHaveLength(TUNING.layersMin);
    expect(validateLayerTable(smallest)).toEqual([]);
  });

  it('layer table rules: ids are layer-0.. in order', () => {
    const issues = validateLayerTable(change(2, { id: 'layer-7' }));
    expect(issues).toHaveLength(ONE);
    expect(issues[0]?.path).toBe('layers[2].id');
    expect(issues[0]?.message).toContain('must be "layer-2"');
  });

  it('layer table rules: depth must decrease along the table (farthest first)', () => {
    const issues = validateLayerTable(change(4, { depth: MAIN.depth }));
    const issue = issues.find((candidate) => candidate.path === 'layers[4].depth');
    expect(issue?.message).toBe(
      `layers[4].depth = ${MAIN.depth} is not below layers[3].depth = ${MAIN.depth} (layers must be listed from the farthest to the nearest)`,
    );
  });

  it('layer table rules: the factor must not increase with depth', () => {
    // The fog layer with a factor below the interaction layer's, which comes before it in the table.
    const issues = validateLayerTable(change(4, { factor: TUNING.interactionFactor - TUNING.limitY }));
    const issue = issues.find((candidate) => candidate.path === 'layers[4].factor');
    expect(issue?.message).toContain('is below layers[3].factor');
    expect(issue?.message).toContain('must not increase with depth');
    // Equal factors are allowed (non-increasing as depth increases).
    expect(validateLayerTable(change(4, { factor: FRONT.factor }))).toEqual([]);
  });

  it('layer table rules: a factor must be in 0..1', () => {
    const above = validateLayerTable(change(5, { factor: ONE + TUNING.limitX }));
    expect(above.find((issue) => issue.path === 'layers[5].factor')?.message).toBe(
      `layers[5].factor = ${ONE + TUNING.limitX} is out of range [${ZERO}, ${ONE}]`,
    );
    const below = validateLayerTable(change(0, { factor: -TUNING.limitX }));
    expect(below.find((issue) => issue.path === 'layers[0].factor')?.message).toBe(
      `layers[0].factor = ${-TUNING.limitX} is out of range [${ZERO}, ${ONE}]`,
    );
  });

  it('layer table rules: depth - anchor must be above nearPlane', () => {
    const atPlane = change(2, { anchor: TREES.depth - TUNING.nearPlane });
    expect(paths(atPlane)).toEqual(['layers[2].depth']);
    expect(validateLayerTable(atPlane)[0]?.message).toContain(`must be above nearPlane = ${TUNING.nearPlane}`);
    const beyond = change(2, { anchor: TREES.depth });
    expect(paths(beyond)).toEqual(['layers[2].depth']);
    // Just inside is accepted.
    expect(validateLayerTable(change(2, { anchor: TREES.depth - TUNING.nearPlane - TUNING.limitY }))).toEqual([]);
  });

  it('layer table rules: the interaction layer has no factor', () => {
    const issues = validateLayerTable(change(3, { factor: TUNING.interactionFactor }));
    expect(issues.map((issue) => issue.path)).toContain('layers[3].factor');
    expect(issues.find((issue) => issue.path === 'layers[3].factor')?.message).toBe(
      'layers[3].factor must be absent on the interaction layer (it is tuning.interactionFactor)',
    );
  });

  it('layer table rules: every other layer has a factor', () => {
    const withoutFactor: LayerTableEntry = { id: FOG.id, depth: FOG.depth, anchor: FOG.anchor, backdrop: FOG.backdrop };
    const issues = validateLayerTable(TABLE.map((entry, i) => (i === 4 ? withoutFactor : entry)));
    expect(issues.map((issue) => issue.path)).toEqual(['layers[4].factor']);
  });

  it('layer table rules: exactly one interaction layer', () => {
    const none = validateLayerTable(change(3, { interaction: false, factor: TUNING.interactionFactor }));
    expect(none.find((issue) => issue.path === 'layers')?.message).toBe(
      'layers needs exactly one interaction layer; it has 0',
    );
    const two = validateLayerTable(change(4, { interaction: true, factor: undefined }));
    expect(two.find((issue) => issue.path === 'layers')?.message).toBe(
      'layers needs exactly one interaction layer; it has 2',
    );
  });

  it('layer table rules: the interaction factor must be below the largest factor of the other layers', () => {
    const largest = Math.max(SKY.factor!, HILLS.factor!, TREES.factor!, FOG.factor!, FRONT.factor!);
    const tuning = { ...TUNING, interactionFactor: largest };
    const issue = validateLayerTable(TABLE, tuning).find((candidate) => candidate.path === 'layers');
    expect(issue?.message).toBe(
      `interactionFactor = ${largest} must be below the largest factor of the other layers = ${largest}`,
    );
    // Just below the largest is accepted by this rule (the order rule needs the table to agree).
    const nearlyLargest = { ...TUNING, interactionFactor: largest - TUNING.limitY };
    expect(validateLayerTable(TABLE, nearlyLargest).find((candidate) => candidate.path === 'layers')).toBeUndefined();
  });

  it('layer table rules: a backdrop layer has a fill', () => {
    const withoutFill: LayerTableEntry = { id: SKY.id, depth: SKY.depth, anchor: SKY.anchor, backdrop: SKY.backdrop, factor: SKY.factor };
    const issues = validateLayerTable(TABLE.map((entry, i) => (i === 0 ? withoutFill : entry)));
    expect(issues.map((issue) => issue.path)).toEqual(['layers[0].fill']);
    // A layer that is not a backdrop needs none.
    expect(validateLayerTable(TABLE)).toEqual([]);
  });

  it('layer table rules: depth and anchor must be finite numbers', () => {
    expect(paths(change(1, { depth: NaN }))).toContain('layers[1].depth');
    expect(paths(change(1, { anchor: Infinity }))).toContain('layers[1].anchor');
  });

  it('layer table rules: every failing rule is reported, in table order, not just the first', () => {
    const broken = TABLE.map((entry, i) => {
      if (i === 2) return { ...entry, id: 'layer-9', anchor: TREES.depth };
      if (i === 5) return { ...entry, factor: -TUNING.limitX };
      return entry;
    });
    const issues = validateLayerTable(broken);
    // The negative factor breaks two rules of the same layer: the range and the order.
    expect(issues.map((issue) => issue.path)).toEqual([
      'layers[2].id',
      'layers[2].depth',
      'layers[5].factor',
      'layers[5].factor',
    ]);
  });
});
