// The slice content: its types, the hand-written validator of design 5.3 and the front-layer
// clearance of design 8.5 (Req 1.5, 2.8, 4.3, 11.4, 11.9). The issue lines are developer text (design
// 11 item 15), so they stay in this file and not in copy/. The validator never throws. It runs the
// rules that need a valid structure only when the structure has no issue.
import {
  TUNING,
  checkDepthScaling,
  edgeOverscan,
  resolveLayerTable,
  shapeOverscanIssues,
  validateLayerTable,
  validateSegment,
  worldToScreen,
  type LayerDef,
  type LayerTableEntry,
  type ProjectionFrame,
  type Rect,
  type SegmentSpec,
  type Tuning,
  type ValidationIssue,
  type View,
} from 'world-view';
import { TUNING as MARROW_TUNING } from 'marrow/core';
import { SHAPE_TOKENS, type ThemeToken } from '../../ui/theme';
import { ASPECT_MIN, DEFAULT_ASPECT } from './constants';
import forestSliceJson from './forestSlice.json';

export interface ContentFill {
  readonly colour: ThemeToken;
}

export type ContentShape =
  | {
      readonly kind: 'rect';
      readonly u0: number;
      readonly v0: number;
      readonly u1: number;
      readonly v1: number;
      readonly radius?: number;
      readonly colour: ThemeToken;
    }
  | {
      readonly kind: 'ellipse';
      readonly cu: number;
      readonly cv: number;
      readonly ru: number;
      readonly rv: number;
      readonly colour: ThemeToken;
    };

export interface ContentLayer {
  readonly id: string;
  readonly name: string;
  readonly depth: number;
  readonly anchor: number;
  readonly backdrop: boolean;
  readonly interaction?: boolean;
  readonly factor?: number;
  readonly fill?: ContentFill;
  readonly shapes: readonly ContentShape[];
  readonly accentShapes: readonly ContentShape[];
}

export interface ContentSegment {
  readonly id: string;
  readonly kind: 'journey' | 'door';
  readonly from: number;
  readonly to: number;
  readonly durationMs: number;
}

export interface ContentSlot {
  readonly u: number;
  readonly v: number;
}

export interface ContentStop {
  readonly id: string;
  /** A travel value, or "segmentEnd": the `to` of the segment the run uses. */
  readonly travel: number | 'segmentEnd';
  readonly depth: number;
  readonly targets: number;
  readonly slots: readonly ContentSlot[];
}

export interface WorldContent {
  readonly version: 1;
  readonly sceneScale: number;
  readonly layers: readonly ContentLayer[];
  readonly segments: readonly ContentSegment[];
  readonly stops: readonly ContentStop[];
}

export type ContentResult =
  | { readonly ok: true; readonly content: WorldContent }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

type Obj = Record<string, unknown>;

interface Ctx {
  readonly issues: ValidationIssue[];
}

const ZERO = 0;
const ONE = 1;
const SUPPORTED_VERSION = 1;
const SEGMENT_KINDS = ['journey', 'door'] as const;
const STOP_COUNT = 2;

/** The contents of forestSlice.json, as the playground loads them. */
export const FOREST_JSON: unknown = forestSliceJson;

function join(path: string, key: string): string {
  return path === '' ? key : `${path}.${key}`;
}

function report(ctx: Ctx, path: string, value: unknown, message: string): void {
  ctx.issues.push({ path, value, message });
}

function isObject(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkKeys(ctx: Ctx, obj: Obj, path: string, allowed: readonly string[], required: readonly string[]): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) report(ctx, join(path, key), obj[key], `${join(path, key)} is not a known key`);
  }
  for (const key of required) {
    if (!(key in obj)) report(ctx, join(path, key), undefined, `${join(path, key)} is missing`);
  }
}

function readNumber(ctx: Ctx, obj: Obj, path: string, key: string): number | undefined {
  const value = obj[key];
  if (value === undefined) return undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  report(ctx, join(path, key), value, `${join(path, key)} = ${JSON.stringify(value)} must be a finite number`);
  return undefined;
}

