# Design: garden-level

Based on `requirements.md` at commit 9243e22. Tasks come later, in `tasks.md`.

Checked on disk at 9243e22: `packages/marrow/src/challenges/index.ts` and `src/sim/index.ts` contain only `export {};`. The root `simulate` script calls a marrow stub that exits 1. `marrow-input` and `world-view` public APIs are as listed in section 7.

## 1. Architecture overview

### 1.1 Import rules

- `packages/marrow` imports nothing from `apps/` and nothing from `world-view`.
- `marrow/core`, `marrow/challenges` and `marrow/sim` import no React, PixiJS, DOM or MediaPipe code. They import only `marrow/core` and each other.
- `packages/world-view/src/core` stays pure. Only `world-view/pixi` touches PixiJS.
- `apps/garden-of-echoes` imports only the entry points `marrow/core`, `marrow/challenges`, `marrow/input`, `marrow/sim`, `marrow/react`, `world-view` and `world-view/pixi`.
- `marrow/core`, `marrow/input`, `marrow/react` and `world-view` are unchanged.

### 1.2 Files

```text
packages/marrow/src/
  challenges/
    rng.ts              Seeded generator as a value. Imports: none.
    tuning.ts           ATTENTION_TUNING and its validator. Imports: none.
    attention.ts        Attention round. Imports: ./rng, ./tuning, core (MotionLevel type).
    placementBand.ts    Resting-band rule around placeTargets. Imports: core (placement, mapping, tuning types), ./tuning.
    index.ts            Entry point marrow/challenges.
  sim/
    tuning.ts           SIM_PROFILES and its validator. Imports: none.
    player.ts           Seeded choices and pose frames. Imports: ./../challenges/rng, core (PoseFrame, Mapping types), ./tuning.
    calibrationSweep.ts Seeded camera-space reach samples. Imports: ../challenges/rng, ./tuning.
    invariants.ts       Pure log of invariant checks. Imports: none.
    report.ts           formatReport and exitCodeFor. Imports: ./invariants.
    index.ts            Entry point marrow/sim.
apps/garden-of-echoes/src/
  session/
    tuning.ts           APP_SESSION_TUNING and its validator. Imports: none.
    stageOrder.ts       STAGE_IDS, ROUTE, parseStartParam. Imports: none.
    machine.ts          Session machine. Imports: ./stageOrder, ./tuning, world-view (travel), core (MotionLevel).
    roundSnapshot.ts    The only reader of help levels. Imports: core (HelpState, helpRadiusForMotorLevel, Tuning).
    lowRate.ts          Delivered-rate watch. Imports: ./tuning.
    stageDriver.ts      Per-frame glue: placement, help events, dwell to stage rules. Imports: marrow/*, world-view, ../stages, ./roundSnapshot.
  stages/
    shared/stageTypes.ts       Shared stage types and issue type. Imports: ../session/stageOrder.
    shared/placeRound.ts       World slots to screen, planPlacement, back to world points. Imports: marrow/core, marrow/challenges, world-view, ../../session/roundSnapshot.
    shared/contract.ts         Helper for the contract tests (test files only).
    lantern-glade/             content.json, content.ts (validator), rules.ts (pure), scene.ts (PixiJS), rules.test.ts, content.test.ts
    whisper-glade/             content.json, content.ts, rules.ts, pathChoice.ts (pure), scene.ts, tests
    whisper-hall/              content.json, content.ts, rules.ts, scene.ts, tests (placeholder stage)
    bloom/                     content.json, content.ts, rules.ts, scene.ts, tests (placeholder stage)
  journeys/
    segments.json, journeys.ts  loadSegments, journeyTravel. Imports: world-view (validateSegment, checkDepthScaling, createTravel).
  scene/
    spriteSlot.ts       Sprite-slot interface and placeholder source. Imports: world-view types only.
    sceneSetup.ts      Builds SceneManagerOptions. Imports: world-view/pixi.
    flicker.ts         Lantern and candle brightness: at most 15% either way, cycles of 1.5 s or longer, steady in Reduced. Imports: none.
  audio/
    pentatonic.ts       Lantern notes and frequencies. Imports: none.
    tonePlayer.ts       Existing player, plus playFrequency(hz). Imports: marrow/core (TUNING).
    gardenAudio.ts      Start on a user action, mute, volume. Imports: ./tonePlayer, ./pentatonic.
  copy/
    garden.ts           GARDEN_COPY: every key of the requirements table. Imports: none.
    gardenMarrowCopy.ts MarrowCopy filled from GARDEN_COPY and, for fields with no key, from copy.marrow. Imports: marrow/react (type), ./garden, ./index (the existing playground copy).
    index.ts            Existing playground copy, plus re-exports.
  ui/                   Home, PauseScreen, EndCard, PlayArea, InstructionLine, CalibrationExplainer. Imports: marrow/react, copy, session.
  dev/simulate/
    run.mjs             Starts Vite's SSR loader and runs cli.ts. Imports: vite (already installed), node built-ins.
    cli.ts              Arguments, runs, report, exit code. Imports: marrow/sim, ./runSession.
    runSession.ts       One headless session. Imports: marrow/sim, marrow/core, marrow/challenges, ../../session, ../../stages, ../../journeys.
```

`scene/` and `ui/` hold the only code that touches PixiJS or React. The `session/`, `stages/*/rules.ts`, `journeys/journeys.ts` and `packages/marrow/src/{challenges,sim}` modules stay pure.

## 2. Module contracts

Time reaches pure logic as `dtMs`. Randomness reaches it as an `Rng` value that each draw returns anew. Two clocks apply:

- Dwell and tracking use the presence delta (`presenceDelta`, `sessionDelta` from marrow).
- Attention windows, celebration, travel, title fades and ambient motion use the session delta.

No module in these folders calls `Date.now`, `performance.now`, `setTimeout` or `Math.random`.

