const HEX_COLOR = /^#?[0-9a-fA-F]{6}$/;

// clip.filters[].params.color is client-supplied project data (frontend
// localStorage / a saved Project doc) landing directly inside an ffmpeg
// filter string below - only ever pass through a strict 6-digit hex color,
// anything else falls back to key green rather than being interpolated raw.
function sanitizeHexColor(color) {
  if (typeof color === 'string' && HEX_COLOR.test(color)) {
    return color.startsWith('#') ? color.slice(1) : color;
  }
  return '00ff00';
}

// Reads the clip's 'chromaKey' filter entry (RightPanel Color tab: key
// color + similarity/edge softness, both 0-100) and maps it onto ffmpeg's
// native colorkey= filter, which makes matching pixels transparent (RGB
// distance threshold with a linear-feathered edge) - same distance formula
// mirrored in frontend/src/timeline/useTimelinePlayer.js's canvas preview
// (dr/dg/db normalized 0-1, Euclidean, divided by sqrt(3)), so the live
// preview and the exported file key out the same pixels.
export function applyChromaKey(graph, inputLabel, clip) {
  const filter = (clip.filters || []).find((f) => f.type === 'chromaKey' && f.enabled !== false);
  if (!filter) return inputLabel;

  const { color = '#00ff00', similarity = 35, blend = 15 } = filter.params || {};
  const hex = sanitizeHexColor(color);
  // ffmpeg's similarity range is (0, 1] - 0 is rejected, so floor just above it.
  const sim = Math.max(0.0001, Math.min(1, (Number(similarity) || 0) / 100));
  const bl = Math.max(0, Math.min(1, (Number(blend) || 0) / 100));

  const out = graph.label('chromakey');
  graph.addNode(`format=rgba,colorkey=color=0x${hex}:similarity=${sim.toFixed(4)}:blend=${bl.toFixed(4)}`, inputLabel, out);
  return out;
}