function readString(ctx: Ctx, obj: Obj, path: string, key: string): string | undefined {
  const value = obj[key];
  if (value === undefined) return undefined;
  if (typeof value === 'string') return value;
  report(ctx, join(path, key), value, `${join(path, key)} = ${JSON.stringify(value)} must be a string`);
  return undefined;
}

function readBoolean(ctx: Ctx, obj: Obj, path: string, key: string): boolean | undefined {
  const value = obj[key];
  if (value === undefined) return undefined;
  if (typeof value === 'boolean') return value;
  report(ctx, join(path, key), value, `${join(path, key)} = ${JSON.stringify(value)} must be true or false`);
  return undefined;
}

function isShapeToken(value: unknown): value is ThemeToken {
  return typeof value === 'string' && (SHAPE_TOKENS as readonly string[]).includes(value);
}

function readToken(ctx: Ctx, obj: Obj, path: string, key: string): ThemeToken | undefined {
  const value = obj[key];
  if (value === undefined) return undefined;
  if (isShapeToken(value)) return value;
  report(
    ctx,
    join(path, key),
    value,
    `${join(path, key)} = ${JSON.stringify(value)} is not a token of the theme (${SHAPE_TOKENS.join(', ')})`,
  );
  return undefined;
}

function readShape(ctx: Ctx, value: unknown, path: string): ContentShape | undefined {
  if (!isObject(value)) {
    report(ctx, path, value, `${path} must be an object`);
    return undefined;
  }
  if (value['kind'] === 'rect') {
    checkKeys(ctx, value, path, ['kind', 'u0', 'v0', 'u1', 'v1', 'radius', 'colour'], ['kind', 'u0', 'v0', 'u1', 'v1', 'colour']);
    const u0 = readNumber(ctx, value, path, 'u0');
    const v0 = readNumber(ctx, value, path, 'v0');
    const u1 = readNumber(ctx, value, path, 'u1');
    const v1 = readNumber(ctx, value, path, 'v1');
    const radius = readNumber(ctx, value, path, 'radius');
    const colour = readToken(ctx, value, path, 'colour');
    if (u0 === undefined || v0 === undefined || u1 === undefined || v1 === undefined || colour === undefined) return undefined;
    if (!(u0 < u1 && v0 < v1)) {
      report(ctx, path, value, `${path} must have u0 < u1 and v0 < v1`);
      return undefined;
    }
    return { kind: 'rect', u0, v0, u1, v1, radius, colour };
  }
  if (value['kind'] === 'ellipse') {
    checkKeys(ctx, value, path, ['kind', 'cu', 'cv', 'ru', 'rv', 'colour'], ['kind', 'cu', 'cv', 'ru', 'rv', 'colour']);
    const cu = readNumber(ctx, value, path, 'cu');
    const cv = readNumber(ctx, value, path, 'cv');
    const ru = readNumber(ctx, value, path, 'ru');
    const rv = readNumber(ctx, value, path, 'rv');
    const colour = readToken(ctx, value, path, 'colour');
    if (cu === undefined || cv === undefined || ru === undefined || rv === undefined || colour === undefined) return undefined;
    if (!(ru > ZERO && rv > ZERO)) {
      report(ctx, path, value, `${path} must have ru > 0 and rv > 0`);
      return undefined;
    }
    return { kind: 'ellipse', cu, cv, ru, rv, colour };
  }
  report(ctx, join(path, 'kind'), value['kind'], `${join(path, 'kind')} must be "rect" or "ellipse"`);
  return undefined;
}

function readShapes(ctx: Ctx, value: unknown, path: string): ContentShape[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    report(ctx, path, value, `${path} must be an array`);
    return [];
  }
  const shapes: ContentShape[] = [];
  value.forEach((item: unknown, k: number) => {
    const shape = readShape(ctx, item, `${path}[${k}]`);
    if (shape !== undefined) shapes.push(shape);
  });
  return shapes;
}

