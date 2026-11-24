// The ?start shortcut (garden-level design 2.6; requirements 20.1 to 20.5). Pure: it reads the query string and says
// which screen to show. A stage plan is always simulated input over the whole frame, and it has no camera step, so the
// camera is never requested (Req 20.2, 20.3). An unknown id gives the app screen, not a crash (Req 20.5).
import { parseStartParam, type StageId } from './stageOrder';

export type StartPlan =
  | { readonly kind: 'stage'; readonly stage: StageId; readonly input: 'simulated'; readonly reach: 'frame'; readonly label: 'label.simulated' }
  | { readonly kind: 'app' };

/** The plan for a query string such as "?start=lantern-glade". It never throws. */
export function startPlan(search: string): StartPlan {
  const stage = parseStartParam(new URLSearchParams(search).get('start'));
  if (stage === null) return { kind: 'app' };
  return { kind: 'stage', stage, input: 'simulated', reach: 'frame', label: 'label.simulated' };
}
