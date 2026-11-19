// Segments (Req 2.8, 7.2; design 5.3): the rules of one travel segment and the depth scaling
// thresholds it must meet. Kinds are content-free: a journey and a door.
import type { ValidationIssue } from './issues';
import type { LayerDef } from './layers';
import { depthScale } from './projection';
import { TUNING, type Tuning } from './tuning';

const ONE = 1;
const HALF = 0.5;

export type SegmentKind = 'journey' | 'door';

/** One segment as the content states it: a finite stretch of the path and how long it takes. */
export interface SegmentSpec {
  readonly id: string;
  readonly kind: SegmentKind;
  readonly from: number;
  readonly to: number;
  readonly durationMs: number;
}

/**
 * The rules of one segment: `from < to`, both finite; a journey lasts `journeyMinMs ..
 * journeyMaxMs`; a door lasts exactly `doorMs`.
 */
export function validateSegment(spec: SegmentSpec, tuning: Tuning = TUNING): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (path: string, value: unknown, message: string): void => {
    issues.push({ path, value, message });
  };
  if (spec.kind !== 'journey' && spec.kind !== 'door') {
    add('kind', spec.kind, `kind = ${String(spec.kind)} must be "journey" or "door"`);
  }
  if (!Number.isFinite(spec.from)) add('from', spec.from, `from = ${spec.from} must be a finite number`);
  if (!Number.isFinite(spec.to)) add('to', spec.to, `to = ${spec.to} must be a finite number`);
  if (Number.isFinite(spec.from) && Number.isFinite(spec.to) && !(spec.from < spec.to)) {
    add('to', spec.to, `to = ${spec.to} must be above from = ${spec.from}`);
  }
  if (spec.kind === 'journey' && !(spec.durationMs >= tuning.journeyMinMs && spec.durationMs <= tuning.journeyMaxMs)) {
    add(
      'durationMs',
      spec.durationMs,
      `durationMs = ${spec.durationMs} is out of range [${tuning.journeyMinMs}, ${tuning.journeyMaxMs}] for a journey`,
    );
  }
  if (spec.kind === 'door' && spec.durationMs !== tuning.doorMs) {
    add('durationMs', spec.durationMs, `durationMs = ${spec.durationMs} must equal doorMs = ${tuning.doorMs} for a door`);
  }
  return issues;
}

/**
 * The depth scaling thresholds of Req 2.8 for one segment, by its kind. A layer with depth
 * at least `horizonDepth` must move any point of the viewport (aspect up to `maxAspect`, head
 * 0) by less than the segment's `horizonMaxMove` between the start and the end; a layer with
 * depth at most `foregroundDepth` must grow by at least the segment's `foregroundMinGrowth`.
 * The farthest viewport point from the vanishing point is the farthest corner.
 */
export function checkDepthScaling(
  layers: readonly LayerDef[],
  spec: SegmentSpec,
  tuning: Tuning = TUNING,
): ValidationIssue[] {
  const door = spec.kind === 'door';
  const maxMove = door ? tuning.doorHorizonMaxMove : tuning.journeyHorizonMaxMove;
  const minGrowth = door ? tuning.doorForegroundMinGrowth : tuning.journeyForegroundMinGrowth;
  const vanishingX = tuning.maxAspect * HALF;
  const reach = Math.hypot(
    Math.max(vanishingX, tuning.maxAspect - vanishingX),
    Math.max(tuning.vanishingPointY, ONE - tuning.vanishingPointY),
  );
  const issues: ValidationIssue[] = [];
  layers.forEach((layer, i) => {
    const at = `layers[${i}]`;
    const start = depthScale(layer, spec.from);
    const end = depthScale(layer, spec.to);
    if (layer.depth >= tuning.horizonDepth) {
      // A viewport point at the start has |p - v| <= reach / start, so its move is
      // reach * (end - start) / start. A start scale below 1 (anchor above the start) enlarges it.
      const move = (reach * (end - start)) / start;
      if (!(move < maxMove)) {
        issues.push({
          path: `${at}.depth`,
          value: layer.depth,
          message: `${at}.depth = ${layer.depth} moves a viewport point by ${move} over segment ${spec.id}; it must stay below ${maxMove}`,
        });
      }
    }
    if (layer.depth <= tuning.foregroundDepth) {
      const growth = end / start;
      if (!(growth >= minGrowth)) {
        issues.push({
          path: `${at}.depth`,
          value: layer.depth,
          message: `${at}.depth = ${layer.depth} grows by ${growth} over segment ${spec.id}; it must grow by at least ${minGrowth}`,
        });
      }
    }
  });
  return issues;
}