function readLayer(ctx: Ctx, value: unknown, index: number): ContentLayer | undefined {
  const path = `layers[${index}]`;
  if (!isObject(value)) {
    report(ctx, path, value, `${path} must be an object`);
    return undefined;
  }
  checkKeys(
    ctx,
    value,
    path,
    ['id', 'name', 'depth', 'anchor', 'backdrop', 'interaction', 'factor', 'fill', 'shapes', 'accentShapes'],
    ['id', 'name', 'depth', 'anchor', 'backdrop'],
  );
  const id = readString(ctx, value, path, 'id');
  const name = readString(ctx, value, path, 'name');
  const depth = readNumber(ctx, value, path, 'depth');
  const anchor = readNumber(ctx, value, path, 'anchor');
  const backdrop = readBoolean(ctx, value, path, 'backdrop');
  const interaction = readBoolean(ctx, value, path, 'interaction');
  const factor = readNumber(ctx, value, path, 'factor');
  let fill: ContentFill | undefined;
  if (value['fill'] !== undefined) {
    const fillValue = value['fill'];
    if (!isObject(fillValue)) {
      report(ctx, join(path, 'fill'), fillValue, `${join(path, 'fill')} must be an object`);
    } else {
      checkKeys(ctx, fillValue, join(path, 'fill'), ['colour'], ['colour']);
      const colour = readToken(ctx, fillValue, join(path, 'fill'), 'colour');
      if (colour !== undefined) fill = { colour };
    }
  }
  const shapes = readShapes(ctx, value['shapes'], join(path, 'shapes'));
  const accentShapes = readShapes(ctx, value['accentShapes'], join(path, 'accentShapes'));
  if (id === undefined || name === undefined || depth === undefined || anchor === undefined || backdrop === undefined) {
    return undefined;
  }
  return { id, name, depth, anchor, backdrop, interaction, factor, fill, shapes, accentShapes };
}

function readSegment(ctx: Ctx, value: unknown, index: number): ContentSegment | undefined {
  const path = `segments[${index}]`;
  if (!isObject(value)) {
    report(ctx, path, value, `${path} must be an object`);
    return undefined;
  }
  checkKeys(ctx, value, path, ['id', 'kind', 'from', 'to', 'durationMs'], ['id', 'kind', 'from', 'to', 'durationMs']);
  const id = readString(ctx, value, path, 'id');
  const kind = readString(ctx, value, path, 'kind');
  const from = readNumber(ctx, value, path, 'from');
  const to = readNumber(ctx, value, path, 'to');
  const durationMs = readNumber(ctx, value, path, 'durationMs');
  if (kind !== undefined && !(SEGMENT_KINDS as readonly string[]).includes(kind)) {
    report(ctx, join(path, 'kind'), kind, `${join(path, 'kind')} = "${kind}" must be "journey" or "door"`);
  }
  if (id === undefined || kind === undefined || from === undefined || to === undefined || durationMs === undefined) return undefined;
  if (kind !== 'journey' && kind !== 'door') return undefined;
  return { id, kind, from, to, durationMs };
}

function readStop(ctx: Ctx, value: unknown, index: number): ContentStop | undefined {
  const path = `stops[${index}]`;
  if (!isObject(value)) {
    report(ctx, path, value, `${path} must be an object`);
    return undefined;
  }
  checkKeys(ctx, value, path, ['id', 'travel', 'depth', 'targets', 'slots'], ['id', 'travel', 'depth', 'targets', 'slots']);
  const id = readString(ctx, value, path, 'id');
  const depth = readNumber(ctx, value, path, 'depth');
  const targets = readNumber(ctx, value, path, 'targets');
  let travel: number | 'segmentEnd' | undefined;
  if (value['travel'] === 'segmentEnd') {
    travel = 'segmentEnd';
  } else if (typeof value['travel'] === 'number' && Number.isFinite(value['travel'])) {
    travel = value['travel'];
  } else if (value['travel'] !== undefined) {
    report(ctx, join(path, 'travel'), value['travel'], `${join(path, 'travel')} must be a finite number or "segmentEnd"`);
  }
  if (targets !== undefined && !(Number.isInteger(targets) && targets >= ONE)) {
    report(ctx, join(path, 'targets'), targets, `${join(path, 'targets')} = ${targets} must be a whole number of at least 1`);
  }
  const slots: ContentSlot[] = [];
  const slotsValue = value['slots'];
  if (slotsValue !== undefined) {
    if (!Array.isArray(slotsValue)) {
      report(ctx, join(path, 'slots'), slotsValue, `${join(path, 'slots')} must be an array`);
    } else {
      slotsValue.forEach((item: unknown, j: number) => {
        const slotPath = `${join(path, 'slots')}[${j}]`;
        if (!isObject(item)) {
          report(ctx, slotPath, item, `${slotPath} must be an object with u and v`);
          return;
        }
        checkKeys(ctx, item, slotPath, ['u', 'v'], ['u', 'v']);
        const u = readNumber(ctx, item, slotPath, 'u');
        const v = readNumber(ctx, item, slotPath, 'v');
        if (u !== undefined && v !== undefined) slots.push({ u, v });
      });
    }
  }
  if (id === undefined || travel === undefined || depth === undefined || targets === undefined) return undefined;
  return { id, travel, depth, targets, slots };
}

