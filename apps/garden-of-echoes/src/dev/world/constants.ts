// App values of the world slice (design 8.3). Tuning numbers live in world-view's TUNING; the values
// here are the app's own choices.
import { colourNumber, type ThemeToken } from '../../ui/theme';

/** The delay between the second stop-1 selection and the travel, in session time (Req 13.1; Appendix B). */
export const REWARD_DELAY_MS = 1500;

/**
 * The drawn disc of a target as a fraction of its hit radius. Steering section 4 wants the visible
 * circle smaller than the hit circle. The hit circle does not use this value.
 */
export const TARGET_VISUAL_RATIO = 0.5;

/** The darkest grey of the ramp: the cover over the viewport during a cross-fade (Req 13.5). */
export const COVER_COLOUR_TOKEN: ThemeToken = 'grey0';
export const COVER_COLOUR: number = colourNumber(COVER_COLOUR_TOKEN);

/** Target colours: unselected, and selected (Req 12.7). */
export const TARGET_TOKEN: ThemeToken = 'grey6';
export const TARGET_SELECTED_TOKEN: ThemeToken = 'lanternWarm';

/** The least frame time between two React updates while nothing a player sees changes (about 10 per second). */
export const DEBUG_REFRESH_MS = 100;

/** The aspect that the content test uses as the narrow end of the range (a test parameter, design 5.1). */
export const ASPECT_MIN = 1;

/** The aspect the slice loads with when no window size is given. */
export const DEFAULT_ASPECT = 16 / 9;
