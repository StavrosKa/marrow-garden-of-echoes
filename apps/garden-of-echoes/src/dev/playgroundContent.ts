// The validator of playground-content.json (design section 14.4, Req 26.3). It is hand-written, with no
// schema file and no validator dependency. It reports the first bad field in a readable message.
import type { Vec2 } from 'marrow/core';

export interface PlaygroundContent {
  /** The number of targets per round (Req 26.4). */
  readonly targetCount: number;
  /** The candidate slots in screen space, in order (Req 26.3). x is not capped here: the play-area aspect is known only at run time. */
  readonly slots: readonly Vec2[];
}

export type PlaygroundContentResult = { readonly ok: true; readonly content: PlaygroundContent } | { readonly ok: false; readonly message: string };

const FILE = 'playground-content.json';
const ROOT_KEYS = ['targetCount', 'slots'] as const;
const SLOT_KEYS = ['x', 'y'] as const;
const MIN_TARGETS = 1;
const MIN_SLOTS = 1;
const MAX_SLOTS = 64;
const X_MIN = 0;
const Y_MIN = 0;
const Y_MAX = 1;

/** A bad field: the message names the field, the value and the allowed range. */
class ContentError extends Error {}

function fail(detail: string): never {
  throw new ContentError(`${FILE}: ${detail}`);
}

function typeName(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The keys of an object that are not in the allowed list, in the order the file gives them. */
function failExtra(where: string, value: Record<string, unknown>, allowed: readonly string[]): void {
  const extra = Object.keys(value).find((key) => !allowed.includes(key));
  if (extra !== undefined) fail(`${where} has an extra property "${extra}"`);
}

/** A required number in a closed range, with a readable message for a missing, wrong or out-of-range value. */
function readNumber(where: string, value: Record<string, unknown>, key: string, min: number, max: number): number {
  const path = `${where}.${key}`;
  if (!(key in value)) fail(`${path} is missing`);
  const raw = value[key];
  if (typeof raw !== 'number') fail(`${path} must be a number, got ${typeName(raw)}`);
  if (!Number.isFinite(raw)) fail(`${path} must be a finite number`);
  if (raw < min || raw > max) fail(`${path} = ${raw} is out of range [${min}, ${max}]`);
  return raw;
}

function readSlot(value: unknown, index: number): Vec2 {
  const where = `slots[${index}]`;
  if (!isRecord(value)) fail(`${where} must be an object, got ${typeName(value)}`);
  failExtra(where, value, SLOT_KEYS);
  const x = readNumber(where, value, 'x', X_MIN, Number.POSITIVE_INFINITY);
  const y = readNumber(where, value, 'y', Y_MIN, Y_MAX);
  return { x, y };
}

function readContent(value: unknown): PlaygroundContent {
  if (!isRecord(value)) fail(`the file must hold an object, got ${typeName(value)}`);
  failExtra('(root)', value, ROOT_KEYS);
  if (!('targetCount' in value)) fail('targetCount is missing');
  const targetCount = value['targetCount'];
  if (typeof targetCount !== 'number') fail(`targetCount must be a number, got ${typeName(targetCount)}`);
  if (!Number.isInteger(targetCount) || targetCount < MIN_TARGETS) {
    fail(`targetCount = ${targetCount} must be an integer of at least ${MIN_TARGETS}`);
  }
  if (!('slots' in value)) fail('slots is missing');
  const slots = value['slots'];
  if (!Array.isArray(slots)) fail(`slots must be an array, got ${typeName(slots)}`);
  if (slots.length < MIN_SLOTS || slots.length > MAX_SLOTS) {
    fail(`slots has ${slots.length} items, but it needs from ${MIN_SLOTS} to ${MAX_SLOTS}`);
  }
  return { targetCount, slots: slots.map((slot, index) => readSlot(slot, index)) };
}

/** Reads the parsed JSON of playground-content.json. Returns the content, or the message of the first bad field. */
export function readPlaygroundContent(value: unknown): PlaygroundContentResult {
  try {
    return { ok: true, content: readContent(value) };
  } catch (error) {
    if (error instanceof ContentError) return { ok: false, message: error.message };
    throw error;
  }
}
