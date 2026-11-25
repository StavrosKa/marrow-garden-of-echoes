// The per-frame glue (design 3 steps 5 to 8; requirements 1.3, 1.4, 2.7, 4, 7, 10, 12.1, 19). The tests run the real
// session machine, the real lantern rule and the real placeRound, with whole-frame simulated reach. Time is given as
// frame deltas of marrow's maxClockStepMs, so the dwell and the entry title take their real number of frames.
import {
  createHeadView,
  createHelp,
  helpRadiusForMotorLevel,
  stepHeadView,
  TUNING,
  type PointerInput,
  type Vec2,
} from 'marrow/core';
import { ATTENTION_TUNING, type AttentionEvent } from 'marrow/challenges';
import { TUNING as WORLD_TUNING, targetScreen, type LayerRef, type WorldPoint } from 'world-view';
import { INTERACTION_LAYER } from '../scene/forestLayers';
import { placeRound } from '../stages/shared/placeRound';
import { describe, expect, it } from 'vitest';
import { loadSegments } from '../journeys/journeys';
import segmentsJson from '../journeys/segments.json';
import { loadLanternGlade } from '../stages/lantern-glade/content';
import lanternJson from '../stages/lantern-glade/content.json';
import { loadWhisperGlade } from '../stages/whisper-glade/content';
import whisperGladeJson from '../stages/whisper-glade/content.json';
import { loadWhisperHall } from '../stages/whisper-hall/content';
import whisperHallJson from '../stages/whisper-hall/content.json';
import { loadBloom } from '../stages/bloom/content';
import bloomJson from '../stages/bloom/content.json';
import {
  activeHitAreas,
  applyHelp,
  createGarden,
  placeholderLayerOf,
  placeholderPointOf,
  drawnTargetsOf,
  helpEventsOf,
  instructionKeyOf,
  playbackAfter,
  stepGarden,
  type GardenEffect,
  type GardenEnv,
  type GardenFrame,
  type GardenState,
} from './stageDriver';
import { SIMULATED_WRISTS, wholeFrameReach } from './wholeFrame';

const ASPECT = 16 / 9;
const FRAME_MS = TUNING.maxClockStepMs;
const reach = wholeFrameReach(ASPECT);
const env: GardenEnv = {
  content: {
    lantern: loadLanternGlade(lanternJson),
    whisper: loadWhisperGlade(whisperGladeJson),
    placeholders: {
      'whisper-hall': loadWhisperHall(whisperHallJson),
      bloom: loadBloom(bloomJson),
    },
  },
  reach: { grids: reach.grids, activeWrists: SIMULATED_WRISTS, mapping: reach.mapping, frame: { aspect: ASPECT, sceneScale: 1 } },
};
const segments = loadSegments(segmentsJson);
const NO_SUSPENSION = { paused: false, holdActive: false } as const;
const PAUSED = { paused: true, holdActive: false } as const;
const HELD = { paused: false, holdActive: true } as const;

function frame(over: Partial<GardenFrame> = {}): GardenFrame {
  return { event: null, presenceDt: FRAME_MS, sessionDt: FRAME_MS, motion: 'full', suspension: NO_SUSPENSION, pointers: [], ...over };
}

/** The state after the session starts Lantern Glade and its entry title has run out. */
function lanternInPlay(): GardenState {
  let state = stepGarden(env, createGarden(segments), frame({ event: { kind: 'startAt', stage: 'lantern-glade' } })).state;
  while (state.session.phase === 'ENTERING') state = stepGarden(env, state, frame()).state;
  return state;
}

/** The pointer that dwells on the one active lantern, or none when no lantern is active. */
function pointerOnActive(state: GardenState): PointerInput[] {
  const area = activeHitAreas(state, env.reach.frame)[0];
  return area === undefined ? [] : [{ wrist: 'right', valid: true, pos: area.centre }];
}

/** The active lantern is selected by a dwell. Returns the state and every effect of the frames it took. */
function selectActiveLantern(state: GardenState): { state: GardenState; effects: GardenEffect[] } {
  const before = state.stage?.kind === 'lantern' ? state.stage.rule.next : -1;
  let current = state;
  const effects: GardenEffect[] = [];
  for (let i = 0; i < 100; i++) {
    const step = stepGarden(env, current, frame({ pointers: pointerOnActive(current) }));
    effects.push(...step.effects);
    current = step.state;
    const after = current.stage?.kind === 'lantern' ? current.stage.rule.next : before;
    if (after !== before) return { state: current, effects };
  }
  throw new Error('the active lantern was not selected');
}

/** The number of reward effects in a list. A stage completes into exactly one reward (Req 1.3). */
function rewardsIn(effects: readonly GardenEffect[]): number {
  return effects.filter((effect) => effect.kind === 'session' && effect.effect.kind === 'rewardStarted').length;
}

/** An attention event for the tests of the help mapping. */
const presented: AttentionEvent = { kind: 'presentationStarted', block: 0, index: 0, stimulusId: 'blue-drop', mark: 'select' };