### 2.1 `marrow/challenges/rng.ts`

```ts
export interface Rng { readonly state: number }            // 32-bit state, mulberry32
export function seedRng(seed: number): Rng;
export function nextUnit(rng: Rng): { readonly value: number; readonly rng: Rng }; // 0 <= value < 1
export function shuffle<T>(items: readonly T[], rng: Rng): { readonly items: readonly T[]; readonly rng: Rng };
```
Owns the draw sequence. Must not hold a hidden mutable state.

### 2.2 `marrow/challenges/tuning.ts`

```ts
export interface AttentionTuning {
  readonly presentationMinMs: number;          // 2500, rule: dwell 1.5 s plus 1 s
  readonly demonstrationMs: number;            // 3000, tune
  readonly letPassWindowFullMs: number;        // 4000, tune (requirements table)
  readonly letPassWindowGentleMs: number;      // 6000, tune
  readonly selectWindowFullMs: number;         // 10000, tune
  readonly selectWindowGentleMs: number;       // 15000, tune
  readonly offerHelpAfterMistakes: number;     // 2, tune; must equal core difficultiesBeforeHelp
  readonly forceCompleteAfterMistakes: number; // 3, tune; must be greater than the offer
  readonly restingBandY: number;               // 0.75, tune; camera frame, normalized y
}
export const ATTENTION_TUNING: Readonly<AttentionTuning>;
export function validateAttentionTuning(t: AttentionTuning, core: Tuning): string[]; // one line per problem
```
Owns every attention and band number. Must not be read as a literal anywhere else. `validateAttentionTuning` runs when the app starts.

### 2.3 `marrow/challenges/attention.ts`

```ts
export type Mark = 'select' | 'pass';
export interface Presentation { readonly stimulusId: string; readonly mark: Mark }   // stimulusId is opaque
export interface AttentionWindows {
  readonly presentationMinMs: number;
  readonly demonstrationMs: number;
  readonly selectMs: number;   // select window
  readonly letPassMs: number;  // let-pass window
  readonly offerAfter: number;
  readonly forceAfter: number;
}
export function attentionWindowsFor(motion: MotionLevel, t?: AttentionTuning): AttentionWindows; // reduced uses gentle values (decision 3)
export function blockProblems(block: readonly Presentation[]): string[];   // empty when the block has a select and a pass (Req 5.4)
export function orderBlocks(blocks: readonly (readonly Presentation[])[], rng: Rng): { blocks: readonly (readonly Presentation[])[]; rng: Rng };

export interface AttentionState {
  readonly windows: AttentionWindows;
  readonly blocks: readonly (readonly Presentation[])[];
  readonly block: number;
  readonly index: number;
  readonly phase: 'starting' | 'demonstration' | 'presenting' | 'finished';  // "starting" lasts one step, which announces the first presentation
  readonly elapsedMs: number;       // session time in the current phase or presentation
  readonly mistakes: number;        // on the current presentation
  readonly selectedEarly: boolean;  // a select dwell finished before presentationMinMs
  readonly completed: number;       // presentations completed; never decreases (Req 6.7)
  readonly hint: boolean;
  readonly pending: 'forced' | 'help' | null;  // a completion waiting for presentationMinMs (see the rules)
}
export type AttentionInput =
  | { readonly kind: 'dwellSelected'; readonly stimulusId: string }  // from marrow dwell
  | { readonly kind: 'helpRequested' };                              // "Continue with help"
export type AttentionEvent =
  | { readonly kind: 'demonstrationStarted'; readonly block: number }
  | { readonly kind: 'presentationStarted'; readonly block: number; readonly index: number; readonly stimulusId: string; readonly mark: Mark }
  | { readonly kind: 'mistake'; readonly stimulusId: string; readonly count: number; readonly reason: 'windowEnded' | 'dwellOnPass'; readonly offerHelp: boolean; readonly forced: boolean }
  | { readonly kind: 'presentationCompleted'; readonly stimulusId: string; readonly byHelp: boolean }
  | { readonly kind: 'roundFinished' };
export function createAttentionRound(windows: AttentionWindows, blocks: readonly (readonly Presentation[])[]): AttentionState;
export function stepAttention(state: AttentionState, input: AttentionInput | null, dtMs: number): { state: AttentionState; events: readonly AttentionEvent[] };
export function currentPresentation(state: AttentionState): Presentation | null;
```

Rules inside `stepAttention`:

- A demonstration runs once before each block after the first. It is not a presentation and it does not count in `completed`. `helpRequested` ends it early.
- A select presentation completes when a `dwellSelected` arrives for it and `presentationMinMs` has passed. A dwell that arrives earlier is kept until the minimum passes.
- A select presentation with no dwell when `selectMs` passes is a mistake with reason `windowEnded`.
- A let-pass presentation completes when `letPassMs` passes with no `dwellSelected`. A `dwellSelected` on it during the window is a mistake with reason `dwellOnPass`.
- A mistake repeats the same presentation with `hint` set. `completed` does not change.
- The mistake that reaches `offerAfter` sets `offerHelp`. The mistake that reaches `forceAfter` sets `forced`, completes the presentation with `byHelp`, and the round continues.
- `helpRequested` completes the current presentation with `byHelp`, once `presentationMinMs` has passed.
- A forced completion (the third mistake) and a help completion wait for `presentationMinMs`, measured from the last mistake or from the start of the presentation. While they wait, `pending` is set, and `dwellSelected` and `helpRequested` are ignored and add no mistake. Then the presentation completes with `byHelp` set.
- The phase `starting` lasts one step. That step emits `presentationStarted` for the first presentation, and its `dtMs` is not counted.

