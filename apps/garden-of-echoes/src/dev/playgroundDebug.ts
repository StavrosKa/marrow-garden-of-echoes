// The debug overlay of the playground (Req 25.1, 25.5; task 17.9). This file holds the pure parts: whether the URL asks
// for the overlay, the window of the recorded times, and when the overlay's snapshot is refreshed. The controller builds
// the snapshot in the frame it draws, and the component renders the latest refreshed snapshot.
import { TUNING } from 'marrow/core';

/**
 * The Debug Overlay is refreshed at most this often, in frame time, unless something a player sees changes (the same
 * value as the world slice's DEBUG_REFRESH_MS). Without the throttle the overlay would re-render at the animation frame
 * rate, which costs frames in camera mode (measured in the world slice, journal 2026-11-21). App value, not in tuning.ts.
 */
export const DEBUG_REFRESH_MS = 100;

/** Whether the page asks for the overlay: `debug=1` in the query string, and no other value (Req 25.1). */
export function isDebugRequested(search: string): boolean {
  return new URLSearchParams(search).get('debug') === '1';
}

/** The times that fall in the debug window that ends at nowMs (the window of debugRates.ts). Older times are dropped. */
export function keepDebugWindow(timesMs: readonly number[], nowMs: number): number[] {
  const from = nowMs - TUNING.debugRateWindowMs;
  return timesMs.filter((time) => time > from && time <= nowMs);
}

/**
 * Whether the overlay's snapshot is refreshed now: when a change a player sees happened, or when DEBUG_REFRESH_MS of
 * frame time have passed since the last refresh.
 */
export function refreshDue(input: { readonly changed: boolean; readonly nowMs: number; readonly lastMs: number }): boolean {
  return input.changed || input.nowMs - input.lastMs >= DEBUG_REFRESH_MS;
}
