// Caption looks, shared by the preview (drawCaption below) and - through
// the settings each caption clip stores in text.caption - by the export
// (backend/services/filterGraph/effects/captionAss.js). The export holds no
// presets of its own, so what a clip stores is exactly what renders.

export const CAPTION_STYLES = {
  karaoke: {
    label: 'Karaoke',
    weight: 900,
    fontSize: 64,
    color: '#ffffff',
    highlight: true,
    highlightColor: '#00c8ff',
    outline: 3,
    box: false,
    uppercase: false,
    pop: false,
    maxWords: 7,
    maxChars: 34,
  },
  bold: {
    label: 'Bold pop',
    weight: 900,
    fontSize: 84,
    color: '#ffffff',
    highlight: true,
    highlightColor: '#ffd400',
    outline: 6,
    box: false,
    uppercase: true,
    pop: true,
    maxWords: 3,
    maxChars: 18,
  },
  minimal: {
    label: 'Minimal',
    weight: 600,
    fontSize: 52,
    color: '#ffffff',
    highlight: false,
    highlightColor: '#00c8ff',
    outline: 2,
    box: false,
    uppercase: false,
    pop: false,
    maxWords: 9,
    maxChars: 42,
  },
  subtitle: {
    label: 'Subtitle',
    weight: 600,
    fontSize: 48,
    color: '#ffffff',
    highlight: false,
    highlightColor: '#00c8ff',
    outline: 0,
    box: true,
    uppercase: false,
    pop: false,
    maxWords: 10,
    maxChars: 42,
  },
};

export const DEFAULT_CAPTION_STYLE = 'karaoke';
export const CAPTION_POSITIONS = ['lower', 'middle', 'top'];

// The clip-level settings for a style, with any user overrides on top.
export function captionSettings(styleId, overrides = {}) {
  const preset = CAPTION_STYLES[styleId] || CAPTION_STYLES[DEFAULT_CAPTION_STYLE];
  return { style: CAPTION_STYLES[styleId] ? styleId : DEFAULT_CAPTION_STYLE, position: 'lower', ...preset, ...overrides };
}

const POP_SECONDS = 0.14;

// Word boxes for one line of caption text, so a single word can be coloured
// while the line stays centred as a whole.
function layoutWords(ctx, words) {
  const space = ctx.measureText(' ').width;
  let x = 0;
  const boxes = words.map((word) => {
    const width = ctx.measureText(word).width;
    const box = { word, x, width };
    x += width + space;
    return box;
  });
  return { boxes, width: Math.max(0, x - space) };
}

// Splits caption words over as few lines as fit inside `maxWidth`.
function wrapWords(ctx, words, maxWidth) {
  const lines = [];
  let current = [];
  words.forEach((word, index) => {
    const trial = [...current, { word, index }];
    if (current.length && layoutWords(ctx, trial.map((w) => w.word)).width > maxWidth) {
      lines.push(current);
      current = [{ word, index }];
    } else {
      current = trial;
    }
  });
  if (current.length) lines.push(current);
  return lines;
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, height / 2, width / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

// Draws one caption clip at `localTime` seconds into the clip.
export function drawCaption(ctx, clip, canvas, localTime) {
  const text = clip.text || {};
  const caption = text.caption || {};
  const timed = (caption.words || []).filter((word) => word && word.text);
  const rawWords = timed.length ? timed.map((word) => word.text) : String(text.content || '').split(/\s+/).filter(Boolean);
  if (!rawWords.length) return;
  const words = caption.uppercase ? rawWords.map((word) => word.toLocaleUpperCase()) : rawWords;
  const fontSize = text.fontSize || 64;
  const weight = caption.weight || 700;
  const activeIndex = caption.highlight && timed.length
    ? timed.findIndex((word, i) => localTime >= word.start && (i === timed.length - 1 || localTime < timed[i + 1].start))
    : -1;

  ctx.save();
  ctx.font = `${weight} ${fontSize}px Inter, system-ui, sans-serif`;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.lineJoin = 'round';
  const lines = wrapWords(ctx, words, canvas.width * 0.84);
  const lineHeight = fontSize * 1.18;
  const blockHeight = lineHeight * lines.length;
  const position = caption.position || 'lower';
  // Top of the text block, matching the export's margins (captionAss.js).
  const top = position === 'top'
    ? canvas.height * 0.09
    : position === 'middle'
      ? (canvas.height - blockHeight) / 2
      : canvas.height * 0.88 - blockHeight;

  if (caption.pop && localTime < POP_SECONDS) {
    const scale = 0.82 + 0.18 * Math.max(0, localTime / POP_SECONDS);
    const cx = canvas.width / 2;
    const cy = top + blockHeight / 2;
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.translate(-cx, -cy);
  }

  lines.forEach((line, lineNumber) => {
    const { boxes, width } = layoutWords(ctx, line.map((w) => w.word));
    const startX = (canvas.width - width) / 2;
    const baseline = top + lineHeight * lineNumber + fontSize * 0.95;

    if (caption.box) {
      const padX = fontSize * 0.3;
      const padY = fontSize * 0.14;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
      roundRect(ctx, startX - padX, baseline - fontSize * 0.95 - padY, width + padX * 2, lineHeight + padY, fontSize * 0.12);
      ctx.fill();
    }

    boxes.forEach((box, i) => {
      const x = startX + box.x;
      if (caption.outline > 0) {
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = caption.outline * 2;
        ctx.strokeText(box.word, x, baseline);
      }
      ctx.fillStyle = line[i].index === activeIndex ? (caption.highlightColor || '#00c8ff') : (text.color || '#ffffff');
      ctx.fillText(box.word, x, baseline);
    });
  });
  ctx.restore();
}