- A repeat after a mistake emits no `presentationStarted`. The `mistake` event marks the repeat.
- Time model. One step makes at most one transition, in this order: (1) the clock advances by `dtMs`, and a negative or non-finite `dtMs` counts as 0; (2) timeouts run: a let-pass whose window has ended completes, and a select whose window has ended with no dwell held is a `windowEnded` mistake; (3) the input is judged at the clock time after step 2, and a `dwellSelected` on the current let-pass inside its window is a `dwellOnPass` mistake; (4) a held select dwell, or a help or forced completion, completes once the clock is at or past `presentationMinMs`. A timeout or mistake that ends the step ignores the input of that step. Time left over after a transition is dropped, and the next presentation starts at zero.
- A `dwellSelected` in the step that ends a let-pass window is ignored, so a dwell at the exact end of the window is not a mistake.
Must not: read the stimulus id, use the rule, read the clock or call the help policy. The caller maps the events to help events (section 3).

### 2.4 `marrow/challenges/placementBand.ts`

```ts
export interface BandInput { readonly slots: readonly Vec2[]; readonly n: number; readonly r: number; readonly m: number }
export interface BandPlacement { readonly result: PlacementResult; readonly bandSlotsUsed: number }
export function inRestingBand(slot: Vec2, r: number, mapping: Mapping, bandY: number): boolean;
export function planPlacement(input: BandInput, grids: WristGrids, mapping: Mapping, tuning: Tuning, bandY: number): BandPlacement;
```

`m` (the parallax margin) comes from the app, because `marrow` may not import `world-view`.

Algorithm:

1. Split the slots into out-of-band slots and band slots. A band slot is one whose lowest hit-circle point, `mapping.toCamera({x, y + r}).y`, is at least `bandY`.
2. Run `placeTargets` on the out-of-band slots. If the result is `simultaneous`, use it and `bandSlotsUsed` is 0.
3. Otherwise add band slots one at a time, nearest to the band's upper edge first (smallest camera y of the slot's top point). Stop at the first count that gives `simultaneous`. If none does, use all of them.

Must not: change `placeTargets`. The caller gets `none` when no slot can be used at all, and then shows "Retry calibration" (Req 10.6).

### 2.5 `marrow/sim`

```ts
// tuning.ts
export type ProfileName = 'baseline' | 'limited-reach' | 'jitter' | 'slow' | 'one-hand' | 'tracking-gaps' | 'incorrect-answers' | 'adversarial';
export interface SimProfile {
  readonly name: ProfileName;
  readonly wrongAnswerRate: number;        // per presentation: 0, 0.1, 0.1, 0.2, 0.1, 0.1, 0.5, 1.0 (Req 19.6)
  readonly reachShare: number;             // share of the frame the synthetic reach covers
  readonly jitterShare: number;            // amplitude of pointer noise, share of the frame
  readonly frameIntervalMs: number;        // about 50 ms, or about 143 ms for slow
  readonly oneHand: boolean;
  readonly trackingGap: { readonly everyMs: number; readonly lengthMs: number } | null;
}
export const SIM_PROFILES: readonly SimProfile[];
export function validateSimTuning(profiles: readonly SimProfile[]): string[];

// player.ts
export function chooseFor(profile: SimProfile, rng: Rng, mark: Mark): { readonly dwell: boolean; readonly wrong: boolean; readonly rng: Rng };
export function framesFor(profile: SimProfile, rng: Rng, slotCamera: Vec2 | null, span: { readonly startMs: number; readonly endMs: number }): { readonly frames: readonly PoseFrame[]; readonly rng: Rng };

// calibrationSweep.ts
export function sweepSamples(profile: SimProfile, rng: Rng, count: number): { readonly samples: readonly Vec2[]; readonly rng: Rng };

// invariants.ts
export interface InvariantLog { readonly checks: number; readonly violations: readonly string[] }
export function checkInvariant(log: InvariantLog, name: string, holds: boolean, detail: () => string): InvariantLog;

// report.ts
export interface RunSummary { readonly profile: ProfileName; readonly seed: number; readonly completed: boolean; readonly helpStepsUsed: number; readonly violations: readonly string[] }
export function formatReport(runs: readonly RunSummary[], baseSeed: number): string;
export function exitCodeFor(runs: readonly RunSummary[]): 0 | 1;
```

Owns: profile data, seeded choices, synthetic frames, invariant bookkeeping, report text. Must not: name a stage or any story content (the lint rule for `packages/` enforces this), call the session, or print. The app script prints.

### 2.6 App session: `session/machine.ts`

```ts
export type StageId = 'lantern-glade' | 'whisper-glade' | 'whisper-hall' | 'bloom';   // stageOrder.ts
export type JourneyId = 'journeyA' | 'journeyB' | 'doorHall' | 'doorGarden';
export const ROUTE: readonly RouteStep[]; // stage, journey, stage, journey, door, stage, door, stage
export type JourneySegments = Readonly<Record<JourneyId, TravelSegment>>;
export type TitleId = 'lantern' | 'hall';
export const TITLE_OF: Readonly<Partial<Record<StageId, TitleId>>>; // stageOrder.ts: lantern-glade has the lantern title, whisper-hall the hall title
export type Phase = 'SETUP' | 'CALIBRATING' | 'ENTERING' | 'PLAYING' | 'CELEBRATING' | 'TRAVELLING' | 'BLOOM' | 'SAVED';
export interface Suspension { readonly paused: boolean; readonly holdActive: boolean }

export interface SessionState {
  readonly phase: Phase;
  readonly stage: StageId | null;     // the active stage; changes only on a transition
  readonly done: readonly StageId[];  // each stage at most once
  readonly step: number;              // index into ROUTE
  readonly timerMs: number;           // session time left in ENTERING or CELEBRATING
  readonly travel: TravelState | null;
  readonly segments: JourneySegments;  // given to createSession; the state stays plain data
}
export type SessionEvent =
  | { readonly kind: 'setupDone' }                           // SETUP to CALIBRATING
  | { readonly kind: 'calibrated' }
  | { readonly kind: 'startAt'; readonly stage: StageId }     // ?start shortcut, simulated mode; accepted in SETUP and CALIBRATING
  | { readonly kind: 'stageCompleted'; readonly stage: StageId }
  | { readonly kind: 'endCardShown' };
export interface SessionInput { readonly dtMs: number; readonly motion: MotionLevel; readonly suspension: Suspension }
export type SessionEffect =
  | { readonly kind: 'stageActivated'; readonly stage: StageId }
  | { readonly kind: 'rewardStarted'; readonly stage: StageId }
  | { readonly kind: 'travelStarted'; readonly journey: JourneyId }
  | { readonly kind: 'titleShown'; readonly title: 'lantern' | 'hall' }
  | { readonly kind: 'ignored'; readonly reason: 'phase' | 'stage' | 'done' | 'suspended' };   // events rejected by the rules below
export function createSession(segments: JourneySegments): SessionState;
export function stepSession(state: SessionState, event: SessionEvent | null, input: SessionInput): { state: SessionState; effects: readonly SessionEffect[] };
export function targetsActive(state: SessionState): boolean;   // true only in PLAYING and BLOOM, after travel has arrived
```

