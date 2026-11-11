import { API_ENDPOINTS } from '../config.js';

// Brings a pasted link (YouTube, Drive, Dropbox or a direct file) onto the
// user's device as a real File, in two stages the user can watch:
//   1. the server downloads the link   - progress from its socket events
//   2. the file comes to this device   - progress from the response stream
// The File is named after the video's title (or the name the link's server
// gave it) instead of the server's random id, so it shows like an upload.
//
// onProgress({ stage: 'server' | 'device', percent, overall, message })
//   percent  - this stage's own 0-100 (null while the size isn't known yet)
//   overall  - 0-100 across both stages, for a single progress bar
//
// Resolves { file, filePath, fileName, duration, title }: `file` for local
// use, `filePath`/`fileName` for the copy the server keeps for a while
// (Server 1 renders reuse it instead of uploading the file again).

const SERVER_SHARE = 0.7; // the server's download is most of the wait

const VIDEO_TYPES = { mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska', m4v: 'video/mp4' };
const AUDIO_TYPES = { mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac', webm: 'audio/webm' };

function cleanName(name) {
  return [...String(name || '')]
    .map((ch) => (ch.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(ch) ? ' ' : ch))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 150);
}

// "Me at the zoo" + video -> "Me at the zoo.mp4"; keeps an extension the
// title already has (a Drive or direct-link file name).
function fileNameFor(title, url, kind) {
  const fallback = (() => {
    try {
      const { hostname, searchParams, pathname } = new URL(url);
      if (/youtu\.?be/.test(hostname)) return `youtube-${searchParams.get('v') || pathname.split('/').pop() || 'video'}`;
      return decodeURIComponent(pathname.split('/').pop() || '') || hostname.replace(/^www\./, '');
    } catch {
      return kind;
    }
  })();
  const name = cleanName(title) || cleanName(fallback) || kind;
  if (/\.[a-z0-9]{2,5}$/i.test(name)) return name;
  return `${name}.${kind === 'audio' ? 'm4a' : 'mp4'}`;
}

function typeFor(name, kind, served) {
  const ext = (/\.([a-z0-9]{2,5})$/i.exec(name)?.[1] || '').toLowerCase();
  const table = kind === 'audio' ? AUDIO_TYPES : VIDEO_TYPES;
  return table[ext] || served || (kind === 'audio' ? 'audio/mp4' : 'video/mp4');
}

// Reads a response body while reporting how much has arrived.
async function readWithProgress(response, onPercent) {
  const total = Number(response.headers.get('content-length')) || 0;
  if (!response.body?.getReader) return response.blob();
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onPercent(total ? Math.min(100, Math.round((received / total) * 100)) : null, received);
  }
  return new Blob(chunks, { type: response.headers.get('content-type') || '' });
}

const megabytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;

export async function fetchLinkToDevice({ url, kind = 'video', socket, socketId, slotId, onProgress, signal }) {
  const report = (stage, percent, message) => {
    const share = stage === 'server' ? (percent || 0) * SERVER_SHARE : SERVER_SHARE * 100 + (percent || 0) * (1 - SERVER_SHARE);
    onProgress?.({ stage, percent, overall: Math.round(share), message });
  };
  // A unique slot id so this fetch only hears its own progress, even with
  // several links downloading at once.
  const ownSlot = slotId || `link-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const progressEvent = kind === 'audio' ? 'audio-fetch-progress' : 'url-fetch-progress';
  const onServerProgress = (payload) => {
    if (payload?.slotId !== ownSlot) return;
    const percent = Math.max(0, Math.min(100, Number(payload.percent) || 0));
    const message = payload.status && !/^complete$/i.test(payload.status)
      ? `${payload.status.replace(/\.\.\.$/, '…')} ${percent}%`
      : `Downloading on the server… ${percent}%`;
    report('server', percent, message);
  };
  socket?.on(progressEvent, onServerProgress);

  report('server', 0, 'Starting the download…');
  let data;
  try {
    const res = await fetch(API_ENDPOINTS.fetchUrlVideo, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, type: kind, socketId, slotId: ownSlot }),
      signal,
    });
    data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not fetch that link.');
  } finally {
    socket?.off(progressEvent, onServerProgress);
  }

  report('device', 0, 'Bringing it to your device…');
  const fileRes = await fetch(API_ENDPOINTS.fetchUrlFile(data.fileName, kind), { credentials: 'include', signal });
  if (!fileRes.ok) throw new Error('The download finished but could not be loaded - try again.');
  const blob = await readWithProgress(fileRes, (percent, received) => {
    report('device', percent ?? 0, percent == null
      ? `Bringing it to your device… ${megabytes(received)}`
      : `Bringing it to your device… ${percent}%`);
  });

  const name = fileNameFor(data.title, url, kind);
  const file = new File([blob], name, { type: typeFor(name, kind, blob.type) });
  file.nexFromLink = true;
  if (Number.isFinite(data.duration) && data.duration > 0) file.nexDuration = data.duration;
  report('device', 100, 'Done');
  return { file, filePath: data.filePath, fileName: data.fileName, duration: data.duration, title: data.title || '' };
}