describe('the help events of an attention round', () => {
  const flags = { dwellActive: false, playbackActive: false };

  it('7 9.1: one presentation maps to roundStarted, the mistake, stepCompleted and roundEnded, in that order', () => {
    const events: AttentionEvent[] = [
      presented,
      { kind: 'mistake', stimulusId: 'blue-drop', count: 1, reason: 'windowEnded', offerHelp: false, forced: false },
      { kind: 'presentationCompleted', stimulusId: 'blue-drop', byHelp: false },
    ];
    const kinds = events.flatMap((event) => helpEventsOf(event, flags)).map((event) => event.kind);
    expect(kinds).toEqual(['roundStarted', 'difficulty', 'stepCompleted', 'roundEnded']);
  });

  it('7.5 19.9: a presentation completed with help sends continueWithHelp, and then roundEnded', () => {
    const kinds = helpEventsOf({ kind: 'presentationCompleted', stimulusId: 'blue-drop', byHelp: true }, flags).map((event) => event.kind);
    expect(kinds).toEqual(['continueWithHelp', 'roundEnded']);
  });

  it('7.3 19.2: a select window that ends without a dwell is a motor difficulty, and a dwell on a let-pass is a cognitive one', () => {
    const selectWindow = helpEventsOf({ kind: 'mistake', stimulusId: 'blue-drop', count: 1, reason: 'windowEnded', offerHelp: false, forced: false }, flags);
    const pass = helpEventsOf({ kind: 'mistake', stimulusId: 'gold-leaf', count: 1, reason: 'dwellOnPass', offerHelp: false, forced: false }, flags);
    expect(selectWindow).toEqual([{ kind: 'difficulty', axis: 'motor', ...flags }]);
    expect(pass).toEqual([{ kind: 'difficulty', axis: 'cognitive', ...flags }]);
  });

  it('19.1: every help event of a frame carries that frame flags', () => {
    const live = { dwellActive: true, playbackActive: true };
    const events = [presented, { kind: 'presentationCompleted', stimulusId: 'blue-drop', byHelp: false } as const].flatMap((event) =>
      helpEventsOf(event, live),
    );
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event).toMatchObject(live);
    }
  });

  it('5.3 19.1: a demonstration turns playback on, and the next presentation turns it off', () => {
    let playback = false;
    const trace: boolean[] = [];
    const sequence: AttentionEvent[] = [{ kind: 'demonstrationStarted', block: 1 }, presented, { kind: 'roundFinished' }];
    for (const event of sequence) {
      playback = playbackAfter(event, playback);
      trace.push(playback);
    }
    expect(trace).toEqual([true, false, false]);
  });

  it('7.2 19.3: the policy gets the events in order, and it offers help after two difficulties in one round', () => {
    const fresh = createGarden(segments).help;
    const mistakes = [
      { kind: 'mistake', stimulusId: 'blue-drop', count: 1, reason: 'windowEnded', offerHelp: false, forced: false },
      { kind: 'mistake', stimulusId: 'blue-drop', count: 2, reason: 'windowEnded', offerHelp: true, forced: false },
    ] as const;
    const trace = [...helpEventsOf(presented, flags), ...mistakes.flatMap((event) => helpEventsOf(event, flags))];
    expect(applyHelp(fresh, trace).outputs.map((output) => output.kind)).toEqual(['offerHelp']);
  });
});

