import { FilterGraph } from './FilterGraph.js';
import { applyVideoTrim, applyAudioTrim } from './effects/trim.js';
import { applyVideoSpeed, applyAudioSpeed } from './effects/speed.js';
import { applyVideoTransform } from './effects/transform.js';
import { applyVideoColor } from './effects/color.js';
import { applyVignette } from './effects/vignette.js';
import { applyAudioLevels, silentAudio } from './effects/audio.js';
import { applyTextOverlay } from './effects/textOverlay.js';
import { applyCaptions } from './effects/captionAss.js';
import { chainVideoClips } from './effects/transition.js';
import { buildAudioTrackClip } from './effects/audioTrack.js';
import { buildOverlayClip, compositeOverlayClip } from './effects/overlayTrack.js';
import { hasSpeedCurve, applyVideoSpeedCurve, applyAudioSpeedCurve, clipOutputDuration } from './effects/speedCurve.js';
import { applyAdjustmentLayer } from './effects/adjustmentLayer.js';
import { applyDucking } from './effects/ducking.js';
import { applyFreeTierWatermark } from './effects/freeTierLimits.js';
import { isVideoLikeClip } from './clipKinds.js';

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
// `inputIndexByClipId` maps each CLIP to the ffmpeg -i index its media was
// opened at - one input per clip, even when several clips share a source
// file. That's deliberate, and the difference between a long project
// exporting and one running the machine out of memory: referencing a
// single -i from two points in the lane-0 chain makes ffmpeg insert a
// `split`, and a split whose two branches are consumed minutes apart has
// to hold every frame in between in memory. Measured on a 6-scene chain
// where one image was reused twice: 569MB shared vs 193MB with the file
// opened twice, and the gap widens with both the number of reuses and the
// length of each scene - a long mix cycling a handful of backgrounds ran
// to several GB before this. Opening a file twice costs one more decoder
// and nothing else. `jobDir` is a scratch directory the caller
// creates/cleans up, used for text-clip temp files.
export function buildEditorExportGraph(clips, inputIndexByClipId, sourceHasAudio, canvas, jobDir, { freeTier = false } = {}) {
  const graph = new FilterGraph();
  // Image clips are picture content exactly like video clips are (see
  // clipKinds.js) - they're eligible for lane 0 and for overlay lanes, and
  // go through the identical trim/transform/color/vignette pipeline. The
  // only image-specific handling lives in the caller, which opens the file
  // with `-loop 1 -framerate <fps> -t <n>` (exportTimeline.js) and gets
  // `sourceHasAudio: false` for it, so the silent-audio branch below
  // already covers an image's missing audio stream with no extra case.
  const laneZeroVideoClips = clips.filter((clip) => isVideoLikeClip(clip) && (clip.trackIndex || 0) === 0);
  // Overlay (real media) and adjustment (filter-only, no media - see M13's
  // createAdjustmentClip) clips share the same video-lane trackIndex space
  // for z-order, so they're combined and sorted together here, matching the
  // frontend preview's single ascending-trackIndex videoLanes loop.
  const overlayLayerItems = clips
    .filter((clip) => isVideoLikeClip(clip) && (clip.trackIndex || 0) > 0)
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
    const inputIndex = inputIndexByClipId.get(clip.id);
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

    const inputIndex = inputIndexByClipId.get(clip.id);
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
  // own absolute startTime.
  const audioTrackEntries = audioTrackClips.map((clip) => {
    const inputIndex = inputIndexByClipId.get(clip.id);
    if (inputIndex === undefined || !sourceHasAudio.get(clip.sourceId)) return null;
    const outputDuration = clipOutputDuration(clip);
    const label = buildAudioTrackClip(graph, `${inputIndex}:a`, clip, outputDuration, clip.startTime);
    return { clip, label };
  }).filter(Boolean);

  // A clip with duck.enabled (RightPanel's Audio tab "Auto-duck" toggle -
  // only offered for standalone audio-track clips, i.e. background music)
  // automatically lowers under everything ELSE already in the mix - lane-0
  // program dialogue, overlay clips' own embedded audio, and any
  // non-ducked audio-track clip (e.g. a separate voiceover track) - via
  // ffmpeg's native sidechaincompress (see effects/ducking.js). Other
  // *ducked* clips deliberately do NOT feed each other's trigger (two
  // background-music tracks ducking one another isn't a meaningful use
  // case, and excluding them keeps one shared trigger mix usable for every
  // ducked clip instead of a different one per clip).
  const duckedEntries = audioTrackEntries.filter((entry) => {
    const amount = entry.clip.duck?.enabled ? (typeof entry.clip.duck.amount === 'number' ? entry.clip.duck.amount : 70) : 0;
    return amount > 0;
  });
  const nonDuckedEntries = audioTrackEntries.filter((entry) => !duckedEntries.includes(entry));

  if (duckedEntries.length === 0) {
    audioTrackEntries.forEach(({ label }) => mixInputs.push(label));
  } else {
    // Every trigger-eligible label (lane-0 audio, overlay audio, non-ducked
    // tracks) is consumed twice here - once in the final mix, once feeding
    // the shared duck-trigger mix below - so each needs an explicit asplit
    // first. ffmpeg's filtergraph parser rejects naively reusing one output
    // label as the input to two different filter statements (empirically
    // verified against the bundled ffmpeg build: "[a]f1[x];[a]f2[y]" errors
    // with "Invalid stream specifier", even though using a label twice as
    // BOTH inputs of the SAME multi-input filter, e.g. amix's own input
    // list, is fine).
    const triggerSourceLabels = [...mixInputs, ...nonDuckedEntries.map((entry) => entry.label)];
    const splitPairs = triggerSourceLabels.map((label) => {
      const forMix = graph.label('split');
      const forTrigger = graph.label('split');
      graph.addNode('asplit=2', label, [forMix, forTrigger]);
      return { forMix, forTrigger };
    });
    mixInputs.length = 0;
    splitPairs.forEach(({ forMix }) => mixInputs.push(forMix));

    const triggerInputs = splitPairs.map((pair) => pair.forTrigger);
    const sharedTriggerLabel = triggerInputs.length > 1
      ? graph.addNode(`amix=inputs=${triggerInputs.length}:duration=longest:normalize=0`, triggerInputs, graph.label('duckmix'))
      : triggerInputs[0];

    if (!sharedTriggerLabel) {
      // Nothing else in the mix to duck against (e.g. a lone music clip
      // with no dialogue/other tracks) - fall back to the raw label.
      duckedEntries.forEach(({ label }) => mixInputs.push(label));
    } else {
      // The shared trigger feeds every ducked clip's own sidechaincompress -
      // same reuse rule as above, split once per ducked clip when there's
      // more than one.
      const triggerCopies = duckedEntries.length > 1
        ? (() => {
          const outs = duckedEntries.map(() => graph.label('split'));
          graph.addNode(`asplit=${duckedEntries.length}`, sharedTriggerLabel, outs);
          return outs;
        })()
        : [sharedTriggerLabel];
      duckedEntries.forEach(({ clip, label }, i) => {
        const duckAmount = typeof clip.duck.amount === 'number' ? clip.duck.amount : 70;
        mixInputs.push(applyDucking(graph, label, triggerCopies[i], duckAmount));
      });
    }
  }

  // normalize=0 keeps ffmpeg from auto-attenuating every input to keep the
  // sum in range, which would quietly turn down dialogue every time a music
  // track is added; manual volume/fade/keyframe/ducking control is the point.
  const aout = mixInputs.length > 1
    ? graph.addNode(`amix=inputs=${mixInputs.length}:duration=first:normalize=0`, mixInputs, graph.label('amix'))
    : chainedAudio;

  // Text clips (any lane) are drawn at their own absolute [startTime,
  // startTime+duration) window, exactly like the frontend canvas compositor.
  // Caption clips (text.caption set - the editor's auto-captions) are drawn
  // all together by the subtitle renderer; see effects/captionAss.js.
  textClips.filter((clip) => !clip.text?.caption).forEach((clip) => {
    const duration = Math.max(0.05, (clip.trimmedEnd - clip.trimmedStart) / (clip.speed || 1));
    videoLabel = applyTextOverlay(graph, videoLabel, clip, canvas, clip.startTime, clip.startTime + duration, jobDir);
  });
  videoLabel = applyCaptions(graph, videoLabel, textClips.filter((clip) => clip.text?.caption), canvas, jobDir);

  if (freeTier) {
    videoLabel = applyFreeTierWatermark(graph, videoLabel, canvas);
  }

  return { filterComplex: graph.build(), videoOutputLabel: videoLabel, audioOutputLabel: aout };
}
