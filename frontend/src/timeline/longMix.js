// Auto-assembles a long DJ-mix / music video from a pile of songs and a few
// background scenes, and derives the YouTube chapter list back out of the
// timeline afterwards. This is the whole of LongMix Studio's own logic: the
// panel (components/LongMixPanel.jsx) only collects files and settings, and
// what comes out here is an ordinary set of editor clips - same shapes, same
// lanes, same keyframes as anything placed by hand - which is the point.
// Nothing about a long mix is a separate rendering path: it plays in the
// normal preview, exports through the normal filter graph, and can be
// hand-edited afterwards like any other project.
import { createAudioClip, createImageClip, normalizeClip, createSourceId } from '../hooks/usePersistedEditorState';
import { applyMotionPreset, DEFAULT_IMAGE_MOTION_PRESET_ID } from './motionPresets';

// How the background scenes are spread across the mix.
export const SCENE_MODES = [
  { id: 'single', label: 'One background', hint: 'The first scene holds for the whole mix' },
  { id: 'per-song', label: 'One scene per song', hint: 'Scenes cycle, changing with each track' },
  { id: 'interval', label: 'Change every N minutes', hint: 'Scenes cycle on a fixed clock' },
];

export const DEFAULT_LONGMIX_SETTINGS = {
  crossfade: 3,
  sceneMode: 'per-song',
  sceneIntervalMinutes: 5,
  motionPresetId: DEFAULT_IMAGE_MOTION_PRESET_ID,
  targetMinutes: 0, // 0 = no looping, just play the playlist once
  // The output frame, as the preset ids backend/routes/exportTimeline.js
  // re-derives real pixel dimensions from (see canvasPresets.js). 16:9 at
  // 1080p is what a YouTube mix wants; 720p is there for a faster render.
  aspectRatioId: '16:9',
  resolutionId: '1080p',
  // The rendered video's frame rate. 15 is the default because the render
  // cost is per frame and a slow camera move on a still gains nothing from
  // more - it renders several times faster than 30 (see
  // backend/services/longMixRender.js).
  fps: 15,
};

// Songs alternate between two audio lanes instead of queueing up on one.
// The crossfade between two songs is an overlap - both are audible at once -
// and two clips overlapping on a SINGLE lane would be ambiguous to the
// preview, which resolves one active clip per lane at a time (see
// transitions.js resolveActiveInLane). Across two lanes both simply mix,
// which is exactly what the export's amix does with them too, so the
// crossfade the user hears while editing is the one that gets rendered.
const SONG_LANES = 2;

// The last song fades out rather than stopping dead on the final sample.
const TAIL_FADE_SECONDS = 2;

export function formatTimestamp(seconds) {
  const safe = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes);
  return hours > 0
    ? `${hours}:${mm}:${String(secs).padStart(2, '0')}`
    : `${mm}:${String(secs).padStart(2, '0')}`;
}

// Repeats the playlist until it reaches `targetMinutes`, which is what
// LongMix Studio's --target-minutes did. Each repeat is a fresh entry
// pointing at the same source file - the export opens that file once and
// trims it per clip, so a looped playlist costs no extra upload.
function expandToTargetDuration(songs, targetMinutes, crossfade) {
  const target = (Number(targetMinutes) || 0) * 60;
  if (!(target > 0) || !songs.length) return songs;
  const expanded = [];
  let total = 0;
  let index = 0;
  // Each added song extends the mix by its own length minus the crossfade
  // it overlaps the previous one by - the same accounting the placement
  // loop below does, so the loop count and the finished runtime agree. The
  // entry cap is only a runaway-loop guard (a malformed duration could
  // otherwise spin forever) - set well above what even a full-day mix of
  // short songs needs, so it never truncates a real target.
  while (total < target && expanded.length < 5000) {
    const song = songs[index % songs.length];
    expanded.push({ ...song, id: `${song.id}-loop${Math.floor(index / songs.length)}-${index}` });
    total += Math.max(0.1, song.duration) - (expanded.length > 1 ? crossfade : 0);
    index += 1;
  }
  return expanded;
}

// Where each song sits once crossfades are accounted for: song N starts
// `crossfade` seconds before song N-1 ends, so the overlap is the fade.
function placeSongs(songs, crossfade) {
  let cursor = 0;
  return songs.map((song, index) => {
    const duration = Math.max(0.1, song.duration);
    // Never overlap more than either song can spare, or a short interlude
    // would start before the previous track had a chance to play.
    const overlap = index === 0
      ? 0
      : Math.max(0, Math.min(crossfade, duration / 2, Math.max(0.1, songs[index - 1].duration) / 2));
    const startTime = index === 0 ? 0 : cursor - overlap;
    cursor = startTime + duration;
    return { song, startTime, duration, overlap };
  });
}

// Scene boundaries in seconds across the whole runtime: [0, b1, ..., total].
function sceneBoundaries(placedSongs, totalDuration, settings) {
  if (settings.sceneMode === 'single') return [0, totalDuration];

  if (settings.sceneMode === 'interval') {
    const step = Math.max(30, (Number(settings.sceneIntervalMinutes) || 5) * 60);
    const points = [0];
    for (let t = step; t < totalDuration - 1; t += step) points.push(t);
    points.push(totalDuration);
    return points;
  }

  // 'per-song': a scene change on every track boundary, which is what makes
  // the picture change land on the music rather than on a clock.
  const points = placedSongs.map((placed) => placed.startTime);
  points.push(totalDuration);
  return points;
}

