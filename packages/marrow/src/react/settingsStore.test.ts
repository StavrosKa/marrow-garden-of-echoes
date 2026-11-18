import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseSettings, SETTINGS_VERSION, TUNING, type Settings } from '../core';
import * as react from './index';
import { createSettingsStore, SETTINGS_KEY_NAME, type SettingsStorage } from './settingsStore';

// The Settings Store tests of Req 28.9, under Node: the storage is passed in (or put in place of
// window), so no DOM is needed. Requirements 12.9, 20.2, 20.5, 20.8, 20.9.

const PREFIX = 'test-app:';
const KEY = `${PREFIX}${SETTINGS_KEY_NAME}`;
const CALM = false;
const REDUCED = true;

/** A localStorage that remembers every key it was asked for and every key it was given. */
class FakeStorage implements SettingsStorage {
  readonly data = new Map<string, string>();
  readonly reads: string[] = [];
  readonly writes: string[] = [];
  getItem(key: string): string | null {
    this.reads.push(key);
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.writes.push(key);
    this.data.set(key, value);
  }
}

/** A storage that throws on a read. */
class ThrowingRead extends FakeStorage {
  override getItem(key: string): string | null {
    this.reads.push(key);
    throw new Error('read blocked');
  }
}

/** A storage that throws on a write. */
class ThrowingWrite extends FakeStorage {
  override setItem(key: string, value: string): void {
    this.writes.push(key);
    void value;
    throw new Error('quota exceeded');
  }
}

/** Settings that differ from every default, whatever the browser prefers. */
const CHOSEN: Settings = { motion: 'gentle', mute: true, volume: TUNING.defaultVolume / 2, hands: 'left' };

const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const;
let consoleSpies: ReturnType<typeof vi.spyOn>[] = [];

beforeEach(() => {
  consoleSpies = CONSOLE_METHODS.map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
});

afterEach(() => {
  // Req 20.5: no message, whatever storage did. Every test, including those that never touch a failing storage.
  const called = CONSOLE_METHODS.filter((_m, i) => (consoleSpies[i]?.mock.calls.length ?? 0) > 0);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  expect(called, 'console methods that were called').toEqual([]);
});

function stored(storage: FakeStorage): unknown {
  const text = storage.data.get(KEY);
  return text === undefined ? undefined : JSON.parse(text);
}

describe('the round trip through a storage (Req 20.2)', () => {
  it('gives a new store the settings an earlier one wrote', () => {
    const storage = new FakeStorage();
    createSettingsStore({ prefix: PREFIX, storage, prefersReducedMotion: CALM }).update(CHOSEN);
    for (const reduced of [CALM, REDUCED]) {
      expect(createSettingsStore({ prefix: PREFIX, storage, prefersReducedMotion: reduced }).get()).toEqual(CHOSEN);
    }
  });

  it('writes versioned JSON that the parser reads back', () => {
    const storage = new FakeStorage();
    createSettingsStore({ prefix: PREFIX, storage, prefersReducedMotion: CALM }).update(CHOSEN);
    expect(stored(storage)).toEqual({ version: SETTINGS_VERSION, ...CHOSEN });
    expect(parseSettings(storage.data.get(KEY) ?? null, { prefersReducedMotion: REDUCED })).toEqual(CHOSEN);
  });

  it('reads what is stored when it starts, and starts from the defaults for data it cannot read', () => {
    const storage = new FakeStorage();
    storage.data.set(KEY, JSON.stringify({ version: SETTINGS_VERSION, ...CHOSEN }));
    expect(createSettingsStore({ prefix: PREFIX, storage, prefersReducedMotion: CALM }).get()).toEqual(CHOSEN);
    for (const bad of ['', 'not json', '[]', 'null', '{"__proto__":{"mute":true}}', JSON.stringify({ version: SETTINGS_VERSION + 1, ...CHOSEN })]) {
      const other = new FakeStorage();
      other.data.set(KEY, bad);
      const store = createSettingsStore({ prefix: PREFIX, storage: other, prefersReducedMotion: REDUCED });
      expect(store.get()).toEqual({ motion: 'reduced', mute: false, volume: TUNING.defaultVolume, hands: null });
      expect(other.writes, `a read of ${JSON.stringify(bad)} wrote something`).toEqual([]);
    }
  });

  it('starts with the defaults when nothing is stored, and writes nothing until a setting changes', () => {
    const storage = new FakeStorage();
    const store = createSettingsStore({ prefix: PREFIX, storage, prefersReducedMotion: CALM });
    expect(store.get()).toEqual({ motion: 'full', mute: false, volume: TUNING.defaultVolume, hands: null });
    expect(storage.writes).toEqual([]);
  });
});

