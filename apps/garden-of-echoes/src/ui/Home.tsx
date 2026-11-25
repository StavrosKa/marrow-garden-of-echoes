// The Home screen (garden-level design 2.11; requirements 3.1, 3.2, 24.1). Two real DOM buttons, "Start" and "Try without
// camera", and the one-sentence camera explanation before any camera prompt. The screen never requests the camera: Start
// and Try without camera are callbacks, and the app decides what they do (Req 3.2, 3.3).
import type { ReactElement } from 'react';
import { copy } from '../copy';
import { GARDEN_COPY } from '../copy/garden';
import './setup.css';

export interface HomeProps {
  readonly onStart: () => void;
  readonly onTryWithout: () => void;
}

export function Home({ onStart, onTryWithout }: HomeProps): ReactElement {
  return (
    <main className="garden-home">
      <h1>{copy.appName}</h1>
      <p className="garden-explanation">{GARDEN_COPY.camera.why}</p>
      <div className="garden-actions">
        <button type="button" className="garden-button" onClick={onStart}>
          {GARDEN_COPY.home.start}
        </button>
        <button type="button" className="garden-button" onClick={onTryWithout}>
          {GARDEN_COPY.home.noCamera}
        </button>
      </div>
    </main>
  );
}