describe('the garden session on Lantern Glade', () => {
  it('4.5 10.1: the four lanterns are placed through placeRound at the start of the stage, one slot each', () => {
    const state = lanternInPlay();
    expect(state.placed?.kind).toBe('simultaneous');
    expect(state.placed?.points).toHaveLength(4);
  });

  it('2.7 9.4: no target is active during the entry title, and the first lantern is active in play', () => {
    let state = stepGarden(env, createGarden(segments), frame({ event: { kind: 'startAt', stage: 'lantern-glade' } })).state;
    expect(state.session.phase).toBe('ENTERING');
    expect(activeHitAreas(state, env.reach.frame)).toEqual([]);
    while (state.session.phase === 'ENTERING') state = stepGarden(env, state, frame()).state;
    expect(activeHitAreas(state, env.reach.frame).map((area) => area.targetId)).toEqual(['lantern-0']);
  });

  it('4.1 14.2: the instruction is the tutorial line for the first lantern, then the next line', () => {
    let state = lanternInPlay();
    expect(instructionKeyOf(state)).toBe('lantern.first');
    state = selectActiveLantern(state).state;
    expect(instructionKeyOf(state)).toBe('lantern.next');
  });

  it('1.3 4.4: four selections light the path, and the stage completes into exactly one reward', () => {
    let state = lanternInPlay();
    const effects: GardenEffect[] = [];
    for (let i = 0; i < 4; i++) {
      const step = selectActiveLantern(state);
      state = step.state;
      effects.push(...step.effects);
    }
    expect(effects.filter((effect) => effect.kind === 'lanternLit').map((effect) => (effect.kind === 'lanternLit' ? effect.index : -1))).toEqual([0, 1, 2, 3]);
    expect(state.session.phase).toBe('CELEBRATING');
    expect(state.session.done).toEqual(['lantern-glade']);
    expect(rewardsIn(effects)).toBe(1);
  });

  it('1.3: a late selection after the stage completes starts no second reward and changes no done list', () => {
    let state = lanternInPlay();
    for (let i = 0; i < 4; i++) state = selectActiveLantern(state).state;
    const late = stepGarden(env, state, frame({ pointers: [{ wrist: 'right', valid: true, pos: { x: 0, y: 0 } }] }));
    expect(rewardsIn(late.effects)).toBe(0);
    expect(late.state.session.done).toEqual(['lantern-glade']);
    expect(late.state.session.phase).toBe('CELEBRATING');
  });

  it('1.4: a selection under a pause or a tracking hold reaches no stage rule', () => {
    for (const suspension of [PAUSED, HELD]) {
      let state = lanternInPlay();
      const effects: string[] = [];
      for (let i = 0; i < 40; i++) {
        const step = stepGarden(env, state, frame({ suspension, pointers: pointerOnActive(state) }));
        effects.push(...step.effects.map((effect) => effect.kind));
        state = step.state;
      }
      expect(state.stage?.kind === 'lantern' ? state.stage.rule.next : -1).toBe(0);
      expect(effects).not.toContain('lanternLit');
      expect(state.session.done).toEqual([]);
    }
  });

  it('12.1: a round in progress keeps its placement when the help levels change', () => {
    const state = lanternInPlay();
    const before = activeHitAreas(state, env.reach.frame)[0];
    const raised = { ...state, help: { ...state.help, motorLevel: TUNING.helpMaxLevel } };
    const later = stepGarden(env, raised, frame()).state;
    expect(helpRadiusForMotorLevel(TUNING.helpMaxLevel, TUNING)).not.toBe(before?.radius);
    expect(later.placed).toEqual(state.placed);
    expect(activeHitAreas(later, env.reach.frame)[0]?.radius).toBe(before?.radius);
  });

  it('7.7: a frame with no time changes no stage state', () => {
    const state = lanternInPlay();
    const next = stepGarden(env, state, frame({ presenceDt: 0, sessionDt: 0 })).state;
    expect(next.stage).toEqual(state.stage);
    expect(next.session).toEqual(state.session);
  });

  it('14.2: a placeholder stage shows its own copy key', () => {
    const state = stepGarden(env, createGarden(segments), frame({ event: { kind: 'startAt', stage: 'bloom' } })).state;
    expect(instructionKeyOf(state)).toBe('bloom.target');
  });
});

describe('the placeholder stages (requirements 9.1, 9.2)', () => {
  it.each(['whisper-hall', 'bloom'] as const)(
    '%s: its one target is placed through placeRound, has one hit area and one drawn marker',
    (stage) => {
      const state = stepGarden(env, createGarden(segments), frame({ event: { kind: 'startAt', stage } })).state;
      expect(state.placed?.points).toHaveLength(1);
      expect(activeHitAreas(state, env.reach.frame).map((area) => area.targetId)).toEqual([`${stage}:target`]);
      expect(drawnTargetsOf(state, env.reach.frame).map((target) => target.id)).toEqual([`${stage}:target`]);
    },
  );

  it.each(['whisper-hall', 'bloom'] as const)(
    '%s: a dwell on the target completes the stage, and stageCompleted is not sent before the dwell',
    (stage) => {
      let state = stepGarden(env, createGarden(segments), frame({ event: { kind: 'startAt', stage } })).state;
      const rewardFrames: number[] = [];
      let frames = 0;
      while (state.session.done.length === 0 && frames < 200) {
        const step = stepGarden(env, state, frame({ pointers: pointerOnActive(state) }));
        frames++;
        if (rewardsIn(step.effects) > 0) rewardFrames.push(frames);
        state = step.state;
      }
      expect(state.session.done).toEqual([stage]);
      expect(rewardFrames).toEqual([frames]);
      // The dwell takes time: the stage is not done after the first frame of the pointer.
      expect(frames).toBeGreaterThan(1);
    },
  );

  it('9.2: the Bloom dwell leads to the end card (SAVED), and a pointer off the target does not complete it', () => {
    let state = stepGarden(env, createGarden(segments), frame({ event: { kind: 'startAt', stage: 'bloom' } })).state;
    const away = { wrist: 'right', valid: true, pos: { x: 0, y: 0 } } as const;
    for (let i = 0; i < 200; i++) state = stepGarden(env, state, frame({ pointers: [away] })).state;
    expect(state.session.done).toEqual([]);
    for (let i = 0; i < 200 && state.session.phase !== 'SAVED'; i++) {
      state = stepGarden(env, state, frame({ pointers: pointerOnActive(state) })).state;
    }
    expect(state.session.phase).toBe('SAVED');
  });
});

/** The whisper stage, started by the ?start shortcut: it is in play at once, with the first presentation announced. */
function whisperInPlay(seed = 42): GardenState {
  return stepGarden(env, createGarden(segments, seed), frame({ event: { kind: 'startAt', stage: 'whisper-glade' } })).state;
}