Rules:

- `stageCompleted` is accepted only in `PLAYING` or `BLOOM`, for the active stage, with no suspension flag set, and only if the stage is not in `done`. Anything else is an `ignored` effect with no state change (Req 1.3, 1.4). The reason is the first failed check, in this order: `phase`, `stage`, `done`, `suspended`.
- Suspension flags are read from `input` each step. They never change `stage` (Req 1.5).
- Time: a step first checks its event. A step that makes a transition adds no time. Otherwise the `ENTERING` and `CELEBRATING` timers and the travel advance by `dtMs`, unless a suspension flag is set. A `dtMs` that is not finite or is 0 or less adds no time to the timers, the same rule as `stepTravel`. The machine applies the flags itself, so it does not depend on the driver sending zero.
- `CELEBRATING` lasts `rewardToTravelMs`, then `TRAVELLING` starts its journey. The `travel` field is a world-view `TravelState`, advanced with `stepTravel(travel, { dtMs, paused, motion }, worldViewTuning)`.
- `PLAYING` or `BLOOM` starts when travel arrives. Targets become active only in `PLAYING` and `BLOOM`, and only when travel has arrived (`targetsActive`, Req 2.7).
- `BLOOM` completion moves to `SAVED`, which shows the end card (Req 9.3).
- `setupDone` moves `SETUP` to `CALIBRATING`. `startAt` is accepted in `SETUP` and in `CALIBRATING`, skips calibration, and uses simulated input with the whole frame as reach (Req 20.2, 20.3).
- `createSession(segments)` stores the segments in the state. `stepSession` reads `segments[journey]` when a travel starts.
- `ENTERING` lasts `entryTitleMs` (the app value in `session/tuning.ts`) and holds lantern-glade until its entry title has faded. The whisper-hall title does not hold back play.
- `titleShown` is emitted in the same step as `stageActivated`, for a stage that has an entry in `TITLE_OF`. The title is not a gate: only the lantern-glade entry waits for its title.

Must not: call travel with wall-clock time, read the session or presence clock itself, or know what the stages contain.

### 2.7 Stage rules (`stages/*/rules.ts`)

```ts
// lantern-glade
export function createLanternGlade(content: LanternGladeContent, placed: PlacedRound, motion: MotionLevel): LanternState;
export function stepLanternGlade(state: LanternState, selectedTargetIds: readonly string[], dtMs: number): { state: LanternState; completed: boolean; note: string | null; patch: number | null };
export function lightLevel(state: LanternState): number;   // 0..1, eased over TUNING.uiMinLightEaseMs, steady in reduced

// whisper-glade
export function startWhisperGlade(content: WhisperGladeContent, rng: Rng, motion: MotionLevel): { state: WhisperState; rng: Rng };
export function stepWhisperGlade(state: WhisperState, selectedTargetIds: readonly string[], dtMs: number): { state: WhisperState; events: readonly AttentionEvent[]; completed: boolean };
export function pathChoice(state: WhisperState, option: 'fireflies' | 'candles'): WhisperState;

// whisper-hall, bloom (placeholders; placement is wired by the driver in a later task, so no PlacedRound here)
export function createPlaceholder(content: PlaceholderContent): PlaceholderState;
export function stepPlaceholder(state: PlaceholderState, selectedTargetIds: readonly string[]): { state: PlaceholderState; completed: boolean };
```

Owns: the content's meaning for each stage. Must not: read help levels, call placement, read the clock, or contain text. Every line is a copy key looked up by the driver.

### 2.8 `session/roundSnapshot.ts` and `stages/shared/placeRound.ts`

```ts
// roundSnapshot.ts: the only file that reads HelpState.motorLevel or cognitiveLevel
export interface RoundSnapshot { readonly motorLevel: number; readonly cognitiveLevel: number; readonly radius: number }
export function snapshotRound(help: HelpState, tuning: Tuning): RoundSnapshot;

// placeRound.ts
export interface PlacedRound { readonly kind: 'simultaneous' | 'sequential' | 'none'; readonly points: readonly WorldPoint[]; readonly snapshot: RoundSnapshot; readonly bandSlotsUsed: number }
export function placeRound(input: {
  readonly worldSlots: readonly WorldPoint[];   // authored candidates on the interaction layer
  readonly n: number;
  readonly help: HelpState;                      // read only through snapshotRound
  readonly grids: WristGrids;
  readonly mapping: Mapping;
  readonly view: View;
  readonly frame: ProjectionFrame;
  readonly layer: LayerRef;
  readonly bandY: number;
  readonly core: Tuning;
}): PlacedRound;
```

`placeRound` projects slots with `worldToScreen`, calls `planPlacement`, and maps the chosen screen objects back to their world points by object identity. The placement result keeps the caller's objects, so no inverse projection is needed.

