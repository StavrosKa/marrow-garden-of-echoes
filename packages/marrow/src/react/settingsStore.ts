// The settings store (Requirement 20, design section 5): the storage half. It keeps the four
// settings of core/settings.ts in memory, writes them to localStorage as one versioned JSON value,
// and tells its subscribers synchronously when something changes. It holds no React: the provider
// and the hook that wrap it come in a later task.
//
// Decisions the requirements leave open (each is recorded in docs/kiro-journal.md):
//  - The one key is the app's prefix followed by SETTINGS_KEY_NAME. The store reads and writes
//    that key and no other (Req 20.2, 20.9).
//  - After the first failure of storage (a read or a write that throws) the store never touches
//    storage again: the settings stay in memory for the rest of the page's life (Req 20.5). The
//    memory copy is always the value that get() returns, so a read after a failed write returns
//    the value just set.
//  - A browser preference is not a choice. The motion level is written only once it is stored or
//    the player has set it, so a player who changed only the volume still follows the browser
//    preference next time (Req 20.6, 20.7). Setting the motion level to the value it already has
//    still counts as a choice, and is written.
//  - update() with nothing changed writes nothing and notifies nobody, so get() keeps returning the
//    same object until a setting changes.
//  - A value in a patch that is not valid for its setting takes that setting's default, the rule
//    the parser applies to stored data.
//  - Subscribers are called in the order they subscribed, after the memory copy and the write are
//    done. If one throws, the others are still called and the first error is thrown afterwards.
import { parseSettings, serializeSettings, type Settings } from '../core';

/** The part of localStorage the store uses. */
export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface SettingsStoreOptions {
  /** The prefix of every key the store writes, chosen by the app. */
  prefix: string;
  /**
   * Where to keep the settings. Left out (or undefined): `window.localStorage`, read inside a
   * try/catch. null: no storage, memory only.
   */
  storage?: SettingsStorage | null;
  /** Whether the browser reports `prefers-reduced-motion: reduce`. Decides the motion level until one is stored. */
  prefersReducedMotion: boolean;
}

export interface SettingsStore {
  /** The current settings. The same object until a setting changes. */
  get(): Readonly<Settings>;
  /** Change some of the settings. Subscribers are called before this returns. */
  update(patch: Partial<Settings>): void;
  /** Call `listener` after every change. Returns the function that stops it; calling that twice does nothing. */
  subscribe(listener: () => void): () => void;
}

/** The part of the key after the app's prefix. */
export const SETTINGS_KEY_NAME = 'settings';

/** localStorage, or null where there is none or reading it throws (a blocked or sandboxed page). */
function defaultStorage(): SettingsStorage | null {
  try {
    const found = window.localStorage as SettingsStorage | null | undefined;
    return found ?? null;
  } catch {
    return null;
  }
}

function sameSettings(a: Settings, b: Settings): boolean {
  return a.motion === b.motion && a.mute === b.mute && Object.is(a.volume, b.volume) && a.hands === b.hands;
}

export function createSettingsStore(options: SettingsStoreOptions): SettingsStore {
  const env = { prefersReducedMotion: options.prefersReducedMotion };
  const key = `${options.prefix}${SETTINGS_KEY_NAME}`;
  let storage: SettingsStorage | null = options.storage === undefined ? defaultStorage() : options.storage;

  let raw: string | null = null;
  if (storage !== null) {
    try {
      raw = storage.getItem(key);
    } catch {
      storage = null;
    }
  }
  let current: Readonly<Settings> = Object.freeze(parseSettings(raw, env));
  // A stored motion level is a choice. Read with each answer of the browser preference, stored
  // data gives the same level, and with none stored the two answers differ.
  let motionChosen =
    parseSettings(raw, { prefersReducedMotion: true }).motion ===
    parseSettings(raw, { prefersReducedMotion: false }).motion;

  const listeners: { readonly call: () => void }[] = [];

  function write(): void {
    if (storage === null) return;
    try {
      const written = JSON.parse(serializeSettings(current)) as Record<string, unknown>;
      if (!motionChosen) delete written['motion'];
      storage.setItem(key, JSON.stringify(written));
    } catch {
      storage = null;
    }
  }

  function notify(): void {
    let failure: { error: unknown } | null = null;
    for (const entry of [...listeners]) {
      try {
        entry.call();
      } catch (error) {
        failure ??= { error };
      }
    }
    if (failure !== null) throw failure.error;
  }

  return {
    get: () => current,
    update(patch) {
      const next = parseSettings(
        serializeSettings({
          motion: patch.motion ?? current.motion,
          mute: patch.mute ?? current.mute,
          volume: patch.volume ?? current.volume,
          hands: patch.hands === undefined ? current.hands : patch.hands,
        }),
        env,
      );
      const changed = !sameSettings(current, next);
      const choosesMotion = !motionChosen && patch.motion !== undefined && patch.motion === next.motion;
      if (!changed && !choosesMotion) return;
      if (choosesMotion) motionChosen = true;
      current = Object.freeze(next);
      write();
      if (changed) notify();
    },
    subscribe(listener) {
      const entry = { call: listener };
      listeners.push(entry);
      return () => {
        const at = listeners.indexOf(entry);
        if (at >= 0) listeners.splice(at, 1);
      };
    },
  };
}