describe('the key (Req 20.2, 20.9)', () => {
  it('is one key that starts with the prefix of the app, the only key written and the only key read', () => {
    const storage = new FakeStorage();
    storage.data.set('other-app:settings', 'untouched');
    const store = createSettingsStore({ prefix: PREFIX, storage, prefersReducedMotion: CALM });
    store.update({ volume: CHOSEN.volume });
    store.update({ mute: true });
    store.update({ hands: 'both' });
    store.update({ motion: 'gentle' });
    store.update(CHOSEN);
    store.update({ hands: null });
    const keys = [...new Set(storage.writes)];
    expect(keys).toHaveLength(1);
    expect(keys[0]?.startsWith(PREFIX)).toBe(true);
    expect(keys[0]?.length).toBeGreaterThan(PREFIX.length);
    expect(storage.writes.length).toBeGreaterThan(1);
    expect([...new Set(storage.reads)]).toEqual(keys);
    expect([...storage.data.keys()].sort()).toEqual([keys[0], 'other-app:settings'].sort());
    expect(storage.data.get('other-app:settings')).toBe('untouched');
  });

  it('follows the prefix the app supplies', () => {
    const storage = new FakeStorage();
    for (const prefix of ['a:', 'b/', 'marrow.settings.']) {
      createSettingsStore({ prefix, storage, prefersReducedMotion: CALM }).update({ mute: true });
    }
    expect([...storage.data.keys()].every((k) => ['a:', 'b/', 'marrow.settings.'].some((p) => k.startsWith(p)))).toBe(true);
    expect(storage.data.size).toBe(3);
  });

  it('holds the four settings and a version, and nothing else, whatever the caller passes', () => {
    const storage = new FakeStorage();
    const store = createSettingsStore({ prefix: PREFIX, storage, prefersReducedMotion: CALM });
    const more = { ...CHOSEN, calibration: [[0, 1]], pose: { x: 1 }, video: 'frame', grid: [1] } as Partial<Settings>;
    store.update(more);
    expect(Object.keys(stored(storage) as object).sort()).toEqual(['hands', 'motion', 'mute', 'version', 'volume']);
    expect(Object.keys(store.get()).sort()).toEqual(['hands', 'motion', 'mute', 'volume']);
    expect(storage.writes.every((k) => k === KEY)).toBe(true);
    expect(JSON.stringify([...storage.data.values()])).not.toMatch(/calibration|pose|video|grid/);
  });
});

describe('a storage that fails (Req 20.5)', () => {
  it('falls back to memory when getItem throws, and then writes nothing', () => {
    const storage = new ThrowingRead();
    const store = createSettingsStore({ prefix: PREFIX, storage, prefersReducedMotion: REDUCED });
    expect(store.get()).toEqual({ motion: 'reduced', mute: false, volume: TUNING.defaultVolume, hands: null });
    expect(() => store.update(CHOSEN)).not.toThrow();
    expect(store.get()).toEqual(CHOSEN);
    expect(storage.writes).toEqual([]);
  });

  it('falls back to memory when setItem throws, and a read in the same session returns the value just set', () => {
    const storage = new ThrowingWrite();
    const store = createSettingsStore({ prefix: PREFIX, storage, prefersReducedMotion: CALM });
    expect(() => store.update({ volume: CHOSEN.volume })).not.toThrow();
    expect(store.get().volume).toBe(CHOSEN.volume);
    expect(() => store.update({ mute: true })).not.toThrow();
    expect(store.get()).toEqual({ motion: 'full', mute: true, volume: CHOSEN.volume, hands: null });
    // It does not try again: memory is where the settings are for the rest of the page's life.
    expect(storage.writes).toHaveLength(1);
  });

  it('keeps the value just set when the write fails, for every setting', () => {
    for (const patch of [{ motion: 'gentle' }, { mute: true }, { volume: CHOSEN.volume }, { hands: 'right' }] as Partial<Settings>[]) {
      const store = createSettingsStore({ prefix: PREFIX, storage: new ThrowingWrite(), prefersReducedMotion: CALM });
      store.update(patch);
      expect(store.get()).toMatchObject(patch);
    }
  });

  it('still tells subscribers when the write fails or the read failed', () => {
    for (const storage of [new ThrowingWrite(), new ThrowingRead()]) {
      const store = createSettingsStore({ prefix: PREFIX, storage, prefersReducedMotion: CALM });
      const seen: boolean[] = [];
      store.subscribe(() => seen.push(store.get().mute));
      store.update({ mute: true });
      expect(seen).toEqual([true]);
    }
  });

  it('works without a storage: null, and no localStorage in the environment', () => {
    for (const options of [
      { prefix: PREFIX, storage: null, prefersReducedMotion: CALM },
      { prefix: PREFIX, prefersReducedMotion: CALM },
      { prefix: PREFIX, storage: undefined, prefersReducedMotion: CALM },
    ]) {
      const store = createSettingsStore(options);
      expect(store.get()).toEqual({ motion: 'full', mute: false, volume: TUNING.defaultVolume, hands: null });
      store.update(CHOSEN);
      expect(store.get()).toEqual(CHOSEN);
    }
  });

  it('works when the storage is not an object that can be used', () => {
    for (const storage of [{}, { getItem: 1, setItem: 2 }, { getItem: () => 7, setItem: () => undefined }] as unknown as SettingsStorage[]) {
      const store = createSettingsStore({ prefix: PREFIX, storage, prefersReducedMotion: CALM });
      store.update({ mute: true });
      expect(store.get().mute).toBe(true);
    }
  });
});

