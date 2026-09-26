import { CAPTION_STYLES, DEFAULT_CAPTION_STYLE } from './captionStyles.js';

// Turns transcribed words (each with start/end on the timeline) into
// caption lines for a style: a new line starts at a sentence end, after a
// pause, or when the style's word/character budget is reached - Bold pop
// flashes 1-3 words at a time, Subtitle carries a full sentence.

const FILLERS = new Set(['um', 'umm', 'uh', 'uhh', 'uhm', 'erm', 'er', 'hmm', 'mm', 'mhm', 'ah']);
const PAUSE_SECONDS = 0.7;
const MAX_LINE_SECONDS = 5;
const MIN_LINE_SECONDS = 0.5;
const HOLD_SECONDS = 0.4; // keep a line up a little after its last word

export function isFiller(word) {
  return FILLERS.has(String(word).toLowerCase().replace(/[^\p{L}]/gu, ''));
}

export function buildCaptionLines(words, styleId = DEFAULT_CAPTION_STYLE, { removeFillers = false } = {}) {
  const style = CAPTION_STYLES[styleId] || CAPTION_STYLES[DEFAULT_CAPTION_STYLE];
  const kept = (words || [])
    .filter((word) => word && String(word.text || '').trim() && Number.isFinite(word.start) && Number.isFinite(word.end))
    .filter((word) => !removeFillers || !isFiller(word.text))
    .sort((a, b) => a.start - b.start);

  const lines = [];
  let current = [];
  const flush = () => {
    if (current.length) lines.push(current);
    current = [];
  };
  kept.forEach((word) => {
    const previous = current[current.length - 1];
    if (previous) {
      const chars = current.reduce((sum, w) => sum + w.text.length + 1, 0) + word.text.length;
      const sentenceEnded = /[.!?…]["')\]]?$/.test(previous.text) && current.length >= 2;
      if (
        word.start - previous.end > PAUSE_SECONDS
        || sentenceEnded
        || current.length >= style.maxWords
        || chars > style.maxChars
        || word.end - current[0].start > MAX_LINE_SECONDS
      ) {
        flush();
      }
    }
    current.push({ text: String(word.text).trim(), start: word.start, end: Math.max(word.end, word.start) });
  });
  flush();

  return lines.map((lineWords, index) => {
    const start = lineWords[0].start;
    const nextStart = lines[index + 1]?.[0]?.start ?? Infinity;
    const spoken = lineWords[lineWords.length - 1].end;
    const end = Math.min(Math.max(spoken + HOLD_SECONDS, start + MIN_LINE_SECONDS), Math.max(nextStart - 0.02, spoken));
    return {
      start,
      end: Math.max(end, start + 0.1),
      text: lineWords.map((w) => w.text).join(' '),
      words: lineWords,
    };
  });
}
