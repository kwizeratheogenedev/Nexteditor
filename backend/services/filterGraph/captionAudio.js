import { FilterGraph } from './FilterGraph.js';
import { buildAudioTrackClip } from './effects/audioTrack.js';
import { clipOutputDuration } from './effects/speedCurve.js';

// The timeline's sound only, for transcribing captions: every clip that has
// audio (video on any lane, and audio-track clips) trimmed, sped and levelled
// exactly as the export would, placed at its own startTime, and mixed. No
// video is decoded at all, which is what makes this fast next to an export.
// Returns null when nothing on the timeline makes a sound.
export function buildCaptionAudioGraph(clips, inputIndexByClipId, sourceHasAudio) {
  const graph = new FilterGraph();
  const labels = [];
  clips.forEach((clip) => {
    const inputIndex = inputIndexByClipId.get(clip.id);
    if (inputIndex === undefined || clip.muted || clip.enabled === false || !sourceHasAudio.get(clip.sourceId)) return;
    labels.push(buildAudioTrackClip(graph, `${inputIndex}:a`, clip, clipOutputDuration(clip), clip.startTime || 0));
  });
  if (!labels.length) return null;
  const audioOutputLabel = labels.length > 1
    ? graph.addNode(`amix=inputs=${labels.length}:duration=longest:normalize=0`, labels, graph.label('amix'))
    : labels[0];
  return { filterComplex: graph.build(), audioOutputLabel };
}
