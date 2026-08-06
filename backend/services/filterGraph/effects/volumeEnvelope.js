import { buildKeyframeExpr, hasKeyframes } from './keyframeExpr.js';

// Applies a keyframed volume envelope (clip.keyframes.volume) as a per-frame
// ffmpeg expression - verified empirically that the `volume` filter's
// `eval=frame` mode does vary sample amplitude frame-to-frame from a `t`
// expression (unlike colorchannelmixer's aa=, which rejected this - see M3's
// keyframeExpr.js notes). Mirrors the frontend's resolveClipGain envelope
// lookup so the preview and export agree.
export function applyVolumeEnvelope(graph, inputLabel, clip) {
  if (!hasKeyframes(clip.keyframes, 'volume')) return null;
  const expr = buildKeyframeExpr(clip.keyframes.volume, 't');
  const out = graph.label('volenv');
  graph.addNode(`volume=volume='${expr}':eval=frame`, inputLabel, out);
  return out;
}
