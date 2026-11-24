// Journeys and doors (garden-level design 2.6, 4.1, 4.2; requirements 2.1, 2.5, 2.6). The four segments come from
// segments.json and pass world-view's validateSegment. A journey or a door is world-view's travel engine, started
// with the motion level of the session. This file adds no travel rule of its own (Req 2.1).
import {
  createTravel,
  validateSegment,
  TUNING as WORLD_TUNING,
  type SegmentKind,
  type SegmentSpec,
  type TravelSegment,
  type TravelState,
} from 'world-view';
import type { JourneySegments } from '../session/machine';
import type { JourneyId } from '../session/stageOrder';
import type { ContentIssue, ContentResult } from '../stages/shared/stageTypes';

const VERSION = 1;

/** The four travels in the order the route meets them (design 4.1). Each starts where the one before ends. */
const SEGMENT_ORDER: readonly JourneyId[] = ['journeyA', 'journeyB', 'doorHall', 'doorGarden'];

const KIND_OF: Readonly<Record<JourneyId, SegmentKind>> = {
  journeyA: 'journey',
  journeyB: 'journey',
  doorHall: 'door',
  doorGarden: 'door',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJourneyId(value: unknown): value is JourneyId {
  return typeof value === 'string' && (SEGMENT_ORDER as readonly string[]).includes(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Checks the segment table. It never throws. Each segment is checked with world-view's rules (Req 2.2, 2.3, 2.6),
 * the kind is the one the route expects, and each segment starts where the one before it ends.
 */
export function validateSegments(json: unknown): ContentResult<JourneySegments> {
  if (!isRecord(json)) return { ok: false, issues: [{ path: '', message: 'segments must be a JSON object' }] };
  const issues: ContentIssue[] = [];
  if (json.version !== VERSION) issues.push({ path: 'version', message: `version = ${String(json.version)} must be ${VERSION}` });
  const list = json.segments;
  if (!Array.isArray(list)) return { ok: false, issues: [...issues, { path: 'segments', message: 'segments must be an array' }] };
  const found: Partial<Record<JourneyId, TravelSegment>> = {};
  list.forEach((item: unknown, index: number) => {
    const at = `segments[${index}]`;
    if (!isRecord(item)) {
      issues.push({ path: at, message: `${at} must be an object` });
      return;
    }
    const id = item.id;
    if (!isJourneyId(id)) {
      issues.push({ path: `${at}.id`, message: `${at}.id = ${String(id)} is not a segment id` });
      return;
    }
    if (found[id] !== undefined) issues.push({ path: `${at}.id`, message: `${at}.id = ${id} appears twice` });
    if (item.kind !== KIND_OF[id]) issues.push({ path: `${at}.kind`, message: `${at}.kind must be ${KIND_OF[id]} for ${id}` });
    for (const field of ['from', 'to', 'durationMs'] as const) {
      if (!isFiniteNumber(item[field])) issues.push({ path: `${at}.${field}`, message: `${at}.${field} must be a finite number` });
    }
    if (!isFiniteNumber(item.from) || !isFiniteNumber(item.to) || !isFiniteNumber(item.durationMs)) return;
    const spec: SegmentSpec = { id, kind: KIND_OF[id], from: item.from, to: item.to, durationMs: item.durationMs };
    for (const issue of validateSegment(spec, WORLD_TUNING)) issues.push({ path: `${at}.${issue.path}`, message: issue.message });
    found[id] = { from: item.from, to: item.to, durationMs: item.durationMs };
  });
  for (const id of SEGMENT_ORDER) {
    if (found[id] === undefined) issues.push({ path: 'segments', message: `segments has no ${id}` });
  }
  for (let k = 1; k < SEGMENT_ORDER.length; k++) {
    const before = found[SEGMENT_ORDER[k - 1] as JourneyId];
    const now = found[SEGMENT_ORDER[k] as JourneyId];
    if (before !== undefined && now !== undefined && now.from !== before.to) {
      issues.push({
        path: `${SEGMENT_ORDER[k]}.from`,
        message: `${SEGMENT_ORDER[k]}.from = ${now.from} must equal ${SEGMENT_ORDER[k - 1]}.to = ${before.to}`,
      });
    }
  }
  const journeyA = found.journeyA;
  const journeyB = found.journeyB;
  const doorHall = found.doorHall;
  const doorGarden = found.doorGarden;
  if (issues.length > 0 || journeyA === undefined || journeyB === undefined || doorHall === undefined || doorGarden === undefined) {
    return { ok: false, issues };
  }
  return { ok: true, value: Object.freeze({ journeyA, journeyB, doorHall, doorGarden }) };
}

/** Like validateSegments, but throws once with every issue joined, for startup. */
export function loadSegments(json: unknown): JourneySegments {
  const result = validateSegments(json);
  if (result.ok) return result.value;
  const lines = result.issues.map((issue) => `- ${issue.path}: ${issue.message}`);
  throw new Error(`invalid journey segments:\n${lines.join('\n')}`);
}

/** The world-view travel of one journey or door, before it is started (Req 2.1). */
export function journeyTravel(segments: JourneySegments, journey: JourneyId): TravelState {
  return createTravel(segments[journey]);
}