describe('the default storage, window.localStorage', () => {
  it('is used when no storage is passed', () => {
    const storage = new FakeStorage();
    vi.stubGlobal('window', { localStorage: storage });
    createSettingsStore({ prefix: PREFIX, prefersReducedMotion: CALM }).update({ mute: true });
    expect(storage.writes).toEqual([KEY]);
    expect(createSettingsStore({ prefix: PREFIX, prefersReducedMotion: CALM }).get().mute).toBe(true);
  });

  it('is not used when null is passed', () => {
    const storage = new FakeStorage();
    vi.stubGlobal('window', { localStorage: storage });
    createSettingsStore({ prefix: PREFIX, storage: null, prefersReducedMotion: CALM }).update({ mute: true });
    expect(storage.writes).toEqual([]);
    expect(storage.reads).toEqual([]);
  });

  it('falls back to memory without a message when reading window.localStorage throws', () => {
    vi.stubGlobal('window', {
      get localStorage(): never {
        throw new Error('The operation is insecure.');
      },
    });
    const store = createSettingsStore({ prefix: PREFIX, prefersReducedMotion: CALM });
    store.update({ mute: true });
    expect(store.get().mute).toBe(true);
  });

  it('falls back to memory when window has no localStorage', () => {
    for (const win of [{}, { localStorage: null }, { localStorage: undefined }]) {
      vi.stubGlobal('window', win);
      const store = createSettingsStore({ prefix: PREFIX, prefersReducedMotion: CALM });
      store.update({ volume: CHOSEN.volume });
      expect(store.get().volume).toBe(CHOSEN.volume);
    }
  });
});

