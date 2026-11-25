// @vitest-environment jsdom
// The calibration explainer (requirements 11.1 to 11.4). The contrast checks read the theme's own tokens, through the
// contrast helper of ui/contrast.ts.
import { render, screen } from '@testing-library/react';
import { TUNING } from 'marrow/core';
import { describe, expect, it } from 'vitest';
import { gardenMarrowCopy } from '../copy/gardenMarrowCopy';
import { GARDEN_COPY } from '../copy/garden';
import { contrastRatio, WCAG_TEXT_MIN_RATIO } from './contrast';
import { CalibrationExplainer, ringFraction } from './CalibrationExplainer';
import { theme } from './theme';

/** The least contrast of a non-text graphic against its background (WCAG 1.4.11). */
const WCAG_GRAPHIC_MIN_RATIO = 3;

describe('ringFraction (requirement 11.2)', () => {
  it('11.2: the ring is empty at no painting time, half full at half the nominal time, and full at the nominal time', () => {
    expect(ringFraction(0)).toBe(0);
    expect(ringFraction(TUNING.calibNominalMs / 2)).toBe(0.5);
    expect(ringFraction(TUNING.calibNominalMs)).toBe(1);
  });

  it('11.2: the ring stays full beyond the nominal time, and a time that is not a number fills nothing', () => {
    expect(ringFraction(TUNING.calibNominalMs * 3)).toBe(1);
    expect(ringFraction(-5)).toBe(0);
    expect(ringFraction(Number.NaN)).toBe(0);
  });
});

describe('the calibration explainer (requirements 11.1 to 11.4)', () => {
  it('11.3: shows the sentence "Reach ends where the camera\'s view ends."', () => {
    render(<CalibrationExplainer paintingMs={0} />);
    expect(screen.getByText(GARDEN_COPY.calibrate.edge).tagName).toBe('P');
  });

  it('11.1 11.4: the painted area is a named image, named by the sentence', () => {
    render(<CalibrationExplainer paintingMs={0} />);
    expect(screen.getByRole('img', { name: GARDEN_COPY.calibrate.edge }).className).toContain('garden-painted-area');
  });

  it('11.4: the ring is a named image, named by the painting instruction', () => {
    render(<CalibrationExplainer paintingMs={0} />);
    expect(screen.getByRole('img', { name: gardenMarrowCopy.instructions.painting }).tagName.toLowerCase()).toBe('svg');
  });

  it('11.2: the ring carries no number, no seconds count and no countdown, so the only text is the sentence', () => {
    const { container } = render(<CalibrationExplainer paintingMs={TUNING.calibNominalMs / 4} />);
    expect(container.textContent).toBe(GARDEN_COPY.calibrate.edge);
    expect(container.textContent).not.toMatch(/\d/);
  });

  it('11.2: the progress circle shows the painting time as its filled part', () => {
    const { container } = render(<CalibrationExplainer paintingMs={TUNING.calibNominalMs / 4} />);
    const progress = container.querySelector('.garden-ring__progress');
    expect(progress?.getAttribute('stroke-dashoffset')).toBe('0.75');
  });

  it('11.4: the sentence meets the text contrast rule on the theme background', () => {
    expect(contrastRatio(theme.grey7, theme.grey0)).toBeGreaterThanOrEqual(WCAG_TEXT_MIN_RATIO);
  });

  it('11.4: the ring and the painted area meet the graphic contrast rule against their backgrounds', () => {
    expect(contrastRatio(theme.lanternWarm, theme.grey4)).toBeGreaterThanOrEqual(WCAG_GRAPHIC_MIN_RATIO);
    expect(contrastRatio(theme.lanternWarm, theme.grey0)).toBeGreaterThanOrEqual(WCAG_GRAPHIC_MIN_RATIO);
  });
});
