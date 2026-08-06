import { getTransitionDuration, isTransitionPartner, clipEndTime } from '../transitionMath.js';
import { silentAudio } from './audio.js';

const ADJACENCY_EPSILON = 0.05;

// A black/silent filler segment for a gap between two lane-0 clips - since
// M7 clips are freely positioned (absolute startTime) instead of always
// touching, the base program can now have real gaps that must render as
// black+silence, matching what the canvas preview shows (drawFrame leaves
// the canvas's black fillRect untouched when no clip is active).
function buildFillerSegment(graph, duration, canvas) {
  const vOut = graph.label('gapv');
  graph.addNode(`color=c=black:s=${canvas.width}x${canvas.height}:d=${duration.toFixed(3)}:r=${canvas.fps}`, [], vOut);
  return { video: vOut, audio: silentAudio(graph, duration), clip: null, duration };
}

// Chains lane-0's already-built per-clip video/audio streams (trim/speed/
// transform/color/vignette already applied - see index.js) into one
// program, in `startTime` order: adjacent clips with a transitionOut
// cross-fade via xfade/acrossfade, gaps get a black/silent filler segment,
// everything else falls back to a plain 2-input concat. Tracks the merged
// stream's running duration directly (rather than precomputing an offsets
// table) so gap-filler segments fold in naturally - xfade's `offset=`
// parameter is just "duration of the merged stream so far minus the
// transition length."
export function chainVideoClips(graph, videoClips, videoLabels, audioLabels, clipDuration, canvas) {
  if (videoClips.length === 0) return { videoLabel: null, audioLabel: null, totalDuration: 0 };

  const labelByClipId = new Map(videoClips.map((clip, i) => [clip.id, { video: videoLabels[i], audio: audioLabels[i] }]));
  const sorted = [...videoClips].sort((a, b) => a.startTime - b.startTime);

  const segments = [];
  if (sorted[0].startTime > ADJACENCY_EPSILON) {
    segments.push(buildFillerSegment(graph, sorted[0].startTime, canvas));
  }
  sorted.forEach((clip, i) => {
    if (i > 0) {
      const gap = clip.startTime - clipEndTime(sorted[i - 1], clipDuration);
      if (gap > ADJACENCY_EPSILON) {
        segments.push(buildFillerSegment(graph, gap, canvas));
      }
    }
    const { video, audio } = labelByClipId.get(clip.id);
    segments.push({ video, audio, clip, duration: clipDuration(clip) });
  });

  let videoAcc = segments[0].video;
  let audioAcc = segments[0].audio;
  let videoAccDuration = segments[0].duration;

  for (let i = 1; i < segments.length; i += 1) {
    const prevSegment = segments[i - 1];
    const segment = segments[i];
    const transitionDuration = (prevSegment.clip && segment.clip && isTransitionPartner(prevSegment.clip, segment.clip, clipDuration))
      ? getTransitionDuration(prevSegment.clip, segment.clip, clipDuration)
      : 0;

    if (transitionDuration > 0) {
      const offset = videoAccDuration - transitionDuration;
      const vOut = graph.label('xfade');
      graph.addNode(`xfade=transition=fade:duration=${transitionDuration.toFixed(3)}:offset=${offset.toFixed(3)}`, [videoAcc, segment.video], vOut);
      videoAcc = vOut;

      const aOut = graph.label('axfade');
      graph.addNode(`acrossfade=d=${transitionDuration.toFixed(3)}`, [audioAcc, segment.audio], aOut);
      audioAcc = aOut;
      videoAccDuration += segment.duration - transitionDuration;
    } else {
      const vOut = graph.label('vconcat');
      const aOut = graph.label('aconcat');
      graph.addNode('concat=n=2:v=1:a=1', [videoAcc, audioAcc, segment.video, segment.audio], [vOut, aOut]);
      videoAcc = vOut;
      audioAcc = aOut;
      videoAccDuration += segment.duration;
    }
  }

  return { videoLabel: videoAcc, audioLabel: audioAcc, totalDuration: videoAccDuration };
}
