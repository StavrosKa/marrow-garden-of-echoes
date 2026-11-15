import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { copy } from './copy';
import { App } from './ui/App';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Missing #root element');
}
document.title = copy.appName;
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);