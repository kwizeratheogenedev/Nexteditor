// Applied last, after every other effect, so it caps the FINAL rendered
// frame regardless of what canvas size the rest of the graph composited at
// (matches the scale+pad pattern already used for montage clips in
// createMontage.js). Free-tier only - Pro exports skip this entirely.
export function applyFreeTierWatermark(graph, videoLabel, canvas) {
  // Capped by the LONG axis, not blindly canvas.width - a vertical 9:16
  // canvas's width (e.g. 1080) is its SHORT axis, so a width-only check
  // would let a free-tier vertical export sail through completely uncapped
  // on height (1920, well past the intended 1280px ceiling) while a
  // landscape export was correctly capped.
  const longEdge = Math.max(canvas.width, canvas.height);
  const scaleFactor = Math.min(1, 1280 / longEdge);
  const targetWidth = Math.round((canvas.width * scaleFactor) / 2) * 2;
  const targetHeight = Math.round((canvas.height * scaleFactor) / 2) * 2;
  const out = graph.label('freetier');
  graph.addNode(
    `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease,pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2,setsar=1,`
      + `drawtext=text='NexEditor Free':font='Arial':fontsize=${Math.round(targetHeight * 0.035)}:fontcolor=white@0.55:borderw=1:bordercolor=black@0.4:x=w-tw-16:y=h-th-16`,
    videoLabel,
    out,
  );
  return out;
}
