import { applyVolumeEnvelope } from './volumeEnvelope.js';

// Applies volume level and linear fade in/out to an already-trimmed audio
// stream. Muting/no-source-audio is handled by the orchestrator, which
// substitutes a silent stream instead of calling this at all.
export function applyAudioLevels(graph, inputLabel, clip, outputDuration) {
  let current = inputLabel;

  // A volume envelope (RightPanel's Audio-tab keyframe button) replaces the
  // flat volume field once any points exist - same "keyframes win over the
  // static value" rule the transform properties use.
  const envelopeOut = applyVolumeEnvelope(graph, current, clip);
  if (envelopeOut) {
    current = envelopeOut;
  } else {
    const volume = typeof clip.volume === 'number' ? clip.volume : 1;
    if (Math.abs(volume - 1) > 0.001) {
      const out = graph.label('vol');
      graph.addNode(`volume=${volume.toFixed(3)}`, current, out);
      current = out;
    }
  }

  const fadeIn = clip.audioFade?.in || 0;
  const fadeOut = clip.audioFade?.out || 0;
  if (fadeIn > 0 || fadeOut > 0) {
    const out = graph.label('fade');
    const parts = [];
    if (fadeIn > 0) parts.push(`afade=t=in:st=0:d=${fadeIn}`);
    if (fadeOut > 0) parts.push(`afade=t=out:st=${Math.max(0, outputDuration - fadeOut).toFixed(3)}:d=${fadeOut}`);
    graph.addNode(parts.join(','), current, out);
    current = out;
  }

  return current;
}

export function silentAudio(graph, outputDuration) {
  const out = graph.label('silence');
  graph.addNode(`anullsrc=r=48000:cl=stereo,atrim=0:${outputDuration},asetpts=PTS-STARTPTS`, [], out);
  return out;
}