/** The presentation on screen, or null. */
function presentationOf(state: GardenState) {
  if (state.stage?.kind !== 'whisper') return null;
  const attention = state.stage.rule.attention;
  return attention.blocks[attention.block]?.[attention.index] ?? null;
}

/** The pointer that dwells on the spirit of a select presentation, or on the path option the round offers. */
function whisperPointer(state: GardenState): PointerInput[] {
  const areas = activeHitAreas(state, env.reach.frame);
  const area = areas[0];
  if (area === undefined) return [];
  if (state.stage?.kind === 'whisper' && state.stage.rule.path.phase === 'waiting') {
    const presentation = presentationOf(state);
    if (presentation === null || presentation.mark !== 'select' || state.stage.rule.attention.phase !== 'presenting') return [];
  }
  return [{ wrist: 'right', valid: true, pos: area.centre }];
}

/** Plays frames until a predicate holds, or fails the test when the bound is reached. */
function playUntil(state: GardenState, done: (state: GardenState) => boolean, pointers: (state: GardenState) => PointerInput[] = whisperPointer): GardenState {
  let current = state;
  for (let i = 0; i < 20000 && !done(current); i++) {
    current = stepGarden(env, current, frame({ pointers: pointers(current) })).state;
  }
  if (!done(current)) throw new Error('the condition was not reached');
  return current;
}

describe('the whisper stage in the session (requirements 5, 8, 12.1, 1.4)', () => {
  it('5.3 19.1: a demonstration is not a presentation, and it turns playback on until the next presentation starts', () => {
    let state = whisperInPlay();
    expect(state.stage?.kind).toBe('whisper');
    state = playUntil(state, (s) => s.stage?.kind === 'whisper' && s.stage.rule.attention.phase === 'demonstration', () => []);
    expect(state.playback).toBe(true);
    expect(instructionKeyOf(state)).toBe('whisper.demo');
    expect(activeHitAreas(state, env.reach.frame)).toEqual([]);
    state = playUntil(state, (s) => s.stage?.kind === 'whisper' && s.stage.rule.attention.phase === 'presenting', () => []);
    expect(state.playback).toBe(false);
  });

  it('5.3: the hit area exists only for the current presentation, one spirit at a time', () => {
    const state = whisperInPlay();
    const presentation = presentationOf(state);
    expect(presentation).not.toBeNull();
    expect(activeHitAreas(state, env.reach.frame).map((area) => area.targetId)).toEqual([`spirit-${presentation?.stimulusId}`]);
  });

  it('5.6: a whisper target is drawn only while it can be selected, with its shape', () => {
    const state = whisperInPlay();
    const drawn = drawnTargetsOf(state, env.reach.frame);
    expect(drawn).toHaveLength(1);
    expect(drawn[0]?.shape === 'drop' || drawn[0]?.shape === 'leaf').toBe(true);
    expect(drawn[0]?.active).toBe(true);
    expect(drawn[0]?.centre).not.toBeNull();
  });

  it('12.1: raising both help levels in the middle of a round does not change its placement', () => {
    const state = whisperInPlay();
    const before = activeHitAreas(state, env.reach.frame)[0];
    const raised = { ...state, help: { ...state.help, motorLevel: TUNING.helpMaxLevel, cognitiveLevel: TUNING.helpMaxLevel } };
    const later = stepGarden(env, raised, frame()).state;
    expect(later.placed).toEqual(state.placed);
    expect(activeHitAreas(later, env.reach.frame)[0]?.radius).toBe(before?.radius);
  });

  it('1.4: a completion under a pause reaches no rule, and the path stays closed for the choice', () => {
    let state = playUntil(whisperInPlay(), (s) => s.stage?.kind === 'whisper' && s.stage.rule.path.phase === 'open');
    const effects: GardenEffect[] = [];
    for (let i = 0; i < 5; i++) {
      const step = stepGarden(env, state, frame({ pointers: whisperPointer(state), suspension: PAUSED }));
      effects.push(...step.effects);
      state = step.state;
    }
    expect(effects.filter((effect) => effect.kind === 'pathChosen')).toEqual([]);
    expect(state.session.done).toEqual([]);
    expect(state.stage?.kind === 'whisper' ? state.stage.rule.path.dressing : 'none').toBeNull();
  });

  it('7.5 19.9: Continue with help completes the presentation with help', () => {
    let state = whisperInPlay();
    const effects: GardenEffect[] = [];
    for (let i = 0; i < 200; i++) {
      const step = stepGarden(env, state, frame({ helpRequested: true, pointers: [] }));
      effects.push(...step.effects);
      state = step.state;
      if (effects.some((effect) => effect.kind === 'attention' && effect.event.kind === 'presentationCompleted')) break;
    }
    const completed = effects.flatMap((effect) => (effect.kind === 'attention' && effect.event.kind === 'presentationCompleted' ? [effect.event] : []));
    expect(completed[0]).toEqual(expect.objectContaining({ byHelp: true }));
  });

  it('7.3 14.2: the attention events reach the effects in order, starting with the first presentation', () => {
    const start = stepGarden(env, createGarden(segments), frame({ event: { kind: 'startAt', stage: 'whisper-glade' } }));
    let state = start.state;
    const kinds: string[] = [];
    for (const effect of start.effects) {
      if (effect.kind === 'attention') kinds.push(effect.event.kind);
      if (effect.kind === 'help') kinds.push('help');
    }
    for (let i = 0; i < 2000; i++) {
      const step = stepGarden(env, state, frame({ pointers: whisperPointer(state) }));
      for (const effect of step.effects) {
        if (effect.kind === 'attention') kinds.push(effect.event.kind);
        if (effect.kind === 'help') kinds.push('help');
      }
      state = step.state;
      if (kinds.includes('presentationCompleted')) break;
    }
    expect(kinds[0]).toBe('presentationStarted');
    expect(kinds.indexOf('presentationCompleted')).toBeGreaterThan(kinds.indexOf('presentationStarted'));
  });
});

