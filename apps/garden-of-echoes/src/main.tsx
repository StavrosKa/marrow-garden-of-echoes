import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { copy } from './copy';
import { isWorldRoute } from './dev/world/route';
import { App } from './ui/App';
const root = document.getElementById('root');
if (!root) {
  throw new Error('Missing #root element');
}
document.title = copy.appName;
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
} else {
  rootElement.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
