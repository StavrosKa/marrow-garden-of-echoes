// The garden's player-facing text (garden-level design 2.11; requirements 14.1 to 14.4). Every line here is the draft
// text of the Requirement 14 table, exactly as written there. The keys are the table's keys. The text is final only
// after the owner approves it. Strings only, no logic, except the two helpers that read the keys.

export const GARDEN_COPY = {
  home: { start: 'Start', noCamera: 'Try without camera' },
  camera: { why: 'The camera follows your hands and head. Video stays on this device and is never recorded or sent anywhere.' },
  label: { simulated: 'Simulated input' },
  calibrate: { edge: "Reach ends where the camera's view ends." },
  hint: { light: 'More light, face the window.' },
  tracking: { step: 'Step back into view' },
  lantern: { first: 'Hold your light on the lantern.', next: 'Light the next lantern.' },
  path: { choose: 'Follow the fireflies or the candles.' },
  whisper: {
    select: { blueDrop: 'Reach for the blue drop.', goldLeaf: 'Reach for the gold leaf.' },
    pass: { blueDrop: 'Let the blue drop pass.', goldLeaf: 'Let the gold leaf pass.' },
    demo: 'Watch. Now reach for the gold leaf.',
  },
  mistake: {
    select: { blueDrop: "Let's watch again. Reach for the blue drop.", goldLeaf: "Let's watch again. Reach for the gold leaf." },
    pass: { blueDrop: "Let's watch again. Let the blue drop pass.", goldLeaf: "Let's watch again. Let the gold leaf pass." },
  },
  help: { offer: 'Want a hint?', continue: 'Continue with help' },
  hall: { target: 'Hold your light on the hall lantern.' },
  bloom: { target: 'Hold your light on the bloom.' },
  title: { lantern: 'Lantern Garden', hall: 'Whisper Hall' },
  end: { card: 'The garden waits. Bloom is not built yet.' },
  pause: {
    resume: 'Resume',
    recalibrate: 'Recalibrate',
    motion: 'Motion',
    sound: 'Sound',
    help: 'Continue with help',
    restart: 'Restart',
    exit: 'Exit',
  },
} as const;

/** A dotted path to a string of GARDEN_COPY, such as "whisper.select.blueDrop". */
export type GardenCopyKey = Paths<typeof GARDEN_COPY>;

type Paths<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : Paths<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

/** The dotted paths of every string of a copy object. */
function pathsOf(value: unknown, prefix = ''): string[] {
  if (typeof value === 'string') return [prefix];
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) => pathsOf(child, prefix === '' ? key : `${prefix}.${key}`));
}

const KEYS: ReadonlySet<string> = new Set(pathsOf(GARDEN_COPY));

/** True when `key` is a dotted path of GARDEN_COPY. */
export function hasCopyKey(key: string): boolean {
  return KEYS.has(key);
}