### 2.9 `scene/spriteSlot.ts`

```ts
export type SpriteName = 'lantern-unlit' | 'lantern-lit' | 'spirit-blue' | 'spirit-gold' | 'hall-door-frame' | 'hall-door-leaf';   // file names of art-and-motion.md
export interface SpriteSlot { readonly name: SpriteName; readonly drawable: ShapeSpec[] }
export function spriteSlot(name: SpriteName): SpriteSlot;   // placeholder shapes today; a PNG source later
```

Stage code asks for a name and never looks at the source. Replacing a placeholder changes only the registry (Req 22.4).

### 2.10 Audio

```ts
// pentatonic.ts
export const LANTERN_NOTES = ['C4', 'D4', 'E4', 'G4'] as const;   // one per lantern, C major pentatonic
export function noteHz(name: (typeof LANTERN_NOTES)[number]): number;

// gardenAudio.ts
export interface GardenAudio { start(): void; playNote(index: number): void; setMuted(muted: boolean): void; setVolume(volume: number): void; dispose(): void }
export function createGardenAudio(player: TonePlayer): GardenAudio;
```

`start()` is called only from the Start handler (Req 18.2). `tonePlayer.ts` gets `playFrequency(hz)` next to `playTarget`. The playground keeps its tones and its tests.

### 2.11 Copy

```ts
// garden.ts
export const GARDEN_COPY = { home: { start: 'Start', noCamera: 'Try without camera' }, /* every key in requirements section 14 */ } as const;
export type GardenCopyKey = /* dotted paths derived from GARDEN_COPY */ string;
// gardenMarrowCopy.ts
export const gardenMarrowCopy: MarrowCopy;   // fills camera.explanation from camera.why, and so on
```

The copy test reads `GARDEN_COPY` and `gardenMarrowCopy`. Content files name keys. They hold no text.
Fields with no Requirement 14 key reuse the infrastructure strings of `copy.marrow`; only fields with a key come from `GARDEN_COPY`.

## 3. Data flow in one frame

One animation frame runs these steps in order. `[HELP READ]` and `[BAND]` mark the two rules that the spec puts in the app.

1. **Input.** `PoseSource.latest()` returns a frame, or null. Camera, pointer and synthetic sources all produce `PoseFrame`. A frame is new when its reference differs from the last one consumed.
2. **Clocks and tracking.** `presenceDt = presenceDelta(rawDt, {paused, hidden}, tuning)`. `stepTracking(state, {wristValid, noseValid, calibrating}, presenceDt)` gives the hold flag. `sessionDt = sessionDelta(presenceDt, holdActive)`.
3. **Pointers.** In camera mode: `stepPointerFilter`, then `makeMapping` with the calibration transform. In simulated mode the pointer source already gives the frame, and the whole-screen transform applies.
4. **View.** `stepHeadView` (presence dt), `stepGlide`, then `stepLock` with `lockRequested` taken from `dwellView`. The travel distance comes from `stepTravel` (session dt) when the phase is `TRAVELLING`.
5. **Placement at round start.** `placeRound` runs when a round starts, after the event that starts it reaches the help policy. It calls `snapshotRound`. `[HELP READ]` happens here and nowhere else. `planPlacement` applies the resting band. `[BAND]`
6. **Targets.** A target is active only when the phase is `PLAYING` or `BLOOM`, and travel has arrived. The scene receives active ids through `FrameData.active`. `sceneManager.hitCircles()` gives the screen circles.
7. **Dwell.** `stepDwell(state, {dt: presenceDt, pointers, hitAreas})` returns `selected` events. A dwell on a let-pass stimulus is a mistake for the attention round, not a dwell fact.
8. **Stage rules.** The stage rule takes the selected ids and `sessionDt`. The attention round also turns events into help events, in this order: `roundStarted` (steps 1) when the presentation starts, `difficulty` for each mistake, then `stepCompleted` or `continueWithHelp`, then `roundEnded` with `motorStepAllowed`. `playbackActive` is true during a demonstration.
9. **Session machine.** A stage that reports completion sends `stageCompleted`. `stepSession` decides the transition, which the suspension flags can block.
10. **View.** React shows the one instruction line and the help offer from `offerHelp` outputs. Pixi draws the frame data. Nothing in the view writes to the state.

## 4. Stage content

### 4.1 Shapes

Content holds ids, positions and counts. It never holds text: each line is a key that `copy/garden.ts` must contain.

`stages/lantern-glade/content.json`
```json
{
  "version": 1,
  "id": "lantern-glade",
  "lanterns": 4,
  "notes": ["C4", "D4", "E4", "G4"],
  "slots": [{ "x": 0.8, "y": 0.5, "depth": 6, "anchor": 1 }, { "x": 1.2, "y": 0.5, "depth": 6, "anchor": 1 }],
  "copy": { "first": "lantern.first", "next": "lantern.next" }
}
```

`stages/whisper-glade/content.json`
```json
{
  "version": 1,
  "id": "whisper-glade",
  "spirits": [{ "stem": "blueDrop", "colour": "spiritBlue", "shape": "drop" }, { "stem": "goldLeaf", "colour": "spiritGold", "shape": "leaf" }],
  "blocks": [
    { "select": "blueDrop", "pass": "goldLeaf", "marks": ["select", "select", "pass"] },
    { "select": "goldLeaf", "pass": "blueDrop", "marks": ["select", "pass", "pass"] }
  ],
  "spiritSlots": [{ "x": 0.6, "y": 0.5, "depth": 6, "anchor": 1 }, { "x": 1.4, "y": 0.5, "depth": 6, "anchor": 1 }],
  "pathSlots": { "fireflies": { "x": 0.2, "y": 0.5, "depth": 6, "anchor": 1 }, "candles": { "x": 1.8, "y": 0.5, "depth": 6, "anchor": 1 } }
}
```