describe('the scripted run of Whisper Glade (requirements 8.1, 8.4)', () => {
  it('8.1 8.4: the glade, journey A, the round, the path choice and journey B complete in order', () => {
    const lanternPointer = (state: GardenState): PointerInput[] => pointerOnActive(state);
    let state = stepGarden(env, createGarden(segments), frame({ event: { kind: 'startAt', stage: 'lantern-glade' } })).state;
    const effects: GardenEffect[] = [];
    const journeys: string[] = [];
    for (let i = 0; i < 40000; i++) {
      const pointers = state.stage?.kind === 'whisper' ? whisperPointer(state) : lanternPointer(state);
      const step = stepGarden(env, state, frame({ pointers }));
      state = step.state;
      effects.push(...step.effects);
      for (const effect of step.effects) {
        if (effect.kind === 'session' && effect.effect.kind === 'travelStarted') journeys.push(effect.effect.journey);
      }
      if (journeys.includes('journeyB') && state.session.phase === 'TRAVELLING') break;
    }
    expect(journeys).toEqual(['journeyA', 'journeyB']);
    expect(effects.filter((effect) => effect.kind === 'pathChosen')).toHaveLength(1);
    expect(state.session.done).toEqual(['lantern-glade', 'whisper-glade']);
    expect(state.session.phase).toBe('TRAVELLING');
    expect(state.session.travel?.distance ?? -1).toBeGreaterThanOrEqual(0);
  });

  it('8.1: the path choice completes the stage once, and the stage has no rule after it', () => {
    let state = playUntil(whisperInPlay(), (s) => s.stage?.kind === 'whisper' && s.stage.rule.path.phase === 'open');
    const chosen: GardenEffect[] = [];
    for (let i = 0; i < 300 && chosen.length === 0; i++) {
      const step = stepGarden(env, state, frame({ pointers: whisperPointer(state) }));
      chosen.push(...step.effects.filter((effect) => effect.kind === 'pathChosen'));
      state = step.state;
    }
    expect(chosen).toHaveLength(1);
    const after: GardenEffect[] = [];
    for (let i = 0; i < 20; i++) {
      const step = stepGarden(env, state, frame({ pointers: whisperPointer(state) }));
      after.push(...step.effects.filter((effect) => effect.kind === 'pathChosen'));
      state = step.state;
    }
    expect(after).toHaveLength(0);
  });

  it('8.1 8.2: either hand selects a path option, because the choice names the option and not a wrist', () => {
    const open = playUntil(whisperInPlay(), (s) => s.stage?.kind === 'whisper' && s.stage.rule.path.phase === 'open');
    const area = activeHitAreas(open, env.reach.frame)[0];
    expect(area).toBeDefined();
    let state = open;
    let chosen = false;
    for (let i = 0; i < 200 && !chosen; i++) {
      const pointers: PointerInput[] = area === undefined ? [] : [{ wrist: 'left', valid: true, pos: area.centre }];
      const step = stepGarden(env, state, frame({ pointers }));
      chosen = step.effects.some((effect) => effect.kind === 'pathChosen');
      state = step.state;
    }
    expect(chosen).toBe(true);
  });
});

/** The attention round of the whisper stage, or null before and after the stage. */
function attentionOf(state: GardenState) {
  return state.stage?.kind === 'whisper' ? state.stage.rule.attention : null;
}

/** The activation id of the first active hit area, or undefined when none is active. */
function activationIdNow(state: GardenState): string | undefined {
  return activeHitAreas(state, env.reach.frame)[0]?.activationId;
}

/** Plays frames like playUntil, and also returns the attention events of those frames, in order. */
function playCollecting(
  state: GardenState,
  done: (state: GardenState) => boolean,
  pointers: (state: GardenState) => PointerInput[] = whisperPointer,
): { state: GardenState; events: AttentionEvent[] } {
  let current = state;
  const events: AttentionEvent[] = [];
  for (let i = 0; i < 20000 && !done(current); i++) {
    const step = stepGarden(env, current, frame({ pointers: pointers(current) }));
    current = step.state;
    for (const effect of step.effects) {
      if (effect.kind === 'attention') events.push(effect.event);
    }
  }
  if (!done(current)) throw new Error('the condition was not reached');
  return { state: current, events };
}

