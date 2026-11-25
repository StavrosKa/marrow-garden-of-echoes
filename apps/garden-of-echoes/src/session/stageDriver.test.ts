// The per-frame glue (design 3 steps 5 to 8; requirements 1.3, 1.4, 2.7, 4, 7, 10, 12.1, 19). The tests run the real
// session machine, the real lantern rule and the real placeRound, with whole-frame simulated reach. Time is given as
// frame deltas of marrow's maxClockStepMs, so the dwell and the entry title take their real number of frames.
import { helpRadiusForMotorLevel, TUNING, type PointerInput } from 'marrow/core';
import type { AttentionEvent } from 'marrow/challenges';
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

  it('14.2 20.4: a placeholder stage shows its own copy key and has no target to dwell on', () => {
    const state = stepGarden(env, createGarden(segments), frame({ event: { kind: 'startAt', stage: 'bloom' } })).state;
    expect(instructionKeyOf(state)).toBe('bloom.target');
    expect(activeHitAreas(state, env.reach.frame)).toEqual([]);
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

describe('simulated reach (requirement 20.3)', () => {
  it('20.3: the simulated reach gives grids for the one mouse wrist, and nothing for the other', () => {
    expect(SIMULATED_WRISTS).toEqual(['right']);
    expect(Object.keys(reach.grids)).toEqual(['right']);
  });
});
