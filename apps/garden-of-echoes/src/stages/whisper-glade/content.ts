// Content of whisper-glade (garden-level design 4.1, 4.2; requirements 5.1, 5.2, 5.6, 5.8, 8.1). The content holds
// the two spirits (their stems, colours and shapes), the two blocks of marks, the spirit slots and the two path slots.
// It holds no text. Each line is a copy key built from a spirit stem, and the validator checks that every key exists
// in GARDEN_COPY. The validator never throws.
import { blockProblems, type Mark, type Presentation } from 'marrow/challenges';
import { hasCopyKey } from '../../copy/garden';
import { readSlot, type SlotSpec } from '../shared/placeholderContent';
import type { ContentIssue, ContentResult } from '../shared/stageTypes';

const STAGE_ID = 'whisper-glade';
const VERSION = 1;
/** Two spirits, one blue drop and one gold leaf (Req 5.6). */
const SPIRIT_COUNT = 2;
/** Two blocks, one before and one after the demonstration (Req 5.1, 5.2). */
const BLOCK_COUNT = 2;
/** Three marks in each block, so six presentations (Req 5.1). */
const MARKS_PER_BLOCK = 3;
const MARKS: readonly Mark[] = ['select', 'pass'];
const SHAPES = ['drop', 'leaf'] as const;
/** The copy keys that do not depend on a spirit: the demonstration line and the path line (Req 5.3, 8.1). */
export const FIXED_COPY_KEYS: readonly string[] = ['whisper.demo', 'path.choose'];

export interface Spirit {
  readonly stem: string;
  readonly colour: string;
  readonly shape: (typeof SHAPES)[number];
}

export interface Block {
  /** The stem of the spirit to select in this block (Req 5.2). */
  readonly select: string;
  /** The stem of the spirit to let pass in this block. */
  readonly pass: string;
  /** The mark of each presentation of the block, before the seeded order (Req 5.4). */
  readonly marks: readonly Mark[];
}

export interface WhisperGladeContent {
  readonly version: 1;
  readonly id: 'whisper-glade';
  readonly spirits: readonly Spirit[];
  readonly blocks: readonly Block[];
  /** The slot of each spirit, in the order of `spirits`. */
  readonly spiritSlots: readonly SlotSpec[];
  /** The slots of the two path targets: fireflies on the left, candles on the right (Req 8.1). */
  readonly pathSlots: { readonly fireflies: SlotSpec; readonly candles: SlotSpec };
}

/** The four per-rule copy keys of one spirit stem: select and pass lines, and their mistake lines (Req 5.8). */
export function spiritCopyKeys(stem: string): readonly string[] {
  return [`whisper.select.${stem}`, `whisper.pass.${stem}`, `mistake.select.${stem}`, `mistake.pass.${stem}`];
}