/**
 * The whisper pointer with the hand lifted on the first frame of each appearance. A dwell that continues from the last
 * appearance keeps its owner (Req 17.14), so a player who has just completed a spirit lifts the hand before the next
 * appearance, as a real hand does.
 */
function liftedWhisperPointer(state: GardenState): PointerInput[] {
  const attention = attentionOf(state);
  const area = activeHitAreas(state, env.reach.frame)[0];
  if (attention !== null && attention.phase === 'presenting' && attention.elapsedMs === 0 && area !== undefined) {
    // A valid pointer outside the target. A latch leaves only when a valid pointer is outside it (Req 17.12).
    return [{ wrist: 'right', valid: true, pos: { x: area.centre.x + 3 * area.radius, y: area.centre.y } }];
  }
  return whisperPointer(state);
}

/** A pointer for a select presentation that dwells only after a mistake on it (the repeat), and nothing else. */
function selectOnlyOnRepeat(state: GardenState): PointerInput[] {
  const attention = attentionOf(state);
  if (attention === null || attention.phase !== 'presenting') return [];
  const presentation = presentationOf(state);
  if (presentation === null || presentation.mark !== 'select' || attention.mistakes === 0) return [];
  return liftedWhisperPointer(state);
}

describe('a whisper presentation has its own activation (requirement 17.13, 5.4)', () => {
  it('17.13: the same spirit shown twice in a row can be selected twice, with no mistake', () => {
    const { state, events } = playCollecting(whisperInPlay(), (s) => (attentionOf(s)?.completed ?? 0) >= 3, liftedWhisperPointer);
    expect(events.some((event) => event.kind === 'mistake')).toBe(false);
    const completed = events.flatMap((event) => (event.kind === 'presentationCompleted' ? [event.stimulusId] : []));
    expect(completed.slice(0, 3)).toEqual(['goldLeaf', 'blueDrop', 'blueDrop']);
    expect(state.stage?.kind).toBe('whisper');
  });

  it('17.13 7.1: after a mistake, the repeated presentation of a spirit can be selected, and the round needs no help', () => {
    const { events } = playCollecting(whisperInPlay(), (s) => (attentionOf(s)?.completed ?? 0) >= 3, selectOnlyOnRepeat);
    const mistakes = events.filter((event) => event.kind === 'mistake');
    expect(mistakes.length).toBeGreaterThanOrEqual(2);
    expect(mistakes.every((event) => event.kind === 'mistake' && event.reason === 'windowEnded')).toBe(true);
    const helped = events.some((event) => event.kind === 'presentationCompleted' && event.byHelp);
    expect(helped).toBe(false);
  });

  it('17.13: the activation id stays the same while one presentation is on screen, and changes for the same spirit shown again', () => {
    // Index 0 (a let-pass) completes by its window. Index 1 is the blue drop, a select, on screen next.
    let state = playUntil(whisperInPlay(), (s) => attentionOf(s)?.completed === 1 && attentionOf(s)?.phase === 'presenting', () => []);
    const first = activationIdNow(state);
    expect(first).toBeDefined();
    for (let i = 0; i < 5; i++) {
      state = stepGarden(env, state, frame({ pointers: [] })).state;
      expect(attentionOf(state)?.phase).toBe('presenting');
      expect(attentionOf(state)?.completed).toBe(1);
      expect(activationIdNow(state)).toBe(first);
    }
    // Index 1 is completed by a dwell. Index 2 shows the same blue drop again, and its id must differ.
    state = playUntil(state, (s) => attentionOf(s)?.completed === 2 && attentionOf(s)?.phase === 'presenting', liftedWhisperPointer);
    expect(activationIdNow(state)).toBeDefined();
    expect(activationIdNow(state)).not.toBe(first);
  });
});

