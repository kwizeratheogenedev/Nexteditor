import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Caption clips (text clips carrying text.caption - see the frontend's
// timeline/captionStyles.js) are exported through ffmpeg's subtitle renderer
// (libass) as one generated .ass file, rather than one drawtext per clip:
// libass does outlines, boxes, per-word colour and scale animation natively,
// and renders the bundled Inter font files, so the export matches the
// editor preview. All look settings come from the clip itself - this file
// holds no style presets of its own.

export const FONTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../assets/fonts');

// libass sizes text by the font's full ascender-to-descender height, CSS by
// its em square; for Inter that's 2478/2048 units, so an ASS size is scaled
// up by this much to match the preview's pixel size.
const INTER_ASS_SCALE = 1.21;

function fontNameFor(weight) {
  if (weight >= 850) return 'Inter Black';
  if (weight >= 700) return 'Inter Bold';
  if (weight >= 560) return 'Inter SemiBold';
  return 'Inter';
}

// '#rrggbb' -> '&H00BBGGRR' (ASS colours are BGR, with alpha in front).
function assColor(hex, alpha = 0) {
  const clean = /^#?[0-9a-f]{6}$/i.test(hex || '') ? hex.replace('#', '') : 'ffffff';
  const [r, g, b] = [clean.slice(0, 2), clean.slice(2, 4), clean.slice(4, 6)];
  return `&H${alpha.toString(16).padStart(2, '0').toUpperCase()}${b}${g}${r}`.toUpperCase();
}

// Inline override form: \c&HBBGGRR& (no alpha byte).
function assInlineColor(hex) {
  return `${assColor(hex).replace('&H00', '&H')}&`;
}

function assTime(seconds) {
  const cs = Math.max(0, Math.round(seconds * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}

// Caption text is data, never ASS markup: braces would start an override
// block and a backslash an escape, so both are neutralised.
function assText(text) {
  return String(text || '').replace(/\\/g, '\u29F5').replace(/\{/g, '(').replace(/\}/g, ')').replace(/\r?\n/g, '\\N');
}

const ALIGNMENT = { lower: 2, middle: 5, top: 8 };

function clipDuration(clip) {
  return Math.max(0.05, ((clip.trimmedEnd || 0) - (clip.trimmedStart || 0)) / (clip.speed || 1));
}

export function buildCaptionAss(captionClips, canvas) {
  const styles = [];
  const events = [];
  captionClips.forEach((clip, index) => {
    const text = clip.text || {};
    const caption = text.caption || {};
    const styleName = `C${index}`;
    const size = Math.round((text.fontSize || 64) * INTER_ASS_SCALE);
    const position = ALIGNMENT[caption.position] ? caption.position : 'lower';
    const marginV = position === 'lower' ? Math.round(canvas.height * 0.12) : position === 'top' ? Math.round(canvas.height * 0.09) : 0;
    const marginH = Math.round(canvas.width * 0.08);
    const box = Boolean(caption.box);
    const outline = box ? Math.max(6, Math.round((text.fontSize || 64) * 0.22)) : Math.max(0, Number(caption.outline) || 0);
    styles.push([
      `Style: ${styleName}`, fontNameFor(caption.weight || 700), size,
      assColor(text.color || '#ffffff'), assColor(text.color || '#ffffff'),
      box ? assColor('#000000', 0x5a) : assColor('#000000'), assColor('#000000', 0x5a),
      0, 0, 0, 0, 100, 100, 0, 0, box ? 3 : 1, outline, 0,
      ALIGNMENT[position], marginH, marginH, marginV, 1,
    ].join(','));

    const start = clip.startTime || 0;
    const end = start + clipDuration(clip);
    // Word times count from the clip's original start, so trimming the
    // clip's left edge hides words instead of shifting them.
    const wordBase = start - (clip.trimmedStart || 0);
    const upper = (value) => (caption.uppercase ? String(value).toLocaleUpperCase() : value);
    const words = (caption.words || []).filter((word) => word && word.text);
    const pop = caption.pop ? '{\\fscx82\\fscy82\\t(0,140,\\fscx100\\fscy100)}' : '';
    const dialogue = (from, to, body) => {
      if (to - from < 0.01) return;
      events.push(`Dialogue: 0,${assTime(from)},${assTime(to)},${styleName},,0,0,0,,${body}`);
    };

    if (caption.highlight && words.length) {
      // One event per word while it's spoken, the line with just that word
      // in the highlight colour - the karaoke "current word lights up" look.
      const highlight = assInlineColor(caption.highlightColor || '#00c8ff');
      const firstAt = wordBase + Math.max(0, words[0].start);
      if (firstAt > start) dialogue(start, firstAt, pop + assText(upper(words.map((w) => w.text).join(' '))));
      words.forEach((word, i) => {
        const from = wordBase + Math.max(0, word.start);
        const to = i < words.length - 1 ? wordBase + Math.max(word.start, words[i + 1].start) : end;
        const body = words.map((w, j) => (j === i ? `{\\c${highlight}}${assText(upper(w.text))}{\\r}` : assText(upper(w.text)))).join(' ');
        dialogue(Math.max(start, from), Math.min(end, to), (i === 0 && firstAt <= start ? pop : '') + body);
      });
    } else {
      dialogue(start, end, pop + assText(upper(text.content || words.map((w) => w.text).join(' '))));
    }
  });

  return [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${canvas.width}`,
    `PlayResY: ${canvas.height}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    ...styles,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...events,
    '',
  ].join('\n');
}

function escapeFilterPath(filePath) {
  return filePath.replace(/\\/g, '/').replace(/'/g, "\\'").replace(/:/g, '\\:');
}

// Draws every caption clip onto the video in a single subtitles pass.
export function applyCaptions(graph, videoLabel, captionClips, canvas, jobDir) {
  if (!captionClips.length) return videoLabel;
  const assPath = path.join(jobDir, 'captions.ass');
  fs.writeFileSync(assPath, buildCaptionAss(captionClips, canvas), 'utf8');
  const out = graph.label('captions');
  graph.addNode(`subtitles=filename='${escapeFilterPath(assPath)}':fontsdir='${escapeFilterPath(FONTS_DIR)}'`, videoLabel, out);
  return out;
}
