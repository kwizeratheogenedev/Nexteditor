// What users see when something fails: plain sentences, never developer
// output (ffmpeg logs, server paths, JavaScript errors). The server already
// sends plain messages (backend/services/userMessage.js); this is the last
// line of defence for anything older or unexpected, e.g. a failed job saved
// before that change.

// How long an error stays on screen before it clears itself.
export const ERROR_DISPLAY_MS = 5000;

const TECHNICAL = /ffmpeg version|ffprobe|libav|Error opening|\bat \S+ \(|\/opt\/|\/var\/|\/tmp\/|[A-Z]:\\|node_modules|ENOENT|EACCES|ECONN|ETIMEDOUT|TypeError|ReferenceError|SyntaxError|Cannot read propert|is not a function|Unexpected token|JSON|\bstack\b/;

export function friendlyError(text, fallback = 'Something went wrong. Please try again.') {
  const message = String(text || '').trim();
  if (!message) return fallback;
  // The browser couldn't reach the server at all.
  if (/Failed to fetch|NetworkError|Load failed|ERR_INTERNET_DISCONNECTED/i.test(message)) {
    return 'Can\'t reach the server. Check your internet connection and try again.';
  }
  // ffmpeg's missing-file error, from failed jobs recorded before the
  // server learned to explain it.
  if (/No such file or directory/i.test(message)) {
    return 'One of your files is no longer on the server (uploaded files are kept for a limited time). Please add it again and try once more.';
  }
  if (message.length > 300 || TECHNICAL.test(message)) return fallback;
  return message;
}
