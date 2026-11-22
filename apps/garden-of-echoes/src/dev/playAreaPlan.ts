// The drawing of the play area for one frame (Req 26.5 to 26.9, 24.7, 24.8). `planPlayArea` is a pure function
// from the driver's output and the round to plain values: which shapes show, where, and how far the ring is
// filled. `applyPlayAreaPlan` writes those values into the SVG elements that React rendered, and nothing else.
// The frame loop calls it every animation frame, so the rings and orbs are never waiting on a React update.
//
// Every shape stays inside its hit area. The circle has the hit radius. The ring is centred on a radius that is
// the hit radius less half its stroke, so its outer edge is the hit radius (Req 26.6). The completed diamond has
// its corners on the hit circle.
import type { PointerInput, Vec2, WristId } from 'marrow/core';

/** The aspect A of the play area: its width over its height. The play field's CSS box has this ratio. App value, not in tuning.ts. */
export const PLAY_ASPECT = 1.6;
/** The stroke width of a progress ring, in play-area units. App value, not in tuning.ts. */
export const RING_STROKE = 0.012;
/** The radius of an orb, in play-area units. App value, not in tuning.ts. */
export const ORB_RADIUS = 0.02;

const TAU = 2 * Math.PI;

/** One target of the round, as the frame needs it. */
export interface TargetInput {
  readonly id: string;
  readonly centre: Vec2;
  /** Whether the target is drawn this frame: open, or completed in this round. */
  readonly shown: boolean;
  readonly completed: boolean;
  /** The session time of the selection, or null if the target was not selected. */
  readonly completedAtMs: number | null;
  /** The pointer that owns the target's hold, or null (Req 17.15). */
  readonly owner: WristId | null;
  /** The dwell progress as a fraction of the dwell time, 0..1 (Req 17.15). */
  readonly progress: number;
}

export interface TargetPaint {
  readonly id: string;
  readonly cx: number;
  readonly cy: number;
  readonly circle: { readonly visible: boolean; readonly radius: number };
  readonly diamond: { readonly visible: boolean; readonly opacity: number; readonly path: string };
  readonly ring: {
    readonly visible: boolean;
    readonly radius: number;
    readonly strokeWidth: number;
    /** The value of the SVG stroke-dasharray: the filled length, then the full circumference. */
    readonly dash: string;
  };
}

export interface OrbPaint {
  readonly wrist: WristId;
  readonly visible: boolean;
  readonly cx: number;
  readonly cy: number;
  readonly radius: number;
}

export interface PlayAreaPlan {
  readonly targets: readonly TargetPaint[];
  readonly orbs: readonly OrbPaint[];
}

export interface PlanInput {
  readonly hitRadius: number;
  /** The session time of this frame. The completion ease reads it. */
  readonly nowMs: number;
  /** The time over which a completed target eases to its completed shape. */
  readonly easeMs: number;
  readonly targets: readonly TargetInput[];
  /** The screen pointers of this frame, one for each active wrist. */
  readonly pointers: readonly PointerInput[];
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** The ease of a completed shape: fast at first, then slowing to rest. 0 at the selection, 1 when done. */
export function easeOutCubic(fraction: number): number {
  const t = clampUnit(fraction);
  return 1 - (1 - t) ** 3;
}

function diamondPath(cx: number, cy: number, radius: number): string {
  return `M ${cx} ${cy - radius} L ${cx + radius} ${cy} L ${cx} ${cy + radius} L ${cx - radius} ${cy} Z`;
}

function paintTarget(target: TargetInput, input: PlanInput): TargetPaint {
  const { hitRadius } = input;
  const ease =
    target.completed && target.completedAtMs !== null
      ? easeOutCubic((input.nowMs - target.completedAtMs) / input.easeMs)
      : target.completed
        ? 1
        : 0;
  const ringRadius = hitRadius - RING_STROKE / 2;
  const circumference = TAU * ringRadius;
  // A ring shows only on a target with an owner and progress above 0 (Req 26.8).
  const ringVisible = target.owner !== null && target.progress > 0 && !target.completed;
  return {
    id: target.id,
    cx: target.centre.x,
    cy: target.centre.y,
    circle: { visible: target.shown && !target.completed, radius: hitRadius },
    diamond: {
      visible: target.completed,
      opacity: ease,
      path: diamondPath(target.centre.x, target.centre.y, hitRadius),
    },
    ring: {
      visible: ringVisible,
      radius: ringRadius,
      strokeWidth: RING_STROKE,
      dash: `${clampUnit(target.progress) * circumference} ${circumference}`,
    },
  };
}

/** The values of every shape for one frame. The inputs are only read. */
export function planPlayArea(input: PlanInput): PlayAreaPlan {
  return {
    targets: input.targets.map((target) => paintTarget(target, input)),
    orbs: input.pointers.map((pointer) => ({
      wrist: pointer.wrist,
      // An orb is drawn at a valid pointer and hidden while the wrist is invalid (Req 26.7).
      visible: pointer.valid,
      cx: pointer.valid ? pointer.pos.x : 0,
      cy: pointer.valid ? pointer.pos.y : 0,
      radius: ORB_RADIUS,
    })),
  };
}

/** The SVG elements of one target, registered by the component. A null entry means the element is not mounted. */
export interface TargetParts {
  circle: SVGElement | null;
  diamond: SVGElement | null;
  ring: SVGElement | null;
}

/** The registered elements of the play area, by target id and by wrist. */
export interface PlayAreaParts {
  readonly targets: Map<string, TargetParts>;
  readonly orbs: Map<WristId, SVGElement | null>;
}

export function createPlayAreaParts(): PlayAreaParts {
  return { targets: new Map(), orbs: new Map() };
}

function setVisible(element: SVGElement, visible: boolean): void {
  element.setAttribute('visibility', visible ? 'visible' : 'hidden');
}

/** Writes a plan into the registered elements. An element that is not mounted is skipped. */
export function applyPlayAreaPlan(parts: PlayAreaParts, plan: PlayAreaPlan): void {
  for (const paint of plan.targets) {
    const target = parts.targets.get(paint.id);
    if (target === undefined) continue;
    if (target.circle !== null) {
      target.circle.setAttribute('cx', String(paint.cx));
      target.circle.setAttribute('cy', String(paint.cy));
      target.circle.setAttribute('r', String(paint.circle.radius));
      setVisible(target.circle, paint.circle.visible);
    }
    if (target.diamond !== null) {
      target.diamond.setAttribute('d', paint.diamond.path);
      target.diamond.setAttribute('opacity', String(paint.diamond.opacity));
      setVisible(target.diamond, paint.diamond.visible);
    }
    if (target.ring !== null) {
      target.ring.setAttribute('cx', String(paint.cx));
      target.ring.setAttribute('cy', String(paint.cy));
      target.ring.setAttribute('r', String(paint.ring.radius));
      target.ring.setAttribute('stroke-width', String(paint.ring.strokeWidth));
      target.ring.setAttribute('stroke-dasharray', paint.ring.dash);
      setVisible(target.ring, paint.ring.visible);
    }
  }
  for (const orb of plan.orbs) {
    const element = parts.orbs.get(orb.wrist);
    if (element === undefined || element === null) continue;
    element.setAttribute('cx', String(orb.cx));
    element.setAttribute('cy', String(orb.cy));
    element.setAttribute('r', String(orb.radius));
    setVisible(element, orb.visible);
  }
}
