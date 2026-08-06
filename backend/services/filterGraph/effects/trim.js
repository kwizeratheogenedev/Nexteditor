// A safe "one frame" window for a freeze-frame hold - small enough to look
// instantaneous at any realistic frame rate, large enough that ffmpeg's
// trim never produces a zero-length/unseekable segment. Empirically
// verified against the bundled ffmpeg: trim to this tiny window, then
// tpad's stop_mode=clone repeats the last (only) frame for the remainder of
// the clip's own duration (trimmedEnd - trimmedStart, same as any other
// clip) - a real held frame, not a sped-up scrub through motion.
const FREEZE_FRAME_EPSILON = 0.04;

export function applyVideoTrim(graph, inputLabel, clip) {
  const out = graph.label('vtrim');
  if (clip.frozen) {
    const holdDuration = Math.max(0, (clip.trimmedEnd - clip.trimmedStart) - FREEZE_FRAME_EPSILON);
    graph.addNode(
      `trim=start=${clip.trimmedStart}:end=${clip.trimmedStart + FREEZE_FRAME_EPSILON},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${holdDuration}`,
      inputLabel, out,
    );
    return out;
  }
  const reverseSuffix = clip.reversed ? ',reverse' : '';
  graph.addNode(`trim=start=${clip.trimmedStart}:end=${clip.trimmedEnd},setpts=PTS-STARTPTS${reverseSuffix}`, inputLabel, out);
  return out;
}

export function applyAudioTrim(graph, inputLabel, clip) {
  const out = graph.label('atrim');
  const reverseSuffix = clip.reversed ? ',areverse' : '';
  graph.addNode(`atrim=start=${clip.trimmedStart}:end=${clip.trimmedEnd},asetpts=PTS-STARTPTS${reverseSuffix}`, inputLabel, out);
  return out;
}
