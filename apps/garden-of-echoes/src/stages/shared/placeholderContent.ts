// Placeholder content for a one-target stage (design 4.1, 4.2; task 3.5). Whisper Hall and Bloom keep this shape.
// Lantern Glade and Whisper Glade use it until tasks 6 and 8 replace their content. Content holds ids, positions and
// counts, and each line is a copy key. The validator checks that the key exists in GARDEN_COPY (design 4.2).
import { hasCopyKey } from '../../copy/garden';
import type { StageId } from '../../session/stageOrder';
import type { ContentIssue, ContentResult } from './stageTypes';

/** A one-target stage has one target, and so needs at least one slot. */
const TARGETS = 1;

const SLOT_FIELDS = ['x', 'y', 'depth', 'anchor'] as const;

/** One authored candidate slot in world space (design 4.1). */
export interface SlotSpec {
  readonly x: number;
  readonly y: number;
  readonly depth: number;
  readonly anchor: number;
}

export interface PlaceholderContent {
  readonly version: 1;
  readonly id: StageId;
  readonly target: { readonly slots: readonly SlotSpec[]; readonly copy: string };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Reads one slot. Each field that is not a finite number adds an issue, and the slot is then null. */
function readSlot(value: unknown, path: string, issues: ContentIssue[]): SlotSpec | null {
  if (!isRecord(value)) {
    issues.push({ path, message: `${path} must be an object` });
    return null;
  }
  let valid = true;
  for (const field of SLOT_FIELDS) {
    const number = value[field];
    if (!isFiniteNumber(number)) {
      issues.push({ path: `${path}.${field}`, message: `${path}.${field} = ${String(number)} must be a finite number` });
      valid = false;
    }
  }
  if (!valid) return null;
  const x = value.x as number;
  const y = value.y as number;
  const depth = value.depth as number;
  const anchor = value.anchor as number;
  return { x, y, depth, anchor };
}

/**
 * Checks placeholder content for the stage `id`. It never throws. The checks: version 1, the stage id, one target
 * with at least one slot, each slot with finite numbers, and a copy key that exists in GARDEN_COPY.
 */
export function validatePlaceholder(json: unknown, id: StageId): ContentResult<PlaceholderContent> {
  if (!isRecord(json)) return { ok: false, issues: [{ path: '', message: 'content must be a JSON object' }] };
  const issues: ContentIssue[] = [];
  if (json.version !== 1) issues.push({ path: 'version', message: `version = ${String(json.version)} must be 1` });
  if (json.id !== id) issues.push({ path: 'id', message: `id = ${String(json.id)} must be ${id}` });

  const slots: SlotSpec[] = [];
  let copy: string | null = null;
  const target = json.target;
  if (!isRecord(target)) {
    issues.push({ path: 'target', message: 'target must be an object' });
  } else {
    const rawSlots = target.slots;
    if (!Array.isArray(rawSlots)) {
      issues.push({ path: 'target.slots', message: 'target.slots must be an array' });
    } else {
      if (rawSlots.length < TARGETS) {
        issues.push({
          path: 'target.slots',
          message: `target.slots has ${rawSlots.length} slots; a one-target stage needs at least ${TARGETS}`,
        });
      }
      rawSlots.forEach((item: unknown, index: number) => {
        const slot = readSlot(item, `target.slots[${index}]`, issues);
        if (slot !== null) slots.push(slot);
      });
    }
    const rawCopy = target.copy;
    if (typeof rawCopy !== 'string' || !hasCopyKey(rawCopy)) {
      issues.push({ path: 'target.copy', message: `target.copy = ${String(rawCopy)} must be a key of GARDEN_COPY, such as hall.target` });
    } else {
      copy = rawCopy;
    }
  }

  if (issues.length > 0 || copy === null) return { ok: false, issues };
  return { ok: true, value: { version: 1, id, target: { slots, copy } } };
}

/** Like validatePlaceholder, but throws once with every issue joined, for startup (design 4.2). */
export function loadPlaceholder(json: unknown, id: StageId): PlaceholderContent {
  const result = validatePlaceholder(json, id);
  if (result.ok) return result.value;
  const lines = result.issues.map((issue) => `- ${issue.path}: ${issue.message}`);
  throw new Error(`invalid ${id} content:\n${lines.join('\n')}`);
}
