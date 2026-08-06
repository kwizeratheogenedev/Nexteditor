// Mirrors frontend/src/timeline/transitions.js exactly - both must agree on
// clip timing, since the frontend preview and this backend graph builder
// have to reach the same rendered result. Since M7 every clip carries an
// absolute `startTime` (seconds) + `trackIndex` (lane); `clipDuration` is
// passed in by the caller (index.js) since it's a small pure function
// already defined there.
const ADJACENCY_EPSILON = 0.05;

export function clipEndTime(clip, clipDuration) {
  return clip.startTime + clipDuration(clip);
}

export function getTransitionDuration(clipA, clipB, clipDuration) {
  const requested = clipA?.transitionOut?.duration || 0;
  if (requested <= 0 || !clipB) return 0;
  return Math.max(0, Math.min(requested, clipDuration(clipA), clipDuration(clipB)));
}

// clipB is clipA's intentional transition partner only when its startTime
// sits exactly where the overlap should start (clipEndTime(clipA) -
// transitionDuration) - RightPanel's commitTransition moves clipB there in
// the same commit whenever a transition is set/changed, so this is what
// distinguishes "these two clips are meant to cross-fade" from "these two
// clips just happen to overlap in time."
export function isTransitionPartner(clipA, clipB, clipDuration) {
  if (!clipB || clipA.trackIndex !== clipB.trackIndex) return false;
  const transitionDuration = getTransitionDuration(clipA, clipB, clipDuration);
  if (transitionDuration <= 0) return false;
  const expectedStart = clipEndTime(clipA, clipDuration) - transitionDuration;
  return Math.abs(clipB.startTime - expectedStart) < ADJACENCY_EPSILON;
}

export function laneTotalDuration(laneClips, clipDuration) {
  if (!laneClips.length) return 0;
  return Math.max(...laneClips.map((clip) => clipEndTime(clip, clipDuration)));
}
