// The ?start shortcut (requirements 20.1 to 20.5). The plan is pure, so the tests read it from query strings.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { hasCopyKey } from '../copy/garden';
import { startPlan } from './startEntry';
import { STAGE_IDS } from './stageOrder';

const appSrc = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('the ?start shortcut', () => {
  it('20.1: each of the four stage ids gives a stage plan for that stage', () => {
    for (const stage of STAGE_IDS) {
      const plan = startPlan(`?start=${stage}`);
      expect(plan).toMatchObject({ kind: 'stage', stage });
    }
  });

  it('20.5: an unknown id, an empty value, another parameter and no parameter give the app plan, and nothing throws', () => {
    for (const search of ['?start=nope', '?start=', '?start=Lantern-Glade', '?other=1', '', '?start=%00']) {
      expect(startPlan(search)).toEqual({ kind: 'app' });
    }
  });

  it('20.2 20.3: a stage plan is simulated input over the whole frame, and it has no camera step', () => {
    const plan = startPlan('?start=lantern-glade');
    expect(plan.kind).toBe('stage');
    if (plan.kind !== 'stage') return;
    expect(plan.input).toBe('simulated');
    expect(plan.reach).toBe('frame');
  });

  it('20.4: a stage plan carries the simulated-input label, and that label is a copy key', () => {
    const plan = startPlan('?start=lantern-glade');
    expect(plan.kind === 'stage' ? plan.label : null).toBe('label.simulated');
    expect(hasCopyKey('label.simulated')).toBe(true);
  });

  it('20.2: the entry files never request the camera', () => {
    const files = ['main.tsx', 'ui/GardenStage.tsx', 'session/startEntry.ts'];
    for (const file of files) {
      const text = readFileSync(path.join(appSrc, ...file.split('/')), 'utf8');
      expect(text, file).not.toMatch(/createCameraSource|startCamera|getUserMedia/);
    }
  });
});
