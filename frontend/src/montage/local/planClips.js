// "Render on this device (beta)" - everything under montage/local/ is the
// experiment of making a Montage in the browser instead of on the server.
// The server Montage (backend/routes/createMontage.js) is untouched and
// remains the default; deleting this folder and the switch in MontageTab
// removes the experiment completely.
//
// Clip planning, copied rule for rule from createMontage.js so a device
// montage is cut exactly like a server one: 3 or 4 second clips taking
// turns between the videos, each starting at a random point after the
// "skip intro" seconds and never overlapping another clip from the same
// video, until the song is covered.

export const MIN_CLIP_DURATION = 3;
export const MAX_CLIP_DURATION = 4;
export const DEFAULT_SKIP_INPUT_VIDEO_SECONDS = 40;
export const MAX_SKIP_INPUT_VIDEO_SECONDS = 600;

export function parseSkipSeconds(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_SKIP_INPUT_VIDEO_SECONDS;
  return Math.min(parsed, MAX_SKIP_INPUT_VIDEO_SECONDS);
}

export function pickClipDuration(remainingDuration, syncMode, tempoSensitivity, random = Math.random) {
  if (remainingDuration <= MIN_CLIP_DURATION) return remainingDuration;
  if (remainingDuration <= MAX_CLIP_DURATION) return remainingDuration;

  const baseWeight = {
    beat: { min: 0.65, max: 0.35 },
    scene: { min: 0.35, max: 0.65 },
    auto: { min: 0.5, max: 0.5 },
  }[syncMode] || { min: 0.5, max: 0.5 };

  const tempoAdjustment = {
    gentle: { min: 0.35, max: 0.65 },
    medium: { min: 0.5, max: 0.5 },
    aggressive: { min: 0.75, max: 0.25 },
  }[tempoSensitivity] || { min: 0.5, max: 0.5 };

  const weightMin = Math.min(baseWeight.min, tempoAdjustment.min);
  return random() < weightMin ? MIN_CLIP_DURATION : MAX_CLIP_DURATION;
}

export function pickRandomStart(duration, clipDuration, usedRanges, skipSeconds = 0, random = Math.random) {
  if (duration <= clipDuration) {
    usedRanges.push({ start: 0, end: clipDuration });
    return 0;
  }

  const minStart = Math.min(skipSeconds, Math.max(0, duration - clipDuration));
  const maxStart = Math.max(minStart, duration - clipDuration);
  const safetyGap = 1;

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const candidate = minStart + (random() * (maxStart - minStart));
    const overlaps = usedRanges.some((range) => (
      candidate < (range.end + safetyGap) && (candidate + clipDuration) > (range.start - safetyGap)
    ));
    if (!overlaps) {
      usedRanges.push({ start: candidate, end: candidate + clipDuration });
      return candidate;
    }
  }

  const fallback = minStart + (random() * (maxStart - minStart));
  usedRanges.push({ start: fallback, end: fallback + clipDuration });
  return fallback;
}

// [{ sourceIndex, startTime, clipDuration }] covering `audioDuration`.
export function planClips({ audioDuration, videoDurations, syncMode, tempoSensitivity, skipSeconds, random = Math.random }) {
  const clipPlan = [];
  const usedRangesBySource = videoDurations.map(() => []);
  let remainingDuration = audioDuration;
  let sourceIndex = 0;

  while (remainingDuration > 0.05) {
    const clipDuration = pickClipDuration(remainingDuration, syncMode, tempoSensitivity, random);
    const startTime = pickRandomStart(videoDurations[sourceIndex], clipDuration, usedRangesBySource[sourceIndex], skipSeconds, random);
    clipPlan.push({ sourceIndex, startTime, clipDuration });
    remainingDuration -= clipDuration;
    sourceIndex = (sourceIndex + 1) % videoDurations.length;
  }
  return clipPlan;
}
