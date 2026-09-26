import { createTextClip } from '../hooks/usePersistedEditorState';
import { buildCaptionLines } from './captionLines.js';
import { captionSettings } from './captionStyles.js';

// Caption clips are ordinary text clips carrying text.caption: the look
// settings plus the line's words with times relative to the clip's start.
// Being text clips, they can be moved, trimmed, split and deleted like any
// other clip; the preview draws them with drawCaption and the export with
// the subtitle renderer.

export const CAPTIONS_LANE_NAME = 'Captions';

export function captionClipsFromWords(words, { styleId, overrides = {}, removeFillers = false, trackIndex = 0 } = {}) {
  const settings = captionSettings(styleId, overrides);
  return buildCaptionLines(words, settings.style, { removeFillers }).map((line) => {
    const clip = createTextClip({
      trackIndex,
      startTime: line.start,
      duration: line.end - line.start,
      text: {
        content: line.text,
        fontFamily: 'Inter, sans-serif',
        fontSize: settings.fontSize,
        color: settings.color,
        align: 'center',
        caption: {
          style: settings.style,
          weight: settings.weight,
          highlight: settings.highlight,
          highlightColor: settings.highlightColor,
          outline: settings.outline,
          box: settings.box,
          uppercase: settings.uppercase,
          pop: settings.pop,
          position: settings.position,
          words: line.words.map((word) => ({
            text: word.text,
            start: +(word.start - line.start).toFixed(3),
            end: +(word.end - line.start).toFixed(3),
          })),
        },
      },
    });
    return { ...clip, label: line.text };
  });
}

export function isCaptionClip(clip) {
  return clip?.type === 'text' && Boolean(clip.text?.caption);
}

// Every word currently in caption clips, back on the timeline's own clock -
// what a style change re-flows into new lines.
export function wordsFromCaptionClips(clips) {
  return clips
    .filter(isCaptionClip)
    .flatMap((clip) => (clip.text.caption.words || []).map((word) => ({
      text: word.text,
      start: clip.startTime + word.start,
      end: clip.startTime + word.end,
    })))
    .sort((a, b) => a.start - b.start);
}
