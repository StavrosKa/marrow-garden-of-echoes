// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FIXTURE_COPY } from './copyFixture';
import { CameraPreview } from './cameraPreview';
import { MarrowCopyProvider } from './marrowCopy';
// Requirements 22.5 and 22.6: the preview shows the stream, is mirrored and width-capped, and detaches
// the stream on unmount without stopping the tracks, which the Camera Source owns. jsdom has no media
// element, so the test checks the srcObject property the component sets.
/** The video element's srcObject, as the component sets it. */
type WithSource = HTMLVideoElement & { srcObject: MediaStream | null };
/** A stream with two tracks whose stop calls are recorded. */
function fakeStream(): { stream: MediaStream; stops: ReturnType<typeof vi.fn>[] } {
  const stops = [vi.fn(), vi.fn()];
  const tracks = stops.map((stop) => ({ stop }));
  const stream = { getTracks: () => tracks } as unknown as MediaStream;
  return { stream, stops };
}
const PREVIEW_CAP = 240;
function renderPreview(stream: MediaStream | null) {
  return render(
    <MarrowCopyProvider value={FIXTURE_COPY}>
      <CameraPreview stream={stream} maxWidth={PREVIEW_CAP} />
    </MarrowCopyProvider>,
  );
}
describe('CameraPreview', () => {
  it('shows the stream in a named video element, muted and inline', () => {
    const { stream } = fakeStream();
    renderPreview(stream);
    const video = screen.getByLabelText(FIXTURE_COPY.camera.previewLabel);
    expect(video.tagName).toBe('VIDEO');
    expect((video as WithSource).srcObject).toBe(stream);
    expect((video as HTMLVideoElement).muted).toBe(true);
  });
  it('is mirrored by its class, and its width is the cap the app passes in', () => {
    const { stream } = fakeStream();
    renderPreview(stream);
    const video = screen.getByLabelText(FIXTURE_COPY.camera.previewLabel);
    expect(video).toHaveClass('marrow-camera-preview');
    expect(video).toHaveAttribute('width', String(PREVIEW_CAP));
    expect(video).not.toHaveAttribute('style');
  });
  it('renders nothing without a stream', () => {
    renderPreview(null);
    expect(screen.queryByLabelText(FIXTURE_COPY.camera.previewLabel)).not.toBeInTheDocument();
  });
  it('detaches the stream on unmount and stops no track', () => {
    const { stream, stops } = fakeStream();
    const { unmount } = renderPreview(stream);
    const video = screen.getByLabelText(FIXTURE_COPY.camera.previewLabel) as WithSource;
    unmount();
    expect(video.srcObject).toBeNull();
    for (const stop of stops) expect(stop).not.toHaveBeenCalled();
  });
  it('switches to the new stream when the stream changes, and detaches the old one', () => {
    const first = fakeStream();
    const second = fakeStream();
    const { rerender } = renderPreview(first.stream);
    const video = screen.getByLabelText(FIXTURE_COPY.camera.previewLabel) as WithSource;
    rerender(
      <MarrowCopyProvider value={FIXTURE_COPY}>
        <CameraPreview stream={second.stream} maxWidth={PREVIEW_CAP} />
      </MarrowCopyProvider>,
    );
    expect(video.srcObject).toBe(second.stream);
    for (const stop of first.stops) expect(stop).not.toHaveBeenCalled();
  });
});
