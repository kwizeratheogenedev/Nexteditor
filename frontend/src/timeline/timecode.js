// Timecodes in the studio's "M:SS:FF" style (minutes, seconds, frames),
// e.g. 0:06:00 for six seconds - the format the editor's transport, the
// inspector's Start field and the timeline header all share. Past an hour it
// becomes H:MM:SS:FF.
export function formatTimecode(seconds, fps = 30) {
  const rate = Math.max(1, Math.round(fps || 30));
  const safe = Math.max(0, Number(seconds) || 0);
  const totalFrames = Math.round(safe * rate);
  const frames = totalFrames % rate;
  const totalSeconds = Math.floor(totalFrames / rate);
  const secs = totalSeconds % 60;
  const mins = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const pad = (n) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(mins)}:${pad(secs)}:${pad(frames)}` : `${mins}:${pad(secs)}:${pad(frames)}`;
}

// Short clip-length label for media thumbnails: 0:06, 1:23, 1:02:03.
export function formatShortDuration(seconds) {
  const safe = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(mins)}:${pad(secs)}` : `${mins}:${pad(secs)}`;
}
