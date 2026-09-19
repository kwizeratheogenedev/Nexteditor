// A still image placed on the timeline is a `type: 'image'` clip. It behaves
// like a video clip everywhere that matters - it lives on a VIDEO lane, it
// trims/moves/transitions/keyframes the same way, and it renders through the
// same compositor - so the two questions the rest of the app actually asks
// are "does this clip carry picture content?" (isVideoLikeClip) and "which
// lane type does this clip belong to?" (laneTypeForClip). What differs is
// only how the picture is obtained: an <img> element rather than a pooled
// <video>, with no source duration of its own to respect.
//
// Mirrored exactly in backend/services/filterGraph/clipKinds.js so the
// preview and the export agree on both questions.
export function isVideoLikeClip(clip) {
  const type = clip?.type;
  // `!type` covers clips written before `type` existed at all, which were
  // always video.
  return !type || type === 'video' || type === 'image';
}

export function isImageClip(clip) {
  return clip?.type === 'image';
}

// Which of trackMeta's three lane groups (video/audio/text) a clip lives on.
// Image clips share the video lanes with video clips, and adjustment layers
// already did the same for z-order (see createAdjustmentClip).
export function laneTypeForClip(clip) {
  const type = clip?.type || 'video';
  if (type === 'image' || type === 'adjustment') return 'video';
  return type;
}