describe('every authored slot is on screen at its activation travel (requirements 2.7, 9.1, 9.2, 10.1)', () => {
  const ASPECT_FRAME = env.reach.frame;
  const forestLayer: LayerRef = { depth: INTERACTION_LAYER.depth, anchor: INTERACTION_LAYER.anchor, factor: WORLD_TUNING.interactionFactor };
  /** An authored forest slot as a point of the interaction layer, the way the driver places it. */
  const interactionPoint = (slot: { readonly x: number; readonly y: number }): WorldPoint => ({ x: slot.x, y: slot.y, ...forestLayer });
  const restHelp = createHelp(TUNING);
  const raisedHelp = { ...restHelp, motorLevel: TUNING.helpMaxLevel };

  /**
   * Places one round of the given slots at this travel under the help level, and checks that the round places all of
   * them and that every placed target's centre is inside the play frame. The round is placed as the driver places it.
   */
  function expectRoundOnScreen(label: string, points: readonly WorldPoint[], layer: LayerRef, travel: number): void {
    for (const [level, help] of [
      ['rest', restHelp],
      ['raised', raisedHelp],
    ] as const) {
      const placed = placeRound({
        worldSlots: points,
        n: points.length,
        help,
        grids: env.reach.grids,
        activeWrists: SIMULATED_WRISTS,
        mapping: env.reach.mapping,
        view: { travel, head: { x: 0, y: 0 } },
        frame: ASPECT_FRAME,
        layer,
        bandY: ATTENTION_TUNING.restingBandY,
        core: TUNING,
      });
      const where = `${label} at travel ${travel}, ${level} help`;
      expect(placed.kind, where).not.toBe('none');
      expect(placed.points.length, where).toBe(points.length);
      for (const point of placed.points) {
        const screen = targetScreen(point, placed.snapshot.radius, { travel, head: { x: 0, y: 0 } }, ASPECT_FRAME, WORLD_TUNING);
        const centre: Vec2 | null = screen?.position ?? null;
        expect(centre, `${where}: a centre`).not.toBeNull();
        expect(centre?.x ?? -1, `${where}: centre x`).toBeGreaterThanOrEqual(0);
        expect(centre?.x ?? ASPECT + 1, `${where}: centre x`).toBeLessThanOrEqual(ASPECT);
        expect(centre?.y ?? -1, `${where}: centre y`).toBeGreaterThanOrEqual(0);
        expect(centre?.y ?? 2, `${where}: centre y`).toBeLessThanOrEqual(1);
      }
    }
  }

  it('the lantern round places all four lantern slots at travel 0', () => {
    expectRoundOnScreen('lantern round', env.content.lantern.slots.map(interactionPoint), forestLayer, 0);
  });

  it('the whisper spirit round and the path round place their slots at travel 8 (journey A ends there)', () => {
    const arrival = segments.journeyA.to;
    expectRoundOnScreen('spirit round', env.content.whisper.spiritSlots.map(interactionPoint), forestLayer, arrival);
    const paths = [env.content.whisper.pathSlots.fireflies, env.content.whisper.pathSlots.candles].map(interactionPoint);
    expectRoundOnScreen('path round', paths, forestLayer, arrival);
  });

  it('17 Whisper Hall: its one slot places at the door arrival, on its own layer', () => {
    const slot = env.content.placeholders['whisper-hall'].target.slots[0];
    if (slot === undefined) throw new Error('the hall has no slot');
    expectRoundOnScreen('hall round', [placeholderPointOf(slot)], placeholderLayerOf(slot), segments.doorHall.to);
  });

  it('18 Bloom: its one slot places at the garden door arrival, on its own layer', () => {
    const slot = env.content.placeholders.bloom.target.slots[0];
    if (slot === undefined) throw new Error('bloom has no slot');
    expectRoundOnScreen('bloom round', [placeholderPointOf(slot)], placeholderLayerOf(slot), segments.doorGarden.to);
  });
});

