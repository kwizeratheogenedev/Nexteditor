// Reads the clip's single 'color' filter entry (Brightness/Contrast/
// Saturation/Temperature from the RightPanel Color tab) and maps its
// -100..100 slider ranges onto ffmpeg's eq= and colorbalance= ranges.
export function applyVideoColor(graph, inputLabel, clip) {
  const colorFilter = (clip.filters || []).find((filter) => filter.type === 'color' && filter.enabled !== false);
  if (!colorFilter) return inputLabel;

  const { brightness = 0, contrast = 0, saturation = 0, temperature = 0 } = colorFilter.params || {};
  let current = inputLabel;

  if (brightness || contrast || saturation) {
    const out = graph.label('eq');
    const b = (brightness / 100).toFixed(3);
    const c = Math.max(0, 1 + contrast / 100).toFixed(3);
    const s = Math.max(0, 1 + saturation / 100).toFixed(3);
    graph.addNode(`eq=brightness=${b}:contrast=${c}:saturation=${s}`, current, out);
    current = out;
  }

  if (temperature) {
    const out = graph.label('temp');
    const shift = (Math.max(-100, Math.min(100, temperature)) / 100) * 0.3;
    graph.addNode(`colorbalance=rs=${shift.toFixed(3)}:bs=${(-shift).toFixed(3)}`, current, out);
    current = out;
  }

  return current;
}
