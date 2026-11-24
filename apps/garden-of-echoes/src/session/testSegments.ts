// Test fixture: the journey segments of design 4.1. The machine takes its segments as an argument, and task 6
// loads them from segments.json. Until then the tests and the scripted run use these values. The app does not
// import this file.
import type { JourneySegments } from './machine';

export const TEST_SEGMENTS: JourneySegments = Object.freeze({
  journeyA: { from: 0, to: 8, durationMs: 6000 },
  journeyB: { from: 8, to: 16, durationMs: 6000 },
  doorHall: { from: 16, to: 17, durationMs: 3000 },
  doorGarden: { from: 17, to: 18, durationMs: 3000 },
});