describe('the subscribers (Req 20.8)', () => {
  it('are called before update returns, with the new settings already in place', () => {
    const store = createSettingsStore({ prefix: PREFIX, storage: new FakeStorage(), prefersReducedMotion: CALM });
    const seen: Settings[] = [];
    store.subscribe(() => seen.push({ ...store.get() }));
    store.update({ mute: true });
    expect(seen).toEqual([{ motion: 'full', mute: true, volume: TUNING.defaultVolume, hands: null }]);
    store.update({ hands: 'both' });
    expect(seen).toHaveLength(2);
    expect(seen[1]?.hands).toBe('both');
  });

  it('are called once for a change of each setting, the first choice of a motion level and a later one included', () => {
    const store = createSettingsStore({ prefix: PREFIX, storage: new FakeStorage(), prefersReducedMotion: CALM });
    const seen: Settings[] = [];
    store.subscribe(() => seen.push({ ...store.get() }));
    const patches: Partial<Settings>[] = [
      { motion: 'gentle' },
      { motion: 'reduced' },
      { mute: true },
      { volume: CHOSEN.volume },
      { hands: 'right' },
      { hands: null },
    ];
    patches.forEach((patch, i) => {
      store.update(patch);
      expect(seen, `after ${JSON.stringify(patch)}`).toHaveLength(i + 1);
      expect(seen[i]).toMatchObject(patch);
    });
  });

  it('are called once for each change, in the order they subscribed, each as many times as it subscribed', () => {
    const store = createSettingsStore({ prefix: PREFIX, storage: new FakeStorage(), prefersReducedMotion: CALM });
    const order: string[] = [];
    const a = (): number => order.push('a');
    store.subscribe(a);
    store.subscribe(() => order.push('b'));
    store.subscribe(a);
    store.update({ volume: CHOSEN.volume });
    expect(order).toEqual(['a', 'b', 'a']);
  });

  it('stop after the function that subscribe returned is called, once or twice, and leave the others', () => {
    const store = createSettingsStore({ prefix: PREFIX, storage: new FakeStorage(), prefersReducedMotion: CALM });
    const calls = { a: 0, b: 0 };
    const stopA = store.subscribe(() => calls.a++);
    store.subscribe(() => calls.b++);
    store.update({ mute: true });
    stopA();
    stopA();
    store.update({ mute: false });
    expect(calls).toEqual({ a: 1, b: 2 });
  });

  it('stopping one twice does not stop a second subscription of the same function', () => {
    const store = createSettingsStore({ prefix: PREFIX, storage: new FakeStorage(), prefersReducedMotion: CALM });
    let n = 0;
    const f = (): number => n++;
    const stop = store.subscribe(f);
    store.subscribe(f);
    stop();
    stop();
    store.update({ mute: true });
    expect(n).toBe(1);
  });

  it('are not called when nothing changes, and nothing is written', () => {
    const storage = new FakeStorage();
    const store = createSettingsStore({ prefix: PREFIX, storage, prefersReducedMotion: CALM });
    store.update(CHOSEN);
    const before = store.get();
    const writes = storage.writes.length;
    let n = 0;
    store.subscribe(() => n++);
    store.update({});
    store.update(CHOSEN);
    store.update({ mute: true, hands: 'left', volume: CHOSEN.volume });
    store.update({ mute: undefined });
    expect(n).toBe(0);
    expect(storage.writes).toHaveLength(writes);
    expect(store.get()).toBe(before);
  });

  it('give get() a new object when a setting changes, and the same object until then', () => {
    const store = createSettingsStore({ prefix: PREFIX, storage: new FakeStorage(), prefersReducedMotion: CALM });
    const first = store.get();
    expect(store.get()).toBe(first);
    store.update({ mute: true });
    expect(store.get()).not.toBe(first);
    expect(first.mute).toBe(false);
    expect(Object.isFrozen(store.get())).toBe(true);
  });

  it('can stop themselves, and one that is added during a call is not called in that call', () => {
    const store = createSettingsStore({ prefix: PREFIX, storage: new FakeStorage(), prefersReducedMotion: CALM });
    const order: string[] = [];
    const stopFirst = store.subscribe(() => {
      order.push('first');
      stopFirst();
      store.subscribe(() => order.push('late'));
    });
    store.subscribe(() => order.push('second'));
    store.update({ mute: true });
    expect(order).toEqual(['first', 'second']);
    store.update({ mute: false });
    expect(order).toEqual(['first', 'second', 'second', 'late']);
  });

  it('are all called when one of them throws, and the first error is thrown afterwards', () => {
    const store = createSettingsStore({ prefix: PREFIX, storage: new FakeStorage(), prefersReducedMotion: CALM });
    const calls: string[] = [];
    store.subscribe(() => {
      calls.push('one');
      throw new Error('first');
    });
    store.subscribe(() => {
      calls.push('two');
      throw new Error('second');
    });
    store.subscribe(() => calls.push('three'));
    expect(() => store.update({ mute: true })).toThrow('first');
    expect(calls).toEqual(['one', 'two', 'three']);
    expect(store.get().mute).toBe(true);
  });
});

