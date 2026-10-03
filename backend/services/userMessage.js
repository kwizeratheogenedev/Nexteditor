// Turns any error into a sentence a non-developer can act on. Users never see
// ffmpeg's console output, file paths or Node's system errors - the raw
// details go to the server log (where the error is caught), the user gets
// what happened and what to do.

// ffmpeg's output -> what to tell the user. First match wins.
const FFMPEG_PATTERNS = [
  [/No such file or directory/i, 'One of your files is no longer on the server (uploaded files are kept for a limited time). Please add it again and try once more.'],
  [/No space left on device/i, 'The server is out of storage space right now. Please try again in a few minutes.'],
  [/Cannot allocate memory|out of memory/i, 'The server ran out of memory on this video. Try a shorter video or a lower quality.'],
  [/moov atom not found|Invalid data found when processing input|could not find codec parameters|End of file|corrupt/i, 'One of your files couldn\'t be read - it may be damaged or in a format that isn\'t supported. Try exporting it again as MP4.'],
  [/Permission denied/i, 'The server couldn\'t open one of your files. Please try again.'],
  [/does not contain any stream|Output file .* does not contain|matches no streams/i, 'One of your files has no usable video or sound in it. Please check the file and try again.'],
];

const GENERIC_FFMPEG = 'The video couldn\'t be processed on the server. Please try again - if it keeps failing, try a shorter or different file.';

// An Error for a failed ffmpeg/ffprobe run: a plain message for the user,
// the raw output kept in `details` for the log.
export function ffmpegError(stderr, { code } = {}) {
  const text = String(stderr || '');
  const match = FFMPEG_PATTERNS.find(([pattern]) => pattern.test(text));
  const error = new Error(match ? match[1] : GENERIC_FFMPEG);
  error.code = code || 'FFMPEG_FAILED';
  error.details = text.slice(-4000);
  error.userFacing = true;
  return error;
}

// Text that is clearly meant for developers, not users.
const TECHNICAL = /ffmpeg version|ffprobe|libav|Error opening|\bat \S+ \(|\/opt\/|\/var\/|\/tmp\/|[A-Z]:\\|node_modules|ENOENT|EACCES|EPERM|ECONN|ETIMEDOUT|TypeError|ReferenceError|SyntaxError|Cannot read propert|is not a function|undefined|Mongo|E11000/;

// err -> the message to show the user. Our own plain-language errors pass
// through; system errors and anything technical become `fallback`.
export function toUserMessage(err, fallback = 'Something went wrong. Please try again.') {
  if (!err) return fallback;
  if (err.userFacing && err.message) return err.message;
  // Node system errors (missing file, permission, network) carry a syscall.
  if (err.syscall || typeof err.errno === 'number') {
    if (String(err.syscall).startsWith('spawn')) return fallback;
    if (err.code === 'ENOENT') return FFMPEG_PATTERNS[0][1];
    if (err.code === 'ENOSPC') return FFMPEG_PATTERNS[1][1];
    return fallback;
  }
  const message = String(err.message || '').trim();
  if (!message || message.length > 300 || TECHNICAL.test(message)) return fallback;
  return message;
}
