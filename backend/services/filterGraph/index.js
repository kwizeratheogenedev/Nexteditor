import { FilterGraph } from './FilterGraph.js';
import { applyVideoTrim, applyAudioTrim } from './effects/trim.js';
import { applyVideoSpeed, applyAudioSpeed } from './effects/speed.js';
import { applyVideoTransform } from './effects/transform.js';
import { applyVideoColor } from './effects/color.js';
import { applyVignette } from './effects/vignette.js';
import { applyAudioLevels, silentAudio } from './effects/audio.js';
import { applyTextOverlay } from './effects/textOverlay.js';
import { chainVideoClips } from './effects/transition.js';
import { buildAudioTrackClip } from './effects/audioTrack.js';
import { buildOverlayClip, compositeOverlayClip } from './effects/overlayTrack.js';
import { hasSpeedCurve, applyVideoSpeedCurve, applyAudioSpeedCurve, clipOutputDuration } from './effects/speedCurve.js';
import { applyAdjustmentLayer } from './effects/adjustmentLayer.js';

// Builds the -filter_complex string for an editor export: lane 0's video
// clips are trimmed/sped-up/transformed/color-graded independently, then
// chained in `startTime` order (gaps become black/silent filler, adjacent
// clips with a transitionOut cross-fade - see effects/transition.js) to
// form "the program"; every additional video lane (1+) gets the same
// per-clip pipeline but composited onto a transparent background and
// layered on top of the program at its own [startTime, endTime) window,
// real picture-in-picture/overlays (see effects/overlayTrack.js) - lanes
// are layered in ascending trackIndex order, matching the frontend
// preview's z-order. Every audio-track clip (any lane) and every text clip
// (any lane) render too, each at its own absolute position.
// `inputIndexBySourceId` maps each unique source to the ffmpeg -i index it
// was opened at (clips sharing a source, e.g. both halves of a split,
// reference the same input twice with different trim points instead of
// opening the file again). `jobDir` is a scratch directory the caller
// creates/cleans up, used for text-clip temp files.
export function buildEditorExportGraph(clips, inputIndexBySourceId, sourceHasAudio, canvas, jobDir) {
  const graph = new FilterGraph();
  const laneZeroVideoClips = clips.filter((clip) => (clip.type === 'video' || !clip.type) && (clip.trackIndex || 0) === 0);
  // Overlay (real media) and adjustment (filter-only, no media - see M13's
  // createAdjustmentClip) clips share the same video-lane trackIndex space
  // for z-order, so they're combined and sorted together here, matching the
  // frontend preview's single ascending-trackIndex videoLanes loop.
  const overlayLayerItems = clips
    .filter((clip) => (clip.type === 'video' || !clip.type) && (clip.trackIndex || 0) > 0)
    .map((clip) => ({ clip, kind: 'overlay' }));
  const adjustmentLayerItems = clips
    .filter((clip) => clip.type === 'adjustment')
    .map((clip) => ({ clip, kind: 'adjustment' }));
  const videoLayerItems = [...overlayLayerItems, ...adjustmentLayerItems]
    .sort((a, b) => (a.clip.trackIndex || 0) - (b.clip.trackIndex || 0));
  const audioTrackClips = clips.filter((clip) => clip.type === 'audio');
  const textClips = clips.filter((clip) => clip.type === 'text');
  const videoLabels = [];
  const audioLabels = [];

  laneZeroVideoClips.forEach((clip) => {
    const inputIndex = inputIndexBySourceId.get(clip.sourceId);
    const outputDuration = clipOutputDuration(clip);

    let video = hasSpeedCurve(clip)
      ? applyVideoSpeedCurve(graph, `${inputIndex}:v`, clip)
      : applyVideoSpeed(graph, applyVideoTrim(graph, `${inputIndex}:v`, clip), clip);
    video = applyVideoTransform(graph, video, clip, canvas, outputDuration);
    video = applyVideoColor(graph, video, clip);
    video = applyVignette(graph, video, clip);
    videoLabels.push(video);

    const needsSilence = clip.muted || !sourceHasAudio.get(clip.sourceId);
    let audio;
    if (needsSilence) {
      audio = silentAudio(graph, outputDuration);
    } else {
      audio = hasSpeedCurve(clip)
        ? applyAudioSpeedCurve(graph, `${inputIndex}:a`, clip)
        : applyAudioSpeed(graph, applyAudioTrim(graph, `${inputIndex}:a`, clip), clip);
      audio = applyAudioLevels(graph, audio, clip, outputDuration);
    }
    audioLabels.push(audio);
  });

  // Adjacent clips with a transitionOut cross-fade (xfade/acrossfade)
  // instead of a hard concat cut, and gaps between clips render as
  // black/silent filler - see effects/transition.js.
  const { videoLabel: vout, audioLabel: chainedAudio } = chainVideoClips(graph, laneZeroVideoClips, videoLabels, audioLabels, clipOutputDuration, canvas);

  // Every lane-1+ video/adjustment item layers onto the growing program at
  // its own absolute window, in ascending trackIndex order (back-to-front,
  // matching the frontend preview) - real picture-in-picture/overlays, and
  // adjustment layers filtering everything drawn below them so far.
  let videoLabel = vout;
  const mixInputs = [chainedAudio];
  videoLayerItems.forEach(({ clip, kind }) => {
    const outputDuration = clipOutputDuration(clip);

    if (kind === 'adjustment') {
      videoLabel = applyAdjustmentLayer(graph, videoLabel, clip, clip.startTime, clip.startTime + outputDuration);
      return;
    }

    const inputIndex = inputIndexBySourceId.get(clip.sourceId);
    const overlayFrame = buildOverlayClip(graph, `${inputIndex}:v`, clip, canvas, outputDuration);
    videoLabel = compositeOverlayClip(graph, videoLabel, overlayFrame, clip.startTime, clip.startTime + outputDuration);

    // An overlay clip's own embedded audio mixes in too (unless muted/
    // source has none), same building block the standalone audio track uses.
    if (!clip.muted && sourceHasAudio.get(clip.sourceId)) {
      const audioLabel = buildAudioTrackClip(graph, `${inputIndex}:a`, clip, outputDuration, clip.startTime);
      mixInputs.push(audioLabel);
    }
  });

  // Standalone audio-track clips (music/voiceover, any lane) sit at their
  // own absolute startTime, then get mixed into the video track's own
  // audio. normalize=0 keeps ffmpeg from auto-attenuating every input to
  // keep the sum in range, which would quietly turn down dialogue every
  // time a music track is added; manual volume/fade/keyframe control is
  // the point.
  audioTrackClips.forEach((clip) => {
    const inputIndex = inputIndexBySourceId.get(clip.sourceId);
    if (inputIndex === undefined || !sourceHasAudio.get(clip.sourceId)) return;
    const outputDuration = clipOutputDuration(clip);
    const label = buildAudioTrackClip(graph, `${inputIndex}:a`, clip, outputDuration, clip.startTime);
    mixInputs.push(label);
  });
  const aout = mixInputs.length > 1
    ? graph.addNode(`amix=inputs=${mixInputs.length}:duration=first:normalize=0`, mixInputs, graph.label('amix'))
    : chainedAudio;

  // Text clips (any lane) are drawn at their own absolute [startTime,
  // startTime+duration) window, exactly like the frontend canvas compositor.
  textClips.forEach((clip) => {
    const duration = Math.max(0.05, (clip.trimmedEnd - clip.trimmedStart) / (clip.speed || 1));
    videoLabel = applyTextOverlay(graph, videoLabel, clip, canvas, clip.startTime, clip.startTime + duration, jobDir);
  });

  return { filterComplex: graph.build(), videoOutputLabel: videoLabel, audioOutputLabel: aout };
}
