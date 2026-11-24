// Stage order and routing (garden-level design 2.6; requirements 1.1, 20.1). Pure data and one parser. The
// route lists each stage and each travel in the order the player meets them. Two travels can follow each
// other: journey B ends in front of the hall door, and the door travel starts from there.

/** The four stage ids, used unchanged in code, content, URLs and tests (Req 1.1). */
export const STAGE_IDS = ['lantern-glade', 'whisper-glade', 'whisper-hall', 'bloom'] as const;

export type StageId = (typeof STAGE_IDS)[number];

/** A travel: a journey through the forest, or a door into or out of a hall (Req 2.1, 2.6). */
export type JourneyId = 'journeyA' | 'journeyB' | 'doorHall' | 'doorGarden';

export type RouteStep =
  | { readonly kind: 'stage'; readonly stage: StageId }
  | { readonly kind: 'travel'; readonly journey: JourneyId };

/** The order of the session: lantern, journey A, whisper glade, journey B, the hall door, the hall, the garden door, bloom. */
export const ROUTE: readonly RouteStep[] = Object.freeze([
  { kind: 'stage', stage: 'lantern-glade' },
  { kind: 'travel', journey: 'journeyA' },
  { kind: 'stage', stage: 'whisper-glade' },
  { kind: 'travel', journey: 'journeyB' },
  { kind: 'travel', journey: 'doorHall' },
  { kind: 'stage', stage: 'whisper-hall' },
  { kind: 'travel', journey: 'doorGarden' },
  { kind: 'stage', stage: 'bloom' },
]);

/** The two titles of Req 9.4. */
export type TitleId = 'lantern' | 'hall';

/** The stages that have a title, and which title. The machine shows the title when the stage activates (Req 9.4). */
export const TITLE_OF: Readonly<Partial<Record<StageId, TitleId>>> = Object.freeze({
  'lantern-glade': 'lantern',
  'whisper-hall': 'hall',
});

/**
 * The stage named by a `?start=` value (Req 20.1, 20.5). It returns the id for one of the four stage ids, and
 * null for anything else, including a missing value. It never throws.
 */
export function parseStartParam(value: string | null): StageId | null {
  if (typeof value !== 'string') return null;
  return (STAGE_IDS as readonly string[]).includes(value) ? (value as StageId) : null;
}
