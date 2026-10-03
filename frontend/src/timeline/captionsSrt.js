import { clipDuration } from './transitions.js';

// The timeline's captions as an .srt subtitle file - what you upload to
// YouTube (or any player) for a long video instead of burning the text into
// the picture. One cue per caption clip, timed exactly as on the timeline.

// (Same test as captionClips.js's isCaptionClip, repeated here so this file
// has no editor-state imports.)
const isCaptionClip = (clip) => clip?.type === 'text' && Boolean(clip.text?.caption);

function srtTime(seconds) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const pad = (n, width = 2) => String(n).padStart(width, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms % 1000, 3)}`;
}

// At most two lines of ~42 characters - the usual subtitle limit.
function wrapCue(text, maxLine = 42) {
  const words = text.split(/\s+/).filter(Boolean);
  if (text.length <= maxLine || words.length < 2) return text;
  let best = 1;
  let bestScore = Infinity;
  for (let i = 1; i < words.length; i += 1) {
    const a = words.slice(0, i).join(' ').length;
    const b = words.slice(i).join(' ').length;
    const score = Math.max(a, b);
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return `${words.slice(0, best).join(' ')}\n${words.slice(best).join(' ')}`;
}

// The text a caption clip shows: its words, minus any trimmed off its ends
// (word times count from the clip's original start, see captionClips.js) -
// or its plain text when it has no timed words.
function cueText(clip) {
  const words = clip.text?.caption?.words || [];
  const content = String(clip.text?.content || '').replace(/\s+/g, ' ').trim();
  if (!words.length) return content;
  const from = clip.trimmedStart || 0;
  const to = clip.trimmedEnd ?? Infinity;
  const kept = words.filter((word) => word.start >= from - 0.01 && word.start < to);
  const keptText = kept.map((word) => word.text).join(' ');
  // Words untouched by trimming: keep the clip's own text (it may have been
  // edited by hand); trimmed: only the words still inside it.
  return kept.length === words.length ? content || keptText : keptText;
}

// clips: the editor timeline; trackMeta: hidden caption tracks are left out,
// like disabled clips - the file matches what the video shows.
export function captionsToSrt(clips, trackMeta) {
  const cues = clips
    .filter((clip) => isCaptionClip(clip) && clip.enabled !== false && !trackMeta?.text?.[clip.trackIndex || 0]?.hidden)
    .map((clip) => ({ start: clip.startTime, end: clip.startTime + clipDuration(clip), text: cueText(clip) }))
    .filter((cue) => cue.text && cue.end > cue.start)
    .sort((a, b) => a.start - b.start);
  return cues
    .map((cue, i) => `${i + 1}\n${srtTime(cue.start)} --> ${srtTime(cue.end)}\n${wrapCue(cue.text)}`)
    .join('\n\n') + (cues.length ? '\n' : '');
}

export function countCaptionCues(clips) {
  return clips.filter(isCaptionClip).length;
}