function readContent(ctx: Ctx, json: unknown): WorldContent | undefined {
  if (!isObject(json)) {
    report(ctx, '', json, 'the content must be a JSON object');
    return undefined;
  }
  checkKeys(ctx, json, '', ['$schema', 'version', 'sceneScale', 'layers', 'segments', 'stops'], ['version', 'sceneScale', 'layers', 'segments', 'stops']);
  if (json['version'] !== undefined && json['version'] !== SUPPORTED_VERSION) {
    report(ctx, 'version', json['version'], `version = ${JSON.stringify(json['version'])} must be ${SUPPORTED_VERSION}`);
  }
  const sceneScale = readNumber(ctx, json, '', 'sceneScale');
  if (sceneScale !== undefined && !(sceneScale >= ZERO && sceneScale <= ONE)) {
    report(ctx, 'sceneScale', sceneScale, `sceneScale = ${sceneScale} is out of range [${ZERO}, ${ONE}]`);
  }
  const layers: ContentLayer[] = [];
  const segments: ContentSegment[] = [];
  const stops: ContentStop[] = [];
  for (const [key, read, list] of [
    ['layers', readLayer, layers],
    ['segments', readSegment, segments],
    ['stops', readStop, stops],
  ] as const) {
    const items = json[key];
    if (items === undefined) continue;
    if (!Array.isArray(items)) {
      report(ctx, key, items, `${key} must be an array`);
      continue;
    }
    items.forEach((item: unknown, i: number) => {
      const parsed = (read as (c: Ctx, v: unknown, n: number) => unknown)(ctx, item, i);
      if (parsed !== undefined) (list as unknown[]).push(parsed);
    });
  }
  const version = json['version'];
  if (version !== SUPPORTED_VERSION || sceneScale === undefined) return undefined;
  return { version: SUPPORTED_VERSION, sceneScale, layers, segments, stops };
}

/** The travel of a stop for one segment: its own value, or the segment's `to` for "segmentEnd". */
export function stopTravel(stop: ContentStop, segment: ContentSegment): number {
  return stop.travel === 'segmentEnd' ? segment.to : stop.travel;
}

function layerEntries(content: WorldContent): LayerTableEntry[] {
  return content.layers.map((layer) => ({
    id: layer.id,
    depth: layer.depth,
    anchor: layer.anchor,
    backdrop: layer.backdrop,
    interaction: layer.interaction,
    factor: layer.factor,
    fill: layer.fill,
  }));
}

/** The layers of a content with their factors resolved (the interaction layer gets interactionFactor). */
export function layerDefsOf(content: WorldContent, tuning: Tuning = TUNING): LayerDef[] {
  return resolveLayerTable(layerEntries(content), tuning);
}

function boundsOf(shape: ContentShape): Rect {
  if (shape.kind === 'rect') return { x0: shape.u0, y0: shape.v0, x1: shape.u1, y1: shape.v1 };
  return { x0: shape.cu - shape.ru, y0: shape.cv - shape.rv, x1: shape.cu + shape.ru, y1: shape.cv + shape.rv };
}

/**
 * The screen box of one shape of a layer at a view, or null when the layer is culled there. The
 * shape's unit x coordinates are fractions of the width, so they are multiplied by the aspect.
 */
