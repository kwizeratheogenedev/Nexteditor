// Server-side layout of a LongMix Studio project: where every song starts,
// where the background scenes change, and the YouTube chapter list. It is
// the same arithmetic as frontend/src/timeline/longMix.js (expand-to-target,
// placeSongs, sceneBoundaries, buildSceneClips) - keep the two in sync - but
// run against the songs' REAL durations as ffprobe measured them rather than
// whatever the browser reported, and in whole audio samples / video frames so
// the audio and video tracks that get rendered separately still line up
// exactly.

export const SAMPLE_RATE = 48000;

// The camera moves the panel offers (frontend/src/timeline/motionPresets.js),
// reduced to what the renderer needs: zoom and horizontal-pan endpoints.
// `pan` is transform.x's unit - a percent of half the canvas width.
const PAN_ZOOM = 1.18;
const PAN_TRAVEL = 8;
export const MOTION_PRESETS = {
  'zoom-in': { z0: 1, z1: 1.15, x0: 0, x1: 0 },
  'zoom-out': { z0: 1.15, z1: 1, x0: 0, x1: 0 },
  'pan-right': { z0: PAN_ZOOM, z1: PAN_ZOOM, x0: PAN_TRAVEL, x1: -PAN_TRAVEL },
  'pan-left': { z0: PAN_ZOOM, z1: PAN_ZOOM, x0: -PAN_TRAVEL, x1: PAN_TRAVEL },
};
export const STILL_MOTION = { z0: 1, z1: 1, x0: 0, x1: 0 };

const MIN_SCENE_SECONDS = 0.5;
const TAIL_FADE_SECONDS = 2;
// A runaway guard for the loop expansion, same idea as the client's.
const MAX_EXPANDED_SONGS = 5000;

function toSamples(seconds) {
  return Math.max(1, Math.round(seconds * SAMPLE_RATE));
}

// `songs`: [{ sourceId, title, duration }] in the order they were added.
// Repeats the playlist until it reaches `targetMinutes` (0 = play once).
function expandToTarget(songs, targetMinutes, crossfade) {
  const target = (Number(targetMinutes) || 0) * 60;
  if (!(target > 0) || !songs.length) return songs;
  const expanded = [];
  let total = 0;
  let index = 0;
  while (total < target && expanded.length < MAX_EXPANDED_SONGS) {
    const song = songs[index % songs.length];
    expanded.push(song);
    total += Math.max(0.1, song.duration) - (expanded.length > 1 ? crossfade : 0);
    index += 1;
  }
  return expanded;
}

// Songs play strictly one after another in list order; song N starts
// `overlap` before song N-1 ends, and that overlap is the crossfade.
function placeSongs(songs, crossfade) {
  let cursor = 0;
  return songs.map((song, index) => {
    const samples = toSamples(song.duration);
    const overlapSeconds = index === 0
      ? 0
      : Math.max(0, Math.min(crossfade, song.duration / 2, songs[index - 1].duration / 2));
    const overlap = Math.min(Math.round(overlapSeconds * SAMPLE_RATE), samples);
    const start = index === 0 ? 0 : cursor - overlap;
    cursor = start + samples;
    return { song, index, start, samples, overlap };
  });
}

function sceneBoundaries(placed, totalSeconds, settings) {
  if (settings.sceneMode === 'single') return [0, totalSeconds];
  if (settings.sceneMode === 'interval') {
    const step = Math.max(30, (Number(settings.sceneIntervalMinutes) || 5) * 60);
    const points = [0];
    for (let t = step; t < totalSeconds - 1; t += step) points.push(t);
    points.push(totalSeconds);
    return points;
  }
  return [...placed.map((p) => p.start / SAMPLE_RATE), totalSeconds];
}

// Drops any scene window shorter than MIN_SCENE_SECONDS by folding it into
// the previous scene (the client skips such a window and leaves a gap; a
// gap in a rendered mix is never what anyone wants).
function mergeShortWindows(boundaries) {
  const kept = [boundaries[0]];
  for (let i = 1; i < boundaries.length; i += 1) {
    const isLast = i === boundaries.length - 1;
    if (isLast) {
      if (boundaries[i] - kept[kept.length - 1] < MIN_SCENE_SECONDS && kept.length > 1) kept.pop();
      kept.push(boundaries[i]);
    } else if (boundaries[i] - kept[kept.length - 1] >= MIN_SCENE_SECONDS) {
      kept.push(boundaries[i]);
    }
  }
  return kept;
}

// Builds everything the renderer needs. `scenes`: [{ sourceId, kind:
// 'image'|'video', duration }]. Returns null scenes when there are none.
export function planLongMix({ songs, scenes, settings, fps }) {
  const crossfade = Math.max(0, Number(settings.crossfade) || 0);
  const ordered = expandToTarget(songs, settings.targetMinutes, crossfade);
  const placed = placeSongs(ordered, crossfade);
  const totalSamples = placed.reduce((end, p) => Math.max(end, p.start + p.samples), 0);
  const totalSeconds = totalSamples / SAMPLE_RATE;

  // Fade lengths per song: in over its overlap with the previous, out over
  // its overlap with the next (the last one fades out on its own).
  const songs2 = placed.map((p, i) => {
    const isLast = i === placed.length - 1;
    const nextOverlap = placed[i + 1]?.overlap || 0;
    return {
      ...p,
      fadeIn: i === 0 ? 0 : p.overlap / SAMPLE_RATE,
      fadeOut: isLast ? Math.min(TAIL_FADE_SECONDS, p.samples / SAMPLE_RATE / 2) : nextOverlap / SAMPLE_RATE,
    };
  });

  const chapters = songs2.map((p, i) => ({
    time: i === 0 ? 0 : p.start / SAMPLE_RATE,
    title: p.song.title,
  }));

  const totalFrames = Math.max(1, Math.round(totalSeconds * fps));
  const sceneWindows = [];
  if (scenes.length) {
    const bounds = mergeShortWindows(sceneBoundaries(placed, totalSeconds, settings));
    const frameAt = bounds.map((b, i) => (i === bounds.length - 1 ? totalFrames : Math.round(b * fps)));
    const crossfadeFrames = Math.round(crossfade * fps);
    for (let i = 0; i < bounds.length - 1; i += 1) {
      const windowFrames = frameAt[i + 1] - frameAt[i];
      if (windowFrames <= 0) continue;
      // A scene after the first starts early by the crossfade and ends at
      // its own boundary, so the overlap is the blend and the program
      // length is untouched.
      const blendIn = i === 0 ? 0 : Math.min(crossfadeFrames, Math.floor(windowFrames / 2));
      sceneWindows.push({
        index: sceneWindows.length,
        scene: scenes[i % scenes.length],
        boundaryFrame: frameAt[i],
        startFrame: frameAt[i] - blendIn,
        endFrame: frameAt[i + 1],
      });
    }
    // The blend INTO scene i+1 is bounded by scene i+1's own window; pair
    // each scene with the blend length leading out of it.
    sceneWindows.forEach((w, i) => {
      const next = sceneWindows[i + 1];
      w.blendOut = next ? w.endFrame - next.startFrame : 0;
    });
  }

  return { songs: songs2, totalSamples, totalSeconds, totalFrames, chapters, sceneWindows };
}