// Builds a whole long-mix timeline. `songs` and `scenes` are the panel's own
// {id, file, url, duration, title, kind} entries. Returns the clips plus the
// runtime, ready to drop straight into the editor's timeline state.
export function buildLongMixTimeline(songs, scenes, settings = DEFAULT_LONGMIX_SETTINGS) {
  const crossfade = Math.max(0, Number(settings.crossfade) || 0);
  const orderedSongs = expandToTargetDuration(songs, settings.targetMinutes, crossfade);
  const placedSongs = placeSongs(orderedSongs, crossfade);
  const totalDuration = placedSongs.reduce((end, placed) => Math.max(end, placed.startTime + placed.duration), 0);

  const songClips = placedSongs.map((placed, index) => {
    const isFirst = index === 0;
    const isLast = index === placedSongs.length - 1;
    const nextOverlap = placedSongs[index + 1]?.overlap || 0;
    return createAudioClip({
      sourceId: placed.song.sourceId,
      file: placed.song.file,
      url: placed.song.url,
      // Alternating lanes are what let consecutive songs overlap audibly -
      // see SONG_LANES above.
      trackIndex: index % SONG_LANES,
      startTime: placed.startTime,
      trimmedStart: 0,
      trimmedEnd: placed.duration,
      // Each song fades in over its overlap with the previous one and out
      // over its overlap with the next, so the two halves of a crossfade
      // sum to roughly constant loudness instead of dipping or spiking.
      audioFade: {
        in: isFirst ? 0 : placed.overlap,
        out: isLast ? Math.min(TAIL_FADE_SECONDS, placed.duration / 2) : nextOverlap,
      },
      chapterTitle: placed.song.title,
    });
  });

  const sceneClips = buildSceneClips(scenes, placedSongs, totalDuration, settings, crossfade);

  return { clips: [...songClips, ...sceneClips], totalDuration, songCount: placedSongs.length };
}

// Lays the background scenes out across the runtime on video lane 0, giving
// each image a camera move and each adjacent pair a crossfade. A scene's
// transitionOut only renders as a blend if the NEXT clip actually starts at
// the overlap point (see transitions.js), so the placement below and the
// transitionOut values are set together, in one pass.
function buildSceneClips(scenes, placedSongs, totalDuration, settings, crossfade) {
  if (!scenes.length || !(totalDuration > 0)) return [];

  const boundaries = sceneBoundaries(placedSongs, totalDuration, settings);
  const clips = [];

  for (let i = 0; i < boundaries.length - 1; i += 1) {
    const scene = scenes[i % scenes.length];
    const windowStart = boundaries[i];
    const windowEnd = boundaries[i + 1];
    if (windowEnd - windowStart < 0.5) continue;

    // Each scene after the first starts early by the crossfade duration and
    // still ends at its own boundary, so the overlap is the blend and the
    // programme's total length stays exactly totalDuration.
    const sceneCrossfade = i === 0 ? 0 : Math.min(crossfade, (windowEnd - windowStart) / 2);
    const startTime = windowStart - sceneCrossfade;
    const duration = windowEnd - startTime;
    const isLast = i === boundaries.length - 2;
    const nextCrossfade = isLast ? 0 : Math.min(crossfade, duration / 2);
    const transitionOut = nextCrossfade > 0 ? { type: 'fade', duration: nextCrossfade } : null;

    if (scene.kind === 'image') {
      clips.push(createImageClip({
        sourceId: scene.sourceId,
        file: scene.file,
        url: scene.url,
        trackIndex: 0,
        startTime,
        duration,
        label: scene.title,
        // A still that just sits there for four minutes looks like a
        // stopped video, so every scene image gets a slow camera move -
        // an ordinary, editable keyframe set (see motionPresets.js), not a
        // fixed zoom baked into the renderer.
        motionKeyframes: applyMotionPreset(
          { x: [], y: [], rotation: [], opacity: [], volume: [], speed: [], scaleX: [], scaleY: [] },
          settings.motionPresetId,
          duration,
        ),
        transitionOut,
      }));
    } else {
      // A video scene can only play the footage it actually has: if it's
      // shorter than its window it plays out and the next scene picks up
      // where it's scheduled, leaving black in between (which the export
      // fills exactly as the preview shows it - see transition.js's gap
      // filler). Trimming/extending it afterwards is a normal drag.
      const usable = Math.min(duration, Math.max(0.5, scene.duration));
      clips.push(normalizeClip({
        id: `scene-${Date.now()}-${i}-${Math.random().toString(16).slice(2)}`,
        type: 'video',
        sourceId: scene.sourceId,
        file: scene.file,
        url: scene.url,
        trackIndex: 0,
        startTime,
        duration: usable,
        trimmedStart: 0,
        trimmedEnd: usable,
        // Scene footage is a backdrop for the music - its own audio would
        // fight the mix.
        muted: true,
        transitionOut,
      }));
    }
  }

  return clips;
}

// The YouTube chapter list text. The chapters themselves ({time, title}) come
// back from the server with the finished render (backend/services/
// longMixPlan.js), laid out from the real song lengths, so the timestamps
// describe the file that was actually produced. YouTube requires the first
// chapter at 0:00, which the planner pins.
export function formatChapters(chapters) {
  return chapters.map((chapter) => `${formatTimestamp(chapter.time)} ${chapter.title}`).join('\n');
}

// Wraps a picked File into the panel's own song/scene entry shape. The
// sourceId is minted here (not at build time) so re-ordering or renaming in
// the panel never re-uploads or re-probes anything.
export function createLongMixEntry(file, kind, duration) {
  return {
    id: `${kind}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    sourceId: createSourceId(),
    file,
    url: URL.createObjectURL(file),
    kind,
    duration: duration || 0,
    title: file.name.replace(/\.[^.]+$/, ''),
  };
}