function imageBox(shape: ContentShape, layer: LayerDef, view: View, aspect: number, frame: ProjectionFrame, tuning: Tuning): Rect | null {
  const bounds = boundsOf(shape);
  const corners = [
    [bounds.x0, bounds.y0],
    [bounds.x1, bounds.y0],
    [bounds.x0, bounds.y1],
    [bounds.x1, bounds.y1],
  ];
  let box: Rect | null = null;
  for (const [u, v] of corners) {
    if (u === undefined || v === undefined) return null;
    const screen = worldToScreen(
      { depth: layer.depth, anchor: layer.anchor, factor: layer.factor, x: u * aspect, y: v },
      view,
      frame,
      tuning,
    );
    if (screen === null) return null;
    box =
      box === null
        ? { x0: screen.x, y0: screen.y, x1: screen.x, y1: screen.y }
        : {
            x0: Math.min(box.x0, screen.x),
            y0: Math.min(box.y0, screen.y),
            x1: Math.max(box.x1, screen.x),
            y1: Math.max(box.y1, screen.y),
          };
  }
  return box;
}

/**
 * Design 8.5 (Req 11.4): no shape of a front layer (a non-backdrop layer nearer than the interaction
 * layer) may come within `hitRadiusMax` of a candidate slot at the rest view of any stop and segment.
 * The swept box of a shape grows by the overscan of the front layer plus that of the interaction
 * layer on each axis. The interaction head and the decorative head can differ while a lock holds
 * (design 4.2), so their shifts add up. That is wider than the difference that design 8.5 gives for
 * one shared head.
 */
export function frontClearanceIssues(
  content: WorldContent,
  aspect: number,
  sceneScale: number,
  tuning: Tuning = TUNING,
): ValidationIssue[] {
  const defs = layerDefsOf({ ...content, sceneScale }, tuning);
  const interactionIndex = content.layers.findIndex((layer) => layer.interaction === true);
  const interaction = defs[interactionIndex];
  if (interaction === undefined) return [];
  const frame: ProjectionFrame = { aspect, sceneScale };
  const radius = MARROW_TUNING.hitRadiusMax;
  const issues: ValidationIssue[] = [];
  content.layers.forEach((layer, i) => {
    const def = defs[i];
    if (layer.backdrop || i === interactionIndex || def === undefined || !(def.depth < interaction.depth)) return;
    const growth = edgeOverscan(def, frame, tuning);
    const interactionGrowth = edgeOverscan(interaction, frame, tuning);
    const growX = growth.x + interactionGrowth.x;
    const growY = growth.y + interactionGrowth.y;
    const shapes: { shape: ContentShape; label: string }[] = [
      ...layer.shapes.map((shape, k) => ({ shape, label: `layers[${i}].shapes[${k}]` })),
      ...layer.accentShapes.map((shape, k) => ({ shape, label: `layers[${i}].accentShapes[${k}]` })),
    ];
    content.stops.forEach((stop, si) => {
      content.segments.forEach((segment) => {
        const view: View = { travel: stopTravel(stop, segment), head: { x: ZERO, y: ZERO } };
        for (const { shape, label } of shapes) {
          const box = imageBox(shape, def, view, aspect, frame, tuning);
          if (box === null) continue;
          const x0 = box.x0 - growX;
          const x1 = box.x1 + growX;
          const y0 = box.y0 - growY;
          const y1 = box.y1 + growY;
          stop.slots.forEach((slot, j) => {
            const px = slot.u * aspect;
            const py = slot.v;
            const dx = Math.max(x0 - px, ZERO, px - x1);
            const dy = Math.max(y0 - py, ZERO, py - y1);
            if (Math.hypot(dx, dy) <= radius) {
              issues.push({
                path: `stops[${si}].slots[${j}]`,
                value: { u: slot.u, v: slot.v },
                message: `${label} comes within hitRadiusMax = ${radius} of stops[${si}].slots[${j}] (u = ${slot.u}, v = ${slot.v}) at aspect ${aspect}, segment ${segment.id} (Req 11.4)`,
              });
            }
          });
        }
      });
    });
  });
  return issues;
}

