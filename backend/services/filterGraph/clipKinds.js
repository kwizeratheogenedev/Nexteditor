// A still image placed on the timeline is a `type: 'image'` clip. It renders
// through the exact same per-clip pipeline a video clip does (trim -> speed
// -> transform -> color -> vignette, then either the lane-0 program chain or
// an overlay composite), so every place that used to ask "is this a video
// clip?" really meant "does this clip carry picture content?" - that's what
// `isVideoLikeClip` answers. The only thing genuinely different about an
// image is how ffmpeg has to OPEN it (`-loop 1 -framerate <fps> -t <n>`,
// since a still has no intrinsic duration - see
// backend/routes/exportTimeline.js) and that it never has an audio stream.
//
// Mirrored exactly in frontend/src/timeline/clipKinds.js so the preview and
// the export agree on which clips are picture content and which lane a clip
// belongs to.
export function isVideoLikeClip(clip) {
  const type = clip?.type;
  // `!type` covers clips written before `type` existed at all, which were
  // always video.
  return !type || type === 'video' || type === 'image';
}

export function isImageClip(clip) {
  return clip?.type === 'image';
}
