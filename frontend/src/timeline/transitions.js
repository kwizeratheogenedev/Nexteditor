// Pure position/transition math shared by the canvas preview
// (useTimelinePlayer.js) and RightPanel's transition UI. Mirrored exactly in
// backend/services/filterGraph/transitionMath.js since the backend's xfade
// `offset=` parameter is derived from the same numbers.
//
// Since M7, every clip carries its own absolute `startTime` (seconds) and
// `trackIndex` (which lane) - position is no longer derived from array
// order/duration accumulation, it's just read off the clip. A clip's
// transitionOut borrows the last `transitionDuration` seconds of its own
// footage and the first `transitionDuration` seconds of the next clip's -
// which only renders correctly if the next clip's stored startTime is
// *already* pulled that far earlier than clip's end (RightPanel's
// commitTransition moves it there when a transition is set/changed, in the
// same commit). `resolveActiveInLane` treats a next clip as "the" transition
// partner only when its startTime matches that expected overlap point -
// this is what distinguishes an intentional transition from a next clip
// that merely happens to overlap in time for an unrelated reason.
import { hasSpeedCurve, speedCurveOutputDuration } from './speedCurve.js';

const ADJACENCY_EPSILON = 0.05;

// The picker in RightPanel and the ffmpeg `xfade` filter selection in
// backend/services/filterGraph/effects/transition.js must both draw from
// this same id list - ids are sent to the backend as clip.transitionOut.type
// and matched there against its own copy of this whitelist (untrusted project
// JSON reaching an ffmpeg filtergraph string, so the backend never trusts an
// id it doesn't recognize). Every id here is a real ffmpeg xfade transition
// name, stable since ffmpeg 4.3 (avoid newer-only names like 'zoomin' - not
// guaranteed present in every ffmpeg-static build).
export const TRANSITION_TYPES = [
  { id: 'fade', label: 'Fade' },
  { id: 'fadeblack', label: 'Fade to Black' },
  { id: 'dissolve', label: 'Dissolve' },
  { id: 'wipeleft', label: 'Wipe Left' },
  { id: 'wiperight', label: 'Wipe Right' },
  { id: 'slideleft', label: 'Slide Left' },
  { id: 'slideright', label: 'Slide Right' },
  { id: 'circleopen', label: 'Circle Open' },
  { id: 'circleclose', label: 'Circle Close' },
  { id: 'pixelize', label: 'Pixelize' },
];
const TRANSITION_TYPE_IDS = new Set(TRANSITION_TYPES.map((t) => t.id));
export function isKnownTransitionType(type) {
  return TRANSITION_TYPE_IDS.has(type);
}

export function clipDuration(clip) {
  if (hasSpeedCurve(clip)) return Math.max(0, speedCurveOutputDuration(clip));
  return Math.max(0, (clip.trimmedEnd - clip.trimmedStart) / (clip.speed || 1));
}

export function clipEndTime(clip) {
  return clip.startTime + clipDuration(clip);
}

export function getTransitionDuration(clipA, clipB) {
  const requested = clipA?.transitionOut?.duration || 0;
  if (requested <= 0 || !clipB) return 0;
  return Math.max(0, Math.min(requested, clipDuration(clipA), clipDuration(clipB)));
}

// Where the next clip's startTime should sit for clipA's transitionOut to
// actually render as a blend against it.
export function expectedTransitionStart(clipA, clipB) {
  return clipEndTime(clipA) - getTransitionDuration(clipA, clipB);
}

// Finds which clip in one lane (already every clip sharing a trackIndex) is
// active at `time`, plus transition blend state when `time` falls in the
// tail-overlap window shared with an intentionally-overlapping next clip.
// `laneClips` need not be pre-sorted. Returns null if nothing is active at
// `time`.
export function resolveActiveInLane(laneClips, time) {
  const sorted = [...laneClips].sort((a, b) => a.startTime - b.startTime);
  for (let i = 0; i < sorted.length; i += 1) {
    const clip = sorted[i];
    const start = clip.startTime;
    const end = clipEndTime(clip);
    if (time < start || time >= end) continue;

    const next = sorted[i + 1];
    const transitionDuration = next && next.trackIndex === clip.trackIndex ? getTransitionDuration(clip, next) : 0;
    if (transitionDuration > 0) {
      const blendStart = end - transitionDuration;
      if (Math.abs(next.startTime - blendStart) < ADJACENCY_EPSILON && time >= blendStart) {
        const progress = Math.max(0, Math.min(1, (time - blendStart) / transitionDuration));
        return { primary: clip, next, progress };
      }
    }
    return { primary: clip };
  }
  return null;
}

export function laneTotalDuration(laneClips) {
  if (!laneClips.length) return 0;
  return Math.max(...laneClips.map(clipEndTime));
}
