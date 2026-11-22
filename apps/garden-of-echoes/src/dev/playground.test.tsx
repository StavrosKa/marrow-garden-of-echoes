// @vitest-environment jsdom
// The playground's load check (Req 1.4, 26.3): an invalid tuning or content shows its message instead of running.
import { render, screen } from '@testing-library/react';
import { formatTuningErrors, TUNING, validateTuning } from 'marrow/core';
import { describe, expect, it } from 'vitest';
import { Playground } from './playground';

describe('Playground load check', () => {
  it('runs with the shipped tuning and content', () => {
    render(<Playground />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Input playground');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the tuning message instead of running when the tuning is invalid', () => {
    const bad = { ...TUNING, hitRadius: 0.5 };
    const expected = formatTuningErrors(validateTuning(bad));
    expect(expected).toContain('hitRadius');
    const { container } = render(<Playground tuning={bad} />);
    expect(screen.getByRole('alert').textContent).toBe('The tuning needs a fix before the playground can run.');
    expect(container.querySelector('pre')?.textContent).toBe(expected);
    expect(screen.queryByRole('heading', { level: 2 })).not.toBeNull();
  });

  it('shows the content message when the content is invalid', () => {
    const { container } = render(<Playground content={{ targetCount: 3, slots: [{ x: 0.2, y: 1.4 }] }} />);
    expect(screen.getByRole('alert').textContent).toBe('The playground content needs a fix before it can run.');
    expect(container.querySelector('pre')?.textContent).toBe(
      'playground-content.json: slots[0].y = 1.4 is out of range [0, 1]',
    );
  });
});
