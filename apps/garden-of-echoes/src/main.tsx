import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { copy } from './copy';
import { isPlaygroundRoute } from './dev/playgroundRoute';
import { isWorldRoute } from './dev/world/route';
import { App } from './ui/App';
import { GardenStage } from './ui/GardenStage';
import { startPlan } from './session/startEntry';
const root = document.getElementById('root');
if (!root) {
  throw new Error('Missing #root element');
}
document.title = copy.appName;
const plan = startPlan(window.location.search);
const rootElement = createRoot(root);
if (isWorldRoute(window.location.search)) {
  // The playground is loaded only on its route, so the normal page never loads it (Req 11.1).
  void import('./dev/world/WorldPlayground').then(({ WorldPlayground }) => {
    rootElement.render(
      <StrictMode>
        <WorldPlayground />
      </StrictMode>,
    );
  });
} else if (isPlaygroundRoute(window.location.search)) {
  // The input playground is a separate chunk, loaded only on ?playground=1 (Req 26.1, 26.2).
  void import('./dev/playground').then(({ Playground }) => {
    rootElement.render(
      <StrictMode>
        <Playground />
      </StrictMode>,
    );
  });
} else if (plan.kind === 'stage') {
  // The ?start shortcut: one stage, in simulated input over the whole frame. The camera is never requested (Req 20.2).
  rootElement.render(
    <StrictMode>
      <GardenStage stage={plan.stage} />
    </StrictMode>,
  );
} else {
  rootElement.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