/** The rules that need a valid structure: layer table, segments, stops, shapes and clearance. */
function semanticIssues(content: WorldContent, tuning: Tuning, frame: ProjectionFrame): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  issues.push(...validateLayerTable(layerEntries(content), tuning));
  const layers = layerDefsOf(content, tuning);

  for (const kind of SEGMENT_KINDS) {
    if (!content.segments.some((segment) => segment.kind === kind)) {
      issues.push({ path: 'segments', value: kind, message: `segments needs at least one ${kind} segment (Req 13.4)` });
    }
  }
  content.segments.forEach((segment, i) => {
    const spec: SegmentSpec = segment;
    const prefix = `segments[${i}] (${segment.id})`;
    for (const issue of validateSegment(spec, tuning)) {
      issues.push({ ...issue, path: `segments[${i}].${issue.path}`, message: `${prefix}: ${issue.message}` });
    }
    for (const issue of checkDepthScaling(layers, spec, tuning)) {
      issues.push({ ...issue, path: `segments[${i}]`, message: `${prefix}: ${issue.message}` });
    }
  });

  if (content.stops.length !== STOP_COUNT) {
    issues.push({
      path: 'stops',
      value: content.stops.length,
      message: `stops has ${content.stops.length} entries; the slice has ${STOP_COUNT} (stop 1 and stop 2)`,
    });
  }
  content.stops.forEach((stop, i) => {
    const path = `stops[${i}]`;
    for (const segment of content.segments) {
      const anchor = stopTravel(stop, segment);
      if (!(stop.depth - anchor > tuning.nearPlane)) {
        issues.push({
          path: `${path}.depth`,
          value: stop.depth,
          message: `${path}.depth - anchor = ${stop.depth - anchor} must be above nearPlane = ${tuning.nearPlane} (segment ${segment.id})`,
        });
      }
    }
    stop.slots.forEach((slot, j) => {
      if (!(slot.u >= ZERO && slot.u <= ONE)) {
        issues.push({ path: `${path}.slots[${j}].u`, value: slot.u, message: `${path}.slots[${j}].u = ${slot.u} is outside [0, 1]` });
      }
      if (!(slot.v >= ZERO && slot.v <= ONE)) {
        issues.push({ path: `${path}.slots[${j}].v`, value: slot.v, message: `${path}.slots[${j}].v = ${slot.v} is outside [0, 1]` });
      }
    });
    if (!(stop.slots.length > stop.targets)) {
      issues.push({
        path: `${path}.slots`,
        value: stop.slots.length,
        message: `${path}.slots has ${stop.slots.length} entries; it needs more than targets = ${stop.targets}`,
      });
    }
  });

  content.layers.forEach((layer, i) => {
    if (layer.backdrop) return;
    const factor = layers[i]?.factor ?? Number.NaN;
    const groups: [string, readonly ContentShape[]][] = [
      ['shapes', layer.shapes],
      ['accentShapes', layer.accentShapes],
    ];
    for (const [group, shapes] of groups) {
      shapes.forEach((shape, k) => {
        const prefix = `layers[${i}].${group}[${k}]`;
        for (const issue of shapeOverscanIssues(boundsOf(shape), { factor }, content.sceneScale, tuning)) {
          issues.push({ ...issue, path: `${prefix}.${issue.path}`, message: `${prefix}.${issue.message}` });
        }
      });
    }
  });

  const aspects = [...new Set([ASPECT_MIN, frame.aspect, tuning.maxAspect])];
  for (const aspect of aspects) {
    issues.push(...frontClearanceIssues(content, aspect, content.sceneScale, tuning));
  }
  return issues;
}

/**
 * Validates a slice content (Req 1.5, 11.9; design 5.3). Returns the typed content, or every issue
 * with its JSON path. The frame gives the aspect of the window for the clearance check; the
 * clearance is also checked at ASPECT_MIN and at maxAspect.
 */
export function validateWorldContent(json: unknown, tuning: Tuning, frame: ProjectionFrame): ContentResult {
  const ctx: Ctx = { issues: [] };
  const content = readContent(ctx, json);
  if (content === undefined || ctx.issues.length > ZERO) return { ok: false, issues: ctx.issues };
  const issues = semanticIssues(content, tuning, frame);
  return issues.length === ZERO ? { ok: true, content } : { ok: false, issues };
}

/** The shipped forest content, validated against the shipped tuning. */
export function loadWorldContent(frame: ProjectionFrame = { aspect: DEFAULT_ASPECT, sceneScale: ONE }): ContentResult {
  return validateWorldContent(FOREST_JSON, TUNING, frame);
}
