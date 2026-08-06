// Reads the clip's 'vignette' filter entry (0-100 intensity from the
// RightPanel Color tab) and maps it onto ffmpeg's native vignette= filter,
// which darkens the frame edges via a per-pixel angle-based falloff. Applied
// per-clip (before concat), so - like the rest of the transform/color chain
// - it doesn't affect text overlays, which are drawn after concat.
export function applyVignette(graph, inputLabel, clip) {
  const vignetteFilter = (clip.filters || []).find((filter) => filter.type === 'vignette' && filter.enabled !== false);
  const intensity = vignetteFilter?.params?.intensity || 0;
  if (intensity <= 0) return inputLabel;

  const out = graph.label('vignette');
  const angle = (Math.max(0, Math.min(100, intensity)) / 100) * (Math.PI / 2.5);
  graph.addNode(`vignette=a=${angle.toFixed(4)}`, inputLabel, out);
  return out;
}
