// Applies an adjustment-layer clip's color/vignette filters to the GROWING
// COMPOSITE (whatever's already been drawn below it in z-order) instead of
// a freshly-trimmed per-clip stream - the export-side counterpart of the
// frontend's canvas-snapshot-and-refilter approach (see
// timeline/useTimelinePlayer.js's applyAdjustmentLayer). Time-gated to the
// clip's own [startTime, endTime) window via each filter's generic
// `enable=` option, which every filter used here (eq, colorbalance,
// vignette) was empirically verified to support against the bundled
// ffmpeg before wiring in. Mirrors color.js/vignette.js's exact param
// mapping so an adjustment layer and a regular clip's Color tab produce
// the same look for the same slider values.
export function applyAdjustmentLayer(graph, inputLabel, clip, startTime, endTime) {
  const enable = `between(t,${startTime.toFixed(3)},${endTime.toFixed(3)})`;
  let current = inputLabel;

  const colorFilter = (clip.filters || []).find((filter) => filter.type === 'color' && filter.enabled !== false);
  if (colorFilter) {
    const { brightness = 0, contrast = 0, saturation = 0, temperature = 0 } = colorFilter.params || {};

    if (brightness || contrast || saturation) {
      const out = graph.label('adjeq');
      const b = (brightness / 100).toFixed(3);
      const c = Math.max(0, 1 + contrast / 100).toFixed(3);
      const s = Math.max(0, 1 + saturation / 100).toFixed(3);
      graph.addNode(`eq=brightness=${b}:contrast=${c}:saturation=${s}:enable='${enable}'`, current, out);
      current = out;
    }

    if (temperature) {
      const out = graph.label('adjtemp');
      const shift = (Math.max(-100, Math.min(100, temperature)) / 100) * 0.3;
      graph.addNode(`colorbalance=rs=${shift.toFixed(3)}:bs=${(-shift).toFixed(3)}:enable='${enable}'`, current, out);
      current = out;
    }
  }

  const vignetteFilter = (clip.filters || []).find((filter) => filter.type === 'vignette' && filter.enabled !== false);
  const intensity = vignetteFilter?.params?.intensity || 0;
  if (intensity > 0) {
    const out = graph.label('adjvig');
    const angle = (Math.max(0, Math.min(100, intensity)) / 100) * (Math.PI / 2.5);
    graph.addNode(`vignette=a=${angle.toFixed(4)}:enable='${enable}'`, current, out);
    current = out;
  }

  return current;
}
