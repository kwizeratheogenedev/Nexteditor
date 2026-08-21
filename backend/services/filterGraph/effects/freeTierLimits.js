// Applied last, after every other effect, so it caps the FINAL rendered
// frame regardless of what canvas size the rest of the graph composited at
// (matches the scale+pad pattern already used for montage clips in
// createMontage.js). Free-tier only - Pro exports skip this entirely.
export function applyFreeTierWatermark(graph, videoLabel, canvas) {
  const targetWidth = Math.min(1280, canvas.width);
  const targetHeight = Math.round(targetWidth * (canvas.height / canvas.width) / 2) * 2;
  const out = graph.label('freetier');
  graph.addNode(
    `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease,pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2,setsar=1,`
      + `drawtext=text='NexEditor Free':font='Arial':fontsize=${Math.round(targetHeight * 0.035)}:fontcolor=white@0.55:borderw=1:bordercolor=black@0.4:x=w-tw-16:y=h-th-16`,
    videoLabel,
    out,
  );
  return out;
}