The copy key for a line is built from the stem: `whisper.select.<select stem>`, `whisper.pass.<pass stem>`, `mistake.select.<select stem>`, `mistake.pass.<pass stem>`. Block one uses blueDrop as select, and block two uses goldLeaf (Req 5.8).

The whisper-hall and bloom files have one `target` with `slots` and a `copy` key. Placeholder copy keys (task 3): `lantern.first` for lantern-glade, `whisper.select.blueDrop` for whisper-glade, `hall.target` for whisper-hall and `bloom.target` for bloom. All four are in requirements section 14. Journey segments sit in `journeys/segments.json`:

```json
{ "version": 1, "segments": [
  { "id": "journeyA", "kind": "journey", "from": 0, "to": 8, "durationMs": 6000 },
  { "id": "journeyB", "kind": "journey", "from": 8, "to": 16, "durationMs": 6000 },
  { "id": "doorHall", "kind": "door", "from": 16, "to": 17, "durationMs": 3000 },
  { "id": "doorGarden", "kind": "door", "from": 17, "to": 18, "durationMs": 3000 }
] }
```

### 4.2 Validation

Each stage has `content.ts`, which exports `validateX(json: unknown): ContentResult` and `loadX(json: unknown): X`. `ContentResult` is `{ ok: true, value } | { ok: false, issues: { path: string; message: string }[] }`. The validator never throws. `loadX` throws once, at startup, with all issues joined. Issue text is developer text and stays in `content.ts`, as `worldContent.ts` does.

Checks per stage:

- `version === 1`, `id` equals the stage id.
- Counts are integers in range. The lantern count is 4. Whisper-glade has 2 spirits and 2 blocks of 3 marks.
- Every block has at least one `select` and one `pass` (`blockProblems`). Both stems exist among the spirits, and `select` differs from `pass`.
- Every `slots` entry has finite numbers. The slot count is at least the target count.
- Every copy key exists in `GARDEN_COPY`.
- Journey segments pass world-view `validateSegment` with the shipped `world-view` tuning. Door durations equal `doorMs`. The `from` and `to` values chain: `journeyA.from` equals lantern exit, and each `to` equals the next `from`.
- Depth scaling passes `checkDepthScaling` against the forest layer table.

### 4.3 Contract test

Each stage ships one `content.test.ts`, built on `stages/shared/contract.ts`, with these cases:

1. The shipped JSON validates.
2. Each of the mutations below fails with an issue whose `path` names the field: missing `id`, wrong `version`, a block with no pass, an unknown spirit stem, a copy key not in `GARDEN_COPY`, a non-finite coordinate, too few slots.
3. `loadX` throws with the issue text for an invalid input.
4. The stage rule runs from the content with seed 42 and reaches `completed`.
5. Every key the stage uses exists in `GARDEN_COPY`, and every line is eight words or fewer, except `camera.why`.

## 5. Simulator

### 5.1 Location

The pieces that do not depend on the game live in `packages/marrow/src/sim`: profiles, seeded choices, synthetic frames, calibration samples, invariant log and report text. The script that wires them to the real session lives in `apps/garden-of-echoes/src/dev/simulate/`, because it runs `session/` and `stages/`. `marrow` never imports it.

### 5.2 Wiring

`runSession(profile, seed, { maxSteps })` does this:

1. Creates a calibration with `createCalibration`, then feeds `sweepSamples` through `stepCalibration` until `completed`. The real calibration code runs. With `reachShare` below 1, the sweep covers only part of the frame.
2. Runs `startAt` or the normal route through `stepSession`, with `dtMs` set to 50 for each step and `motion` set to full.
3. For each presentation, `chooseFor` decides on dwell and wrong answer. `framesFor` builds frames. The frames go to a `PoseSource` object whose `latest()` returns the current one.
4. Calls `planPlacement`, `stepDwell`, `stepAttention` and `stepHelp` through the same `stageDriver` that the app uses.
5. Checks invariants after each step with `checkInvariant`: one transition per stage, no completion under a suspension flag, no target active before travel stops, no slot in the band unless needed, and help levels unchanged between round start and round end.
6. Stops at `maxSteps`. A run that does not reach `SAVED` counts as not completed.

The `adversarial` profile has a wrong-answer rate of 1.0, so every presentation needs help. The run must finish inside the step budget.

### 5.3 Root script

`package.json` (root) gets `"simulate": "node apps/garden-of-echoes/src/dev/simulate/run.mjs"`. `run.mjs` creates a Vite server with `root` set to the app, loads `cli.ts` through `server.ssrLoadModule`, and calls its `main(argv)`. The script uses Vite, which is already installed. Node's type stripping cannot resolve the extensionless imports in the packages, so this loader is needed without a new dependency.

The app package gets the same script, `"simulate": "node src/dev/simulate/run.mjs"`, so `npm run simulate -w garden-of-echoes` works too. `packages/marrow/package.json` loses its `simulate` stub.

### 5.4 Output and exit code

`npm run simulate -- --seed 42 --runs 50` runs every profile `--runs` times, starting from `--seed`. Run `k` uses seed `seed + k`. The report prints for each profile: runs completed, help steps used, invariant violations, and the seeds of failing runs. Exit code is 0 when every run completes with no violation, and 1 otherwise. Invalid arguments exit with 2.

## 6. Traceability

Test files are new unless marked "extended" or "existing". Paths are relative to the repo root.

