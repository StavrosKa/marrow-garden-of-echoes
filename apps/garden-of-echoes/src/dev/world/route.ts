// The world route (Req 11.1, 15.4). Only this query value loads the playground.
const PARAM = 'playground';
const VALUE = 'world';

/** Whether a location's query string selects the world playground. */
export function isWorldRoute(search: string): boolean {
  return new URLSearchParams(search).get(PARAM) === VALUE;
}
