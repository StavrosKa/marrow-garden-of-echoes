// The input playground route (Req 26.1). Only ?playground=1 selects it. The world route (?playground=world)
// is checked first in main.tsx and keeps its own module.
const PARAM = 'playground';
const VALUE = '1';

/** Whether a location's query string selects the input playground. */
export function isPlaygroundRoute(search: string): boolean {
  return new URLSearchParams(search).get(PARAM) === VALUE;
}