describe('the head view in simulated input (garden-level 11.7; marrow requirements 6.7, 6.8)', () => {
  const NO_LANDMARK = { pos: { x: 0, y: 0 }, valid: false } as const;
  const NO_LANDMARKS = {
    leftWrist: NO_LANDMARK,
    rightWrist: NO_LANDMARK,
    nose: NO_LANDMARK,
    leftShoulder: NO_LANDMARK,
    rightShoulder: NO_LANDMARK,
  } as const;

  /** The head offset of a simulated pointer at a screen position, from marrow's head view at rest. */
  function headAt(pos: Vec2): Vec2 {
    const pointer = { valid: true as const, pos };
    return stepHeadView(
      createHeadView(),
      { mode: 'simulated', tuning: TUNING, landmarks: NO_LANDMARKS, frameAspect: ASPECT, neutral: null, skip: false, playAspect: ASPECT, pointer },
      0,
    ).offset;
  }

  it('6.7: the pointer at the left edge, the centre and the right edge gives -0.3, 0 and +0.3 (the strength of the tuning)', () => {
    const left = headAt({ x: 0, y: 0.5 });
    const centre = headAt({ x: ASPECT / 2, y: 0.5 });
    const right = headAt({ x: ASPECT, y: 0.5 });
    expect(left.x).toBeCloseTo(-TUNING.simulatedHeadStrength, 9);
    expect(centre.x).toBe(0);
    expect(right.x).toBeCloseTo(TUNING.simulatedHeadStrength, 9);
    expect(TUNING.simulatedHeadStrength).toBe(0.3);
  });

  it('6.7 11.7: at each of the three offsets the drawn disc and the hit circle share one centre', () => {
    const state = lanternInPlay();
    for (const pos of [{ x: 0, y: 0.5 }, { x: ASPECT / 2, y: 0.5 }, { x: ASPECT, y: 0.5 }]) {
      const head = headAt(pos);
      const hit = activeHitAreas(state, env.reach.frame, head)[0];
      const drawn = drawnTargetsOf(state, env.reach.frame, head).find((target) => target.id === hit?.targetId);
      expect(hit).toBeDefined();
      expect(drawn?.centre).toEqual(hit?.centre);
    }
    // The offset moves the target: the centre at the right edge is not the centre at rest.
    const rest = activeHitAreas(state, env.reach.frame, { x: 0, y: 0 })[0];
    const right = activeHitAreas(state, env.reach.frame, headAt({ x: ASPECT, y: 0.5 }))[0];
    expect(right?.centre.x).not.toBe(rest?.centre.x);
  });

  it('6.8 11.7: an invalid pointer eases the offset to exactly 0 within 500 ms, and it is between 0 and the offset before that', () => {
    const step = TUNING.maxClockStepMs;
    let view = createHeadView();
    view = stepHeadView(view, { mode: 'simulated', tuning: TUNING, landmarks: NO_LANDMARKS, frameAspect: ASPECT, neutral: null, skip: false, playAspect: ASPECT, pointer: { valid: true, pos: { x: ASPECT, y: 0.5 } } }, 0).state;
    const invalid = { mode: 'simulated' as const, tuning: TUNING, landmarks: NO_LANDMARKS, frameAspect: ASPECT, neutral: null, skip: false, playAspect: ASPECT, pointer: { valid: false as const, pos: { x: 0, y: 0 } } };
    const offsets: number[] = [];
    for (let elapsed = 0; elapsed < 500; elapsed += step) {
      const result = stepHeadView(view, invalid, step);
      view = result.state;
      offsets.push(result.offset.x);
    }
    const before = offsets.slice(0, -1);
    expect(before.every((x) => x > 0 && x < TUNING.simulatedHeadStrength)).toBe(true);
    expect(offsets[offsets.length - 1]).toBe(0);
  });

  it('11.7 steering 8: while a dwell is in progress the interaction offset is held, and the hit centre does not move when the pointer moves', () => {
    let state = lanternInPlay();
    // The dwell begins with the head at rest: the pointer sits on the centre of the active lantern.
    const start = activeHitAreas(state, env.reach.frame, state.view.interaction)[0];
    expect(start).toBeDefined();
    const onTarget: PointerInput[] = [{ wrist: 'right', valid: true, pos: start?.centre ?? { x: 0, y: 0 } }];
    for (let i = 0; i < 100 && !state.dwellActive; i++) state = stepGarden(env, state, frame({ pointers: onTarget })).state;
    expect(state.dwellActive).toBe(true);
    const held = activeHitAreas(state, env.reach.frame, state.view.interaction)[0];
    expect(state.view.interaction).toEqual({ x: 0, y: 0 });
    // The head moves to the right and to the left while the pointer stays on the lantern.
    for (const x of [TUNING.simulatedHeadStrength, -TUNING.simulatedHeadStrength, TUNING.simulatedHeadStrength / 2]) {
      state = stepGarden(env, state, frame({ head: { x, y: 0 }, pointers: onTarget })).state;
      expect(state.dwellActive, 'the dwell is still in progress').toBe(true);
      expect(state.view.live.x).toBe(x);
      expect(state.view.interaction).toEqual({ x: 0, y: 0 });
      expect(activeHitAreas(state, env.reach.frame, state.view.interaction)[0]?.centre).toEqual(held?.centre);
    }
  });

  it('11.7 steering 8: when the dwell ends the interaction offset eases to the live value over headEaseToCentreMs', () => {
    let state = lanternInPlay();
    const start = activeHitAreas(state, env.reach.frame, state.view.interaction)[0];
    const onTarget: PointerInput[] = [{ wrist: 'right', valid: true, pos: start?.centre ?? { x: 0, y: 0 } }];
    for (let i = 0; i < 100 && !state.dwellActive; i++) state = stepGarden(env, state, frame({ pointers: onTarget })).state;
    const live = { x: -TUNING.simulatedHeadStrength, y: 0 };
    // The pointer is lifted. The dwell releases after its outside window, and the ease starts in that frame. The live
    // offset is at the left from the first frame of the lift.
    for (let i = 0; i < 100 && state.dwellActive; i++) state = stepGarden(env, state, frame({ head: live, pointers: [] })).state;
    expect(state.dwellActive).toBe(false);
    expect(state.view.held).toBeNull();
    expect(state.view.ease).not.toBeNull();
    // One frame more than the ease needs, because the interaction offset of a frame is read before that frame's time.
    const frames = Math.ceil(TUNING.headEaseToCentreMs / TUNING.maxClockStepMs) + 1;
    const ramp: number[] = [];
    for (let i = 0; i < frames; i++) {
      state = stepGarden(env, state, frame({ head: live, pointers: [] })).state;
      ramp.push(state.view.interaction.x);
    }
    // Between the held value (0) and the live value while the ease runs, falling monotonically; the live value once it is over.
    const eased = ramp.slice(0, -1);
    eased.forEach((x, i) => {
      expect(x).toBeLessThanOrEqual(0);
      expect(x).toBeGreaterThan(live.x);
      if (i > 0) expect(x).toBeLessThanOrEqual(eased[i - 1] ?? 0);
    });
    expect(ramp[ramp.length - 1]).toBe(live.x);
    expect(state.view.live).toEqual(live);
  });
});

describe('simulated reach (requirement 20.3)', () => {
  it('20.3: the simulated reach gives grids for the one mouse wrist, and nothing for the other', () => {
    expect(SIMULATED_WRISTS).toEqual(['right']);
    expect(Object.keys(reach.grids)).toEqual(['right']);
  });
});