| Req | Module | Test type | Test file |
|---|---|---|---|
| 1 | session/machine.ts | Property, unit | apps/garden-of-echoes/src/session/machine.properties.test.ts, machine.test.ts |
| 2 | journeys/journeys.ts, session/machine.ts | Unit | apps/garden-of-echoes/src/journeys/journeys.test.ts; target flag in session/machine.test.ts |
| 3 | ui/Home.tsx, marrow/react | Unit, Playwright | apps/garden-of-echoes/src/ui/Home.test.tsx; tests/e2e/garden-level.spec.ts |
| 4 | stages/lantern-glade/rules.ts | Unit, simulation | stages/lantern-glade/rules.test.ts; dev/simulate/runSession.test.ts |
| 5 | stages/whisper-glade/rules.ts | Property | stages/whisper-glade/rules.properties.test.ts (seeded checks for 5.4, 5.5, 5.8) |
| 6 | challenges/attention.ts | Property, grep | packages/marrow/src/challenges/attention.properties.test.ts; tests/noTimingLiterals.test.ts |
| 7 | challenges/attention.ts, stageDriver.ts | Property, simulation | attention.properties.test.ts (adversarial bound); dev/simulate/runSession.test.ts |
| 8 | stages/whisper-glade/pathChoice.ts | Unit | stages/whisper-glade/pathChoice.test.ts |
| 9 | stages/whisper-hall, bloom, ui/EndCard.tsx | Unit, Playwright | stages/whisper-hall/rules.test.ts; stages/bloom/rules.test.ts; ui/EndCard.test.tsx; tests/e2e/garden-level.spec.ts |
| 10 | challenges/placementBand.ts, shared/placeRound.ts | Property | packages/marrow/src/challenges/placementBand.properties.test.ts; stages/shared/placeRound.test.ts |
| 11 | ui/CalibrationExplainer.tsx | Unit | apps/garden-of-echoes/src/ui/CalibrationExplainer.test.tsx; contrast in ui/theme.contrast.test.ts (existing) |
| 12 | session/roundSnapshot.ts | Unit | apps/garden-of-echoes/src/session/roundSnapshot.test.ts (mid-round change) |
| 13 | ui/PlayArea.tsx | Unit, Playwright | apps/garden-of-echoes/src/ui/PlayArea.test.tsx; tests/e2e/garden-level.spec.ts (touch move) |
| 14 | copy/garden.ts | Unit | apps/garden-of-echoes/src/copy/copy.test.ts (extended) |
| 15 | ui/InstructionLine.tsx | Unit | apps/garden-of-echoes/src/ui/InstructionLine.test.tsx |
| 16 | session/lowRate.ts | Property, simulation | apps/garden-of-echoes/src/session/lowRate.test.ts; dev/simulate/runSession.test.ts (slow) |
| 17 | stages/lantern-glade/rules.ts, scene/flicker | Unit | stages/lantern-glade/light.test.ts; scene/flicker.test.ts; ui/PauseScreen.test.tsx |
| 18 | audio/gardenAudio.ts, pentatonic.ts | Unit, Playwright | audio/gardenAudio.test.ts; tests/e2e/garden-level.spec.ts (muted run) |
| 19 | marrow/sim, dev/simulate | Simulation, unit | apps/garden-of-echoes/src/dev/simulate/runSession.test.ts; cli.test.ts; packages/marrow/src/sim/report.test.ts |
| 20 | session/stageOrder.ts | Unit, Playwright | apps/garden-of-echoes/src/session/stageOrder.test.ts; tests/e2e/garden-level.spec.ts |
| 21 | ui/Home.tsx, index.html | Unit, repo test | ui/Home.test.tsx (camera not requested before Start); tests/content-security-policy.test.ts (extended) |
| 22 | scene/spriteSlot.ts | Unit, repo check | apps/garden-of-echoes/src/scene/spriteSlot.test.ts; tests/no-image-files.test.ts (new) |
| 23 | all pure folders | Repo tests, unit | tests/dependency-graph.test.ts (existing); tests/core-no-wall-clock.test.ts (extended); tests/garden-tuning-labels.test.ts (new); session/tuning.test.ts |
| 24 | ui/*.tsx | Unit, Playwright | apps/garden-of-echoes/src/ui/controls.test.tsx; tests/e2e/garden-level.spec.ts (keyboard) |

Requirement 23.4 (no new dependencies) is checked by reviewing `package.json` in the diff, not by a test.

## 7. Public-API audit: marrow-input and world-view

### 7.1 Gaps

Each gap is listed, not patched. The app works around each one as stated.

**G1. Help levels can change mid-round (known gap).** `HelpState.motorLevel` and `cognitiveLevel` are plain fields, readable at any time. `stepHelp` applies a deferred change at the next event with no dwell and no playback (rule 19.8), and that event can fall inside a round. *App:* the level is read only in `snapshotRound`, called once when a round is placed. The test in `roundSnapshot.test.ts` changes both levels in the middle of a round and checks the snapshot.

**G2. Help counts difficulties per round, and the spec counts per presentation.** Requirement 7.3 offers help after two mistakes on one presentation. `stepHelp` offers help after two difficulties in one round (rule 19.3). *App:* each presentation is one help round (`roundStarted` with steps 1). Side effect: rule 19.4 raises a level after any presentation with two mistakes. Decision 2.

**G3. No forced completion.** `continueWithHelp` reveals one step on request. Nothing in the policy completes a step after a count of mistakes (Req 7.4). *App:* `attention.ts` counts mistakes and marks the third as `forced`. The driver then sends `continueWithHelp` to the policy.

**G4. `placeTargets` has no resting-band input.** It returns `simultaneous`, `sequential` or `none` with no band rule (Req 10.3, 10.5). *App:* `planPlacement` in `marrow/challenges` wraps it. Core stays unchanged.

**G5. The calibration screen has no progress ring and shows no time.** `CalibrationScreen` draws the aura, orbs and messages only (Req 11.2). The sentence `calibrate.edge` (Req 11.3) has no slot. *App:* `CalibrationExplainer.tsx` draws the ring from `calibration.paintingMs` and `TUNING.calibNominalMs`, and renders the sentence beside the screen.

**G6. `PauseOverlay` offers resume, recalibrate and exit only.** It lacks motion, sound, "Continue with help" and restart (Req 24.4). *App:* `PauseScreen.tsx` composes `MotionSetting` and `AudioSettings`, which take no props, with its own buttons.

**G7. `StartScreen` offers only Start.** Home needs "Try without camera" too (Req 3.1). *App:* `Home.tsx` has its own two DOM buttons. `CameraPermissionScreen` already offers "Try without camera" for the failure case.

**G8. `marrow/react` does not export its primitives.** `Button`, `Panel`, `InstructionLine`, `RadioGroup`, `Slider` and `CheckBox` are in `primitives.tsx` but not in the entry point. *App:* the app writes its own DOM controls with a visible focus ring, and adds an accessible name to each.

**G9. No delivered-rate helper.** `PoseSource` exposes `latest()` only. `ratePerSecond` lives in `marrow/react/debugRates.ts` and is not exported. *App:* `lowRate.ts` counts new frames by reference, in buckets of presence time. It does not read `PoseFrame.t`, since pure logic must not read it as a clock.

**G10. `smootherstep` is not exported.** It is in `world-view/src/core/ease.ts`, but the entry point does not export it. *App:* `lightLevel` uses its own short smootherstep function over `TUNING.uiMinLightEaseMs`. The app does not import the deep path.

**G11** is in section 9.

**G12. Repo tooling does not cover the new pure code.** `eslint.config.js` has pure-zone rules for `marrow/core`, `challenges`, `sim` and `world-view/core`, but none for `apps/garden-of-echoes/src/session`. `tests/core-no-wall-clock.test.ts` scans only the two `core` folders. *App:* add the session and stage-rule files to the pure zone, and extend the wall-clock test to `challenges`, `sim` and `session`. Decision 7.

### 7.2 Calls the app and the simulator make

| Area | Exported names used |
|---|---|
| marrow/core, clocks and tracking | `presenceDelta`, `sessionDelta`, `stepClocks`, `createTracking`, `stepTracking` |
| marrow/core, calibration | `createCalibration`, `stepCalibration`, `retryCalibration`, `chooseWholeScreen`, `skipHeadView`, `computeComfortTransform` |
| marrow/core, comfort and mapping | `makeMapping`, `createGrid`, `addSample`, `markAllValid`, `isCellValid`, `auraIntensity` |
| marrow/core, pointers and head | `createPointerFilter`, `stepPointerFilter`, `resetPointerFilter`, `createHeadView`, `stepHeadView` |
| marrow/core, placement and dwell | `placeTargets`, `isSlotUsable`, `createDwell`, `stepDwell`, `dwellView` |
| marrow/core, help and settings | `createHelp`, `stepHelp`, `helpRadiusForMotorLevel`, `parseSettings`, `serializeSettings`, `DEFAULT_SETTINGS` |
| marrow/core, tuning | `TUNING`, `validateTuning`, `formatTuningErrors` |
| marrow/input | `createCameraSource`, `createPointerSource`, `PoseSource`, `StartOutcome` |
| marrow/react | `createSettingsStore`, `MarrowCopyProvider`, `SettingsProvider`, `useSettings`, `MotionSetting`, `AudioSettings`, `SimulatedInputLabel`, `CameraPermissionScreen`, `HandChoiceScreen`, `CameraPreview`, `CalibrationScreen`, `TrackingLostOverlay` |
| world-view | `worldToScreen`, `screenToWorld`, `targetScreen`, `parallaxMargin`, `createGlide`, `stepGlide`, `createLock`, `stepLock`, `createTravel`, `startTravel`, `stepTravel`, `validateSegment`, `checkDepthScaling`, `validateLayerTable`, `resolveLayerTable`, `TUNING`, `validateTuning`, `motionProfile` |
| world-view/pixi | `createSceneManager` and its `start`, `dispose`, `hitCircles`, `setTargets`, `setTargetColour`, `projectionFrame`, `canvasSize` |

Verified as used as written: `PoseSource.dispose()` stops every camera track (`cameraSource.ts`, the `getTracks().stop()` call). The scene manager sets `host.style.touchAction = 'none'` (`sceneManager.ts`, line 257). The travel engine's durations, Gentle multiplier and cross-fade come from `world-view` tuning: journeys 5000 to 7000 ms, doors 3000 ms, Gentle 1.3, cross-fade 1500 ms.

## 8. Decisions

Accepted: every recommendation in the previous version of this section. The details below are binding for `requirements.md` and this design.

1. The placement band wrapper lives in `marrow/challenges/placementBand.ts`.
2. Each presentation is one help round. A select window that ends without a dwell is a `motor` difficulty. A dwell on a let-pass stimulus is a `cognitive` difficulty, and the cognitive level has no effect in this spec. A presentation with two mistakes raises a level (marrow rule 19.4).
3. Reduced motion uses the Gentle attention windows (Requirements 6.5 and 6.6).
4. The copy key `bloom.target` is "Hold your light on the bloom.", used for the Bloom target (Requirements 9.2 and 14).
5. `npm run simulate` runs through Vite's SSR loader (section 5.3). No new dependency.
6. The low-rate hint values live in `session/tuning.ts` (Requirement 16.3 and the tuning table).
7. The lint pure zone covers `apps/garden-of-echoes/src/session` and the stage rules. The wall-clock test covers `challenges`, `sim` and `session`.
8. The eight per-rule copy keys and `pause.help` are approved.

## 9. Handoff to the art and interface pass

**G11. `world-view/pixi` has no texture port.** `GraphicsLike` draws shapes only, so the sprite slot returns `ShapeSpec` placeholders in this spec. Replacing a placeholder with the owner's PNG file needs a texture port in `world-view/pixi`. That is a public-API change to `world-view`. It needs the owner's approval in the art pass, and this spec does not make it.

The owner's art arrives between 2026-11-26 and 2026-11-29. The slot names in section 2.9 are the file names of `art-and-motion.md`, so the files drop in by name.
