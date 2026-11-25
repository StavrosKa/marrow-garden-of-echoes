// The setup flow (requirements 3.1 to 3.3). Pure, so the tests run under Node with no DOM.
import { describe, expect, it } from 'vitest';
import { INITIAL_SETUP, stepSetup, type SetupState } from './setupState';

/** The state after a sequence of events, with the effects that the sequence produced. */
function run(events: Parameters<typeof stepSetup>[1][], from: SetupState = INITIAL_SETUP) {
  let state = from;
  const effects: string[] = [];
  for (const event of events) {
    const step = stepSetup(state, event);
    state = step.state;
    effects.push(...step.effects.map((effect) => effect.kind));
  }
  return { state, effects };
}

describe('the setup flow (requirements 3.1 to 3.3)', () => {
  it('3.1: the flow starts on Home', () => {
    expect(INITIAL_SETUP.screen).toBe('home');
  });

  it('3.2: Start shows the camera permission screen and requests no camera', () => {
    const { state, effects } = run([{ kind: 'start' }]);
    expect(state.screen).toBe('cameraPermission');
    expect(effects).toEqual([]);
  });

  it('3.2: the camera is requested only from "Use the camera", after Start', () => {
    const { effects } = run([{ kind: 'useCamera' }]);
    expect(effects).toEqual([]);
    const after = run([{ kind: 'start' }, { kind: 'useCamera' }]);
    expect(after.effects).toEqual(['requestCamera']);
    expect(after.state.screen).toBe('cameraPermission');
  });

  it('3.2: a granted camera goes to the hand choice', () => {
    const { state } = run([{ kind: 'start' }, { kind: 'useCamera' }, { kind: 'cameraOutcome', outcome: 'ready' }]);
    expect(state.screen).toBe('handChoice');
  });

  it('3.3: a denied camera enters simulated input at once', () => {
    const { state } = run([{ kind: 'start' }, { kind: 'useCamera' }, { kind: 'cameraOutcome', outcome: 'denied' }]);
    expect(state.screen).toBe('simulated');
    expect(state.failure).toBe('denied');
  });

  it('3.3: a missing camera enters simulated input at once', () => {
    const { state } = run([{ kind: 'start' }, { kind: 'useCamera' }, { kind: 'cameraOutcome', outcome: 'no-camera' }]);
    expect(state.screen).toBe('simulated');
    expect(state.failure).toBe('no-camera');
  });

  it('3.3: "Try without camera" enters simulated input from every screen that offers it, and its own step requests no camera', () => {
    const paths: Parameters<typeof stepSetup>[1][][] = [
      [],
      [{ kind: 'start' }],
      [{ kind: 'start' }, { kind: 'useCamera' }, { kind: 'cameraOutcome', outcome: 'ready' }],
    ];
    for (const setup of paths) {
      const before = run(setup).state;
      const step = stepSetup(before, { kind: 'tryWithout' });
      expect(step.state.screen).toBe('simulated');
      expect(step.effects).toEqual([]);
    }
  });

  it('3.2: the hand choice goes to simulated input (camera play is not built)', () => {
    const { state, effects } = run([
      { kind: 'start' },
      { kind: 'useCamera' },
      { kind: 'cameraOutcome', outcome: 'ready' },
      { kind: 'handChosen' },
    ]);
    expect(state.screen).toBe('simulated');
    expect(effects).toEqual(['requestCamera']);
  });

  it('3.2: an event that does not apply to the screen changes nothing', () => {
    expect(run([{ kind: 'useCamera' }]).state).toEqual(INITIAL_SETUP);
    expect(run([{ kind: 'cameraOutcome', outcome: 'ready' }]).state).toEqual(INITIAL_SETUP);
    expect(run([{ kind: 'handChosen' }]).state).toEqual(INITIAL_SETUP);
    const simulated = run([{ kind: 'tryWithout' }]).state;
    expect(run([{ kind: 'start' }, { kind: 'useCamera' }], simulated).state).toEqual(simulated);
  });
});