describe('the motion level (Req 20.6, 20.7)', () => {
  const stateWith = (motion: Settings['motion'] | null): FakeStorage => {
    const storage = new FakeStorage();
    if (motion !== null) storage.data.set(KEY, JSON.stringify({ version: SETTINGS_VERSION, motion }));
    return storage;
  };

  it('follows the browser preference when nothing is stored, and a stored choice when there is one: all four combinations', () => {
    const get = (motion: Settings['motion'] | null, reduced: boolean): Settings['motion'] =>
      createSettingsStore({ prefix: PREFIX, storage: stateWith(motion), prefersReducedMotion: reduced }).get().motion;
    expect(get(null, REDUCED)).toBe('reduced');
    expect(get(null, CALM)).toBe('full');
    expect(get('full', REDUCED)).toBe('full');
    expect(get('reduced', CALM)).toBe('reduced');
    expect(get('gentle', REDUCED)).toBe('gentle');
    expect(get('gentle', CALM)).toBe('gentle');
  });

  it('does not store the browser preference as a choice when another setting changes', () => {
    const storage = new FakeStorage();
    createSettingsStore({ prefix: PREFIX, storage, prefersReducedMotion: REDUCED }).update({ volume: CHOSEN.volume });
    expect(Object.keys(stored(storage) as object)).not.toContain('motion');
    // A later session on a browser that no longer prefers reduced motion follows the browser.
    expect(createSettingsStore({ prefix: PREFIX, storage, prefersReducedMotion: CALM }).get()).toMatchObject({
      motion: 'full',
      volume: CHOSEN.volume,
    });
  });

  it('stores a motion choice, also one equal to what the browser preference gave', () => {
    for (const reduced of [CALM, REDUCED]) {
      const storage = new FakeStorage();
      const store = createSettingsStore({ prefix: PREFIX, storage, prefersReducedMotion: reduced });
      const same = reduced ? 'reduced' : 'full';
      let calls = 0;
      store.subscribe(() => calls++);
      store.update({ motion: same });
      expect(calls, 'the level did not change').toBe(0);
      expect(storage.writes).toEqual([KEY]);
      expect((stored(storage) as { motion?: string }).motion).toBe(same);
      // Stored, it wins over the other answer of the browser.
      expect(createSettingsStore({ prefix: PREFIX, storage, prefersReducedMotion: !reduced }).get().motion).toBe(same);
    }
  });

  it('keeps a stored motion level when another setting changes', () => {
    const storage = stateWith('gentle');
    const store = createSettingsStore({ prefix: PREFIX, storage, prefersReducedMotion: REDUCED });
    store.update({ mute: true });
    expect((stored(storage) as { motion?: string }).motion).toBe('gentle');
    expect(createSettingsStore({ prefix: PREFIX, storage, prefersReducedMotion: CALM }).get().motion).toBe('gentle');
  });

  it('does not take a motion level that is not one of the three as a choice', () => {
    const storage = new FakeStorage();
    const store = createSettingsStore({ prefix: PREFIX, storage, prefersReducedMotion: REDUCED });
    store.update({ motion: 'loud' as Settings['motion'] });
    expect(store.get().motion).toBe('reduced');
    expect(storage.writes).toEqual([]);
  });
});

describe('a patch', () => {
  it('changes only the settings it names', () => {
    const store = createSettingsStore({ prefix: PREFIX, storage: new FakeStorage(), prefersReducedMotion: CALM });
    store.update(CHOSEN);
    store.update({ volume: 1 });
    expect(store.get()).toEqual({ ...CHOSEN, volume: 1 });
    store.update({ hands: null });
    expect(store.get()).toEqual({ ...CHOSEN, volume: 1, hands: null });
    store.update({ mute: false });
    expect(store.get().mute).toBe(false);
  });

  it('gives a setting its default when the value is not valid for it', () => {
    const store = createSettingsStore({ prefix: PREFIX, storage: new FakeStorage(), prefersReducedMotion: CALM });
    store.update(CHOSEN);
    for (const volume of [NaN, Infinity, -Infinity, -0.0001, 1.0001, 2]) {
      store.update({ volume });
      expect(store.get().volume).toBe(TUNING.defaultVolume);
      store.update({ volume: CHOSEN.volume });
    }
    store.update({ hands: 'up' as Settings['hands'] });
    expect(store.get()).toEqual({ ...CHOSEN, hands: null });
  });

  it('keeps the volume 0 and 1', () => {
    const store = createSettingsStore({ prefix: PREFIX, storage: new FakeStorage(), prefersReducedMotion: CALM });
    store.update({ volume: 0 });
    expect(store.get().volume).toBe(0);
    store.update({ volume: 1 });
    expect(store.get().volume).toBe(1);
  });
});

describe('the barrel', () => {
  it('exports createSettingsStore from marrow/react', () => {
    expect(react.createSettingsStore).toBe(createSettingsStore);
  });
});
