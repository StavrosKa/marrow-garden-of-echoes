// The React side of the settings store (Requirement 20.8, design section 5). The provider holds a
// store made by createSettingsStore, and the hook reads it. The app makes the store, because only
// the app knows its storage prefix. A change reaches the components inside the same call that made
// it: the store notifies its subscribers before update returns, and React reads the new snapshot.
import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { Settings } from '../core';
import type { SettingsStore } from './settingsStore';

const SettingsContext = createContext<SettingsStore | null>(null);

export interface SettingsProviderProps {
  store: SettingsStore;
  children: ReactNode;
}

export function SettingsProvider({ store, children }: SettingsProviderProps) {
  return <SettingsContext.Provider value={store}>{children}</SettingsContext.Provider>;
}

export interface SettingsView {
  /** The current settings. The same object until a setting changes. */
  settings: Readonly<Settings>;
  /** Change some of the settings. The components inside the provider are told before this returns. */
  update: (patch: Partial<Settings>) => void;
}

/** The settings and the way to change them. Throws when there is no SettingsProvider above it. */
export function useSettings(): SettingsView {
  const store = useContext(SettingsContext);
  if (store === null) throw new Error('useSettings must be used inside a SettingsProvider.');
  const settings = useSyncExternalStore(store.subscribe, store.get);
  return { settings, update: store.update };
}
