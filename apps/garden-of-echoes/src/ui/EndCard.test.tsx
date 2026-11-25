// @vitest-environment jsdom
// The end card (garden-level requirement 9.3). Tests assert the test id; the text is checked against its copy key.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { GARDEN_COPY } from '../copy/garden';
import { EndCard } from './EndCard';

describe('EndCard (requirement 9.3)', () => {
  it('9.3: its container carries the test id end-card', () => {
    render(<EndCard onExit={() => undefined} />);
    expect(screen.getByTestId('end-card')).toBeTruthy();
  });

  it('9.3: shows the end line from the copy', () => {
    render(<EndCard onExit={() => undefined} />);
    expect(screen.getByTestId('end-card').textContent).toContain(GARDEN_COPY.end.card);
  });

  it('24.1 24.5: Exit is a real button with an accessible name, and it calls onExit once', async () => {
    const onExit = vi.fn();
    const user = userEvent.setup();
    render(<EndCard onExit={onExit} />);
    await user.click(screen.getByRole('button', { name: GARDEN_COPY.pause.exit }));
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
