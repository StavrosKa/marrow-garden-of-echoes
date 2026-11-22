// The live camera preview (Requirement 22.5, 22.6). It shows a MediaStream in its own video element,
// mirrored and at most `maxWidth` CSS px wide. The Camera Source owns the stream's tracks, so this
// component detaches the stream on unmount or when the stream changes, and never stops a track.
//
// The width cap is the video's width attribute, with max-width: 100% in marrow.css. The attribute
// is a presentation hint, so the element is `maxWidth` wide, or less where the space is smaller.
// No style attribute is used, because tests/marrow-styles.test.ts forbids one in component sources.
import { useEffect, useRef } from 'react';
import { useMarrowCopy } from './marrowCopy';

export interface CameraPreviewProps {
  /** The stream to show, or null to show nothing. The app passes the stream its Camera Source uses. */
  stream: MediaStream | null;
  /** The largest width the preview may take, in CSS px (Requirement 22.5: 320). */
  maxWidth: number;
}

export function CameraPreview({ stream, maxWidth }: CameraPreviewProps) {
  const copy = useMarrowCopy();
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = video.current;
    if (element === null || stream === null) return undefined;
    element.srcObject = stream;
    return () => {
      // Detach only. The tracks belong to the Camera Source, which stops them on dispose (Requirement 5.6).
      element.srcObject = null;
    };
  }, [stream]);
  if (stream === null) return null;
  return (
    <video
      ref={video}
      className="marrow-camera-preview"
      aria-label={copy.camera.previewLabel}
      width={maxWidth}
      autoPlay
      muted
      playsInline
    />
  );
}
