// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as react from './index';
import { MarrowCopyProvider, useMarrowCopy, type MarrowCopy } from './marrowCopy';
import { FIXTURE_COPY } from './copyFixture';

// Requirement 21.1: every string comes from the MarrowCopy object the app supplies.

/** Shows one string from the copy, read through the hook. */
function Probe({ pick }: { pick: (copy: MarrowCopy) => string }) {
  const copy = useMarrowCopy();
  return <p>{pick(copy)}</p>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MarrowCopyProvider and useMarrowCopy', () => {
  it('supplies the strings of the object it is given', () => {
    render(
      <MarrowCopyProvider value={FIXTURE_COPY}>
        <Probe pick={(copy) => copy.start.title} />
      </MarrowCopyProvider>,
    );
    expect(screen.getByText(FIXTURE_COPY.start.title)).toBeInTheDocument();
  });

  it('gives the nearest provider to a component below two of them', () => {
    const inner: MarrowCopy = { ...FIXTURE_COPY, start: { title: 'Inner title', start: 'Inner start' } };
    render(
      <MarrowCopyProvider value={FIXTURE_COPY}>
        <Probe pick={(copy) => copy.start.title} />
        <MarrowCopyProvider value={inner}>
          <Probe pick={(copy) => copy.start.title} />
        </MarrowCopyProvider>
      </MarrowCopyProvider>,
    );
    expect(screen.getByText(FIXTURE_COPY.start.title)).toBeInTheDocument();
    expect(screen.getByText('Inner title')).toBeInTheDocument();
  });

  it('throws, with a message, when a component asks for the copy without a provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Probe pick={(copy) => copy.start.title} />)).toThrow(
      'useMarrowCopy must be used inside a MarrowCopyProvider.',
    );
  });

  it('is exported from marrow/react, and the copy type is', () => {
    expect(react.MarrowCopyProvider).toBe(MarrowCopyProvider);
    expect(react.useMarrowCopy).toBe(useMarrowCopy);
    const typed: MarrowCopy = FIXTURE_COPY;
    expect(typed.camera.useCamera).toBe(FIXTURE_COPY.camera.useCamera);
  });
});
