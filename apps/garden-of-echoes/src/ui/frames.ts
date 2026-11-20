// Browser frame callbacks for marrow's Pointer Source. The Pointer Source asks for one callback per
// animation frame and only samples the pointer in it; it draws nothing. The calls sit here, outside
// dev/world, because the slice's source scan forbids requestAnimationFrame inside the slice.
export const browserFrames = {
  request: (callback: (timestamp: number) => void): number => window.requestAnimationFrame(callback),
  cancel: (handle: number): void => window.cancelAnimationFrame(handle),
};
