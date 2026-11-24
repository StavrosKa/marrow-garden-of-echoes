// The entry point marrow/sim (garden-level design 1.2, 2.5). Content-free pieces of the simulator: the profiles,
// the seeded choices and frames, the calibration reach, the invariant log and the report. The app's dev script
// wires them to the session.
export { SIM_PROFILES, validateSimTuning, type ProfileName, type SimProfile, type TrackingGap } from './tuning';
export { chooseFor, framesFor } from './player';
export { sweepSamples } from './calibrationSweep';
export { startInvariantLog, checkInvariant, type InvariantLog } from './invariants';
export { formatReport, exitCodeFor, type RunSummary } from './report';
