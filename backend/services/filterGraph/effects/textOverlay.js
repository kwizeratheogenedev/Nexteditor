import fs from 'fs';
import path from 'path';

function escapeFilterPath(filePath) {
  return filePath.replace(/\\/g, '/').replace(/'/g, "\\'").replace(/:/g, '\\:');
}

// Maps a CSS-style font-family stack (e.g. "Inter, sans-serif", as set by
// the RightPanel Text tab) onto a name the bundled ffmpeg's font resolution
// can actually find. Falls back to Arial, which we've confirmed the bundled
// static ffmpeg build resolves even when its fontconfig setup is broken
// (fontconfig logs an error but drawtext still renders with a usable font).
function resolveFontName(fontFamily) {
  const first = (fontFamily || '').split(',')[0]?.trim().replace(/^["']|["']$/g, '');
  if (!first || /sans-serif|serif|monospace|inherit/i.test(first)) return 'Arial';
  return first;
}

// Draws one text clip's content onto the running video stream, visible only
// during its [startTime, endTime) window on the assembled (post-concat)
// timeline. The text content is written to a temp file and referenced via
// drawtext's textfile= option rather than being inlined into the filter
// string - ffmpeg's drawtext text= option needs a notoriously fiddly
// two-level escape (once for the filtergraph parser, once for drawtext's
// own %{...} expansion syntax); textfile= sidesteps that entirely, since
// the content never becomes part of a filter-graph string. Reuses the same
// path-escaping already proven safe for subtitle paths in burnSubtitles.js.
export function applyTextOverlay(graph, videoLabel, clip, canvas, startTime, endTime, jobDir) {
  const text = clip.text || {};
  const content = (text.content || '').trim();
  if (!content) return videoLabel;

  const textFilePath = path.join(jobDir, `text-${clip.id}.txt`);
  fs.writeFileSync(textFilePath, content, 'utf8');

  const fontSize = text.fontSize || 64;
  const color = (text.color || '#ffffff').replace('#', '0x');
  const align = text.align || 'center';
  const fontName = resolveFontName(text.fontFamily);
  const margin = Math.round(canvas.width * 0.08);

  // Matches the live canvas preview's placement (bottom-anchored, 88% down
  // the frame) so exported text lands where the user saw it.
  const xExpr = align === 'left' ? String(margin) : align === 'right' ? `w-text_w-${margin}` : '(w-text_w)/2';
  const yExpr = 'h*0.88-text_h';

  const out = graph.label('text');
  graph.addNode(
    `drawtext=textfile='${escapeFilterPath(textFilePath)}':reload=0:font='${fontName}':fontsize=${fontSize}:fontcolor=${color}:borderw=${Math.max(1, Math.round(fontSize * 0.06))}:bordercolor=black@0.6:x=${xExpr}:y=${yExpr}:enable='between(t\\,${startTime.toFixed(3)}\\,${endTime.toFixed(3)})'`,
    videoLabel,
    out,
  );
  return out;
}
