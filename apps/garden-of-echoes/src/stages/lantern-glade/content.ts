// Content of lantern-glade (garden-level design 4.1, 4.2; requirements 4.1, 4.2, 4.5). The content holds the lantern
// count, the note of each lantern, the authored slots and the copy keys of the two lantern lines. It holds no text:
// each line is a key that GARDEN_COPY must contain. The validator never throws.
import { hasCopyKey } from '../../copy/garden';
import { readSlot, type SlotSpec } from '../shared/placeholderContent';
import type { ContentIssue, ContentResult } from '../shared/stageTypes';

const STAGE_ID = 'lantern-glade';
const VERSION = 1;

/** The number of lanterns the stage lights, in order (Req 4.1). */
export const LANTERN_COUNT = 4;

/** A pitch name such as C4, or F#5 and Bb3. */
const NOTE_NAME = /^[A-G](?:#|b)?[0-9]$/;

export interface LanternGladeContent {
  readonly version: 1;
  readonly id: 'lantern-glade';
  readonly lanterns: number;
  /** One pitch name per lantern, in lantern order (Req 4.2). */
  readonly notes: readonly string[];
  /** Authored candidate slots on the interaction layer. There are at least as many as lanterns (design 4.2). */
  readonly slots: readonly SlotSpec[];
  readonly copy: { readonly first: string; readonly next: string };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readNotes(value: unknown, issues: ContentIssue[]): string[] | null {
  if (!Array.isArray(value)) {
    issues.push({ path: 'notes', message: 'notes must be an array' });
    return null;
  }
  if (value.length !== LANTERN_COUNT) {
    issues.push({ path: 'notes', message: `notes has ${value.length} names; it needs one per lantern, ${LANTERN_COUNT}` });
  }
  let valid = true;
  value.forEach((item: unknown, index: number) => {
    if (typeof item !== 'string' || !NOTE_NAME.test(item)) {
      issues.push({ path: `notes[${index}]`, message: `notes[${index}] = ${String(item)} must be a pitch name such as C4` });
      valid = false;
    }
  });
  return valid && value.length === LANTERN_COUNT ? (value as string[]) : null;
}

function readSlots(value: unknown, issues: ContentIssue[]): SlotSpec[] | null {
  if (!Array.isArray(value)) {
    issues.push({ path: 'slots', message: 'slots must be an array' });
    return null;
  }
  if (value.length < LANTERN_COUNT) {
    issues.push({ path: 'slots', message: `slots has ${value.length} slots; the stage needs at least ${LANTERN_COUNT}` });
  }
  const slots: SlotSpec[] = [];
  value.forEach((item: unknown, index: number) => {
    const slot = readSlot(item, `slots[${index}]`, issues);
    if (slot !== null) slots.push(slot);
  });
  return slots.length === value.length && value.length >= LANTERN_COUNT ? slots : null;
}

function readCopy(value: unknown, issues: ContentIssue[]): { first: string; next: string } | null {
  if (!isRecord(value)) {
    issues.push({ path: 'copy', message: 'copy must be an object' });
    return null;
  }
  const keys = ['first', 'next'] as const;
  const out: Partial<Record<(typeof keys)[number], string>> = {};
  for (const key of keys) {
    const text = value[key];
    if (typeof text !== 'string' || !hasCopyKey(text)) {
      issues.push({ path: `copy.${key}`, message: `copy.${key} = ${String(text)} must be a key of GARDEN_COPY, such as lantern.first` });
    } else {
      out[key] = text;
    }
  }
  return out.first !== undefined && out.next !== undefined ? { first: out.first, next: out.next } : null;
}

/** Checks lantern-glade content. The checks: version 1, the stage id, four lanterns, four notes, slots, and copy keys. */
export function validateLanternGlade(json: unknown): ContentResult<LanternGladeContent> {
  if (!isRecord(json)) return { ok: false, issues: [{ path: '', message: 'content must be a JSON object' }] };
  const issues: ContentIssue[] = [];
  if (json.version !== VERSION) issues.push({ path: 'version', message: `version = ${String(json.version)} must be ${VERSION}` });
  if (json.id !== STAGE_ID) issues.push({ path: 'id', message: `id = ${String(json.id)} must be ${STAGE_ID}` });
  if (json.lanterns !== LANTERN_COUNT) {
    issues.push({ path: 'lanterns', message: `lanterns = ${String(json.lanterns)} must be ${LANTERN_COUNT}` });
  }
  const notes = readNotes(json.notes, issues);
  const slots = readSlots(json.slots, issues);
  const copy = readCopy(json.copy, issues);
  if (issues.length > 0 || notes === null || slots === null || copy === null) return { ok: false, issues };
  return { ok: true, value: { version: VERSION, id: STAGE_ID, lanterns: LANTERN_COUNT, notes, slots, copy } };
}

/** Like validateLanternGlade, but throws once with every issue joined, for startup (design 4.2). */
export function loadLanternGlade(json: unknown): LanternGladeContent {
  const result = validateLanternGlade(json);
  if (result.ok) return result.value;
  const lines = result.issues.map((issue) => `- ${issue.path}: ${issue.message}`);
  throw new Error(`invalid ${STAGE_ID} content:\n${lines.join('\n')}`);
}