/** Every copy key the stage uses: the eight per-rule keys for the two spirits, and the fixed keys. */
export function copyKeysOf(content: WhisperGladeContent): string[] {
  return [...content.spirits.flatMap((spirit) => spiritCopyKeys(spirit.stem)), ...FIXED_COPY_KEYS];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readSpirits(value: unknown, issues: ContentIssue[]): Spirit[] | null {
  if (!Array.isArray(value) || value.length !== SPIRIT_COUNT) {
    issues.push({ path: 'spirits', message: `spirits must be an array of ${SPIRIT_COUNT} spirits` });
    return null;
  }
  const spirits: Spirit[] = [];
  let valid = true;
  value.forEach((item: unknown, index: number) => {
    const at = `spirits[${index}]`;
    if (!isRecord(item)) {
      issues.push({ path: at, message: `${at} must be an object` });
      valid = false;
      return;
    }
    const { stem, colour, shape } = item;
    if (typeof stem !== 'string' || typeof colour !== 'string') {
      issues.push({ path: `${at}.stem`, message: `${at}.stem and ${at}.colour must be strings` });
      valid = false;
      return;
    }
    if (!(SHAPES as readonly unknown[]).includes(shape)) {
      issues.push({ path: `${at}.shape`, message: `${at}.shape = ${String(shape)} must be drop or leaf` });
      valid = false;
      return;
    }
    for (const key of spiritCopyKeys(stem)) {
      if (!hasCopyKey(key)) {
        issues.push({ path: `${at}.stem`, message: `${at}.stem = ${stem} gives the copy key ${key}, which is not in GARDEN_COPY` });
        valid = false;
      }
    }
    spirits.push({ stem, colour, shape: shape as Spirit['shape'] });
  });
  const stems = spirits.map((spirit) => spirit.stem);
  if (new Set(stems).size !== stems.length) {
    issues.push({ path: 'spirits', message: 'the two spirits must have different stems' });
    valid = false;
  }
  return valid ? spirits : null;
}

function readBlock(value: unknown, index: number, stems: readonly string[], issues: ContentIssue[]): Block | null {
  const at = `blocks[${index}]`;
  if (!isRecord(value)) {
    issues.push({ path: at, message: `${at} must be an object` });
    return null;
  }
  let valid = true;
  for (const field of ['select', 'pass'] as const) {
    const stem = value[field];
    if (typeof stem !== 'string' || !stems.includes(stem)) {
      issues.push({ path: `${at}.${field}`, message: `${at}.${field} = ${String(stem)} must be the stem of a spirit` });
      valid = false;
    }
  }
  const marks = value.marks;
  if (!Array.isArray(marks) || marks.length !== MARKS_PER_BLOCK || !marks.every((mark) => MARKS.includes(mark as Mark))) {
    issues.push({ path: `${at}.marks`, message: `${at}.marks must list ${MARKS_PER_BLOCK} marks, each select or pass` });
    valid = false;
  }
  if (!valid) return null;
  const select = value.select as string;
  const pass = value.pass as string;
  if (select === pass) {
    issues.push({ path: `${at}.pass`, message: `${at}.pass must differ from ${at}.select` });
    return null;
  }
  const presentations: Presentation[] = (marks as Mark[]).map((mark) => ({
    stimulusId: mark === 'select' ? select : pass,
    mark,
  }));
  const problems = blockProblems(presentations);
  if (problems.length > 0) {
    issues.push({ path: `${at}.marks`, message: problems.join('; ') });
    return null;
  }
  return { select, pass, marks: marks as Mark[] };
}

function readBlocks(value: unknown, stems: readonly string[], issues: ContentIssue[]): Block[] | null {
  if (!Array.isArray(value) || value.length !== BLOCK_COUNT) {
    issues.push({ path: 'blocks', message: `blocks must be an array of ${BLOCK_COUNT} blocks` });
    return null;
  }
  const blocks = value.map((item: unknown, index: number) => readBlock(item, index, stems, issues));
  if (blocks.some((block) => block === null)) return null;
  const [first, second] = blocks as Block[];
  if (first !== undefined && second !== undefined && first.select === second.select) {
    issues.push({ path: 'blocks[1].select', message: 'the two blocks must use different rules' });
    return null;
  }
  return blocks as Block[];
}

function readSpiritSlots(value: unknown, issues: ContentIssue[]): SlotSpec[] | null {
  if (!Array.isArray(value)) {
    issues.push({ path: 'spiritSlots', message: 'spiritSlots must be an array' });
    return null;
  }
  if (value.length < SPIRIT_COUNT) {
    issues.push({ path: 'spiritSlots', message: `spiritSlots has ${value.length} slots; the stage needs at least ${SPIRIT_COUNT}` });
  }
  const slots: SlotSpec[] = [];
  value.forEach((item: unknown, index: number) => {
    const slot = readSlot(item, `spiritSlots[${index}]`, issues);
    if (slot !== null) slots.push(slot);
  });
  return slots.length === value.length && value.length >= SPIRIT_COUNT ? slots : null;
}

function readPathSlots(value: unknown, issues: ContentIssue[]): { fireflies: SlotSpec; candles: SlotSpec } | null {
  if (!isRecord(value)) {
    issues.push({ path: 'pathSlots', message: 'pathSlots must be an object with fireflies and candles' });
    return null;
  }
  const fireflies = readSlot(value.fireflies, 'pathSlots.fireflies', issues);
  const candles = readSlot(value.candles, 'pathSlots.candles', issues);
  return fireflies !== null && candles !== null ? { fireflies, candles } : null;
}

/** Checks whisper-glade content (design 4.2). The checks: version 1, the id, two spirits with copy keys, two blocks with a select and a pass, slots, and the fixed copy keys. */
export function validateWhisperGlade(json: unknown): ContentResult<WhisperGladeContent> {
  if (!isRecord(json)) return { ok: false, issues: [{ path: '', message: 'content must be a JSON object' }] };
  const issues: ContentIssue[] = [];
  if (json.version !== VERSION) issues.push({ path: 'version', message: `version = ${String(json.version)} must be ${VERSION}` });
  if (json.id !== STAGE_ID) issues.push({ path: 'id', message: `id = ${String(json.id)} must be ${STAGE_ID}` });
  for (const key of FIXED_COPY_KEYS) {
    if (!hasCopyKey(key)) issues.push({ path: 'copy', message: `the fixed copy key ${key} is not in GARDEN_COPY` });
  }
  const spirits = readSpirits(json.spirits, issues);
  const stems = spirits?.map((spirit) => spirit.stem) ?? [];
  const blocks = readBlocks(json.blocks, stems, issues);
  const spiritSlots = readSpiritSlots(json.spiritSlots, issues);
  const pathSlots = readPathSlots(json.pathSlots, issues);
  if (issues.length > 0 || spirits === null || blocks === null || spiritSlots === null || pathSlots === null) {
    return { ok: false, issues };
  }
  return { ok: true, value: { version: VERSION, id: STAGE_ID, spirits, blocks, spiritSlots, pathSlots } };
}

/** Like validateWhisperGlade, but throws once with every issue joined, for startup (design 4.2). */
export function loadWhisperGlade(json: unknown): WhisperGladeContent {
  const result = validateWhisperGlade(json);
  if (result.ok) return result.value;
  const lines = result.issues.map((issue) => `- ${issue.path}: ${issue.message}`);
  throw new Error(`invalid ${STAGE_ID} content:\n${lines.join('\n')}`);
}
