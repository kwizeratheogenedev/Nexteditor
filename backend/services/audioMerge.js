// Audio Merge: the first audio plays whole, then the second is cut (from its
// start, never sped up) to exactly the time left before the target length.

export const MERGE_TARGET_SECONDS = 8 * 60;

function formatTime(seconds) {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

// Returns { secondSeconds } - how much of the second audio to keep - or
// { error } when these two audios can't make the target length.
export function planAudioMerge(firstDuration, secondDuration, target = MERGE_TARGET_SECONDS) {
  if (firstDuration >= target) {
    return { error: `The first audio is ${formatTime(firstDuration)}, so there is no room left for the second one. It must be shorter than ${formatTime(target)}.` };
  }
  const secondSeconds = target - firstDuration;
  if (secondDuration < secondSeconds) {
    return { error: `Together these audios are only ${formatTime(firstDuration + secondDuration)}. The second audio must be at least ${formatTime(secondSeconds)} to reach ${formatTime(target)}.` };
  }
  return { secondSeconds };
}

// One run writes both formats, so the WAV comes straight from the sources
// rather than being decoded back out of the MP3. A compressed file's reported
// length can run a few ms past what actually decodes, so the second audio
// keeps a second to spare and `-t` makes the exact cut.
export function buildAudioMergeArgs(firstPath, secondPath, secondSeconds, { mp3Path, wavPath }, target = MERGE_TARGET_SECONDS) {
  return [
    '-hide_banner',
    '-y',
    '-i', firstPath,
    '-i', secondPath,
    '-filter_complex',
    `[1:a:0]atrim=duration=${(secondSeconds + 1).toFixed(3)},asetpts=PTS-STARTPTS[cut];[0:a:0][cut]concat=n=2:v=0:a=1,aformat=channel_layouts=stereo,asplit=2[mp3][wav]`,
    '-map', '[mp3]',
    '-c:a', 'libmp3lame',
    '-b:a', '320k',
    '-t', String(target),
    mp3Path,
    '-map', '[wav]',
    '-c:a', 'pcm_s16le',
    '-t', String(target),
    wavPath,
  ];
}
