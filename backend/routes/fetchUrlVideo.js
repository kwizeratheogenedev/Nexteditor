import express from 'express';
import fs from 'fs';
import path from 'path';
import { createWriteStream } from 'fs';
import crypto from 'crypto';
import { Ytdl, parseVideoId } from '@distube/ytdl-core';
import { probeDuration, runFFmpeg } from '../services/ffmpeg.js';
import { MAX_DOWNLOAD_BYTES, downloadErrorMessage, downloadToFile } from '../services/safeDownload.js';
import { getIo } from '../socket.js';
import { UPLOADS_DIR } from '../storagePaths.js';
import { toUserMessage } from '../services/userMessage.js';
import { optionalAuth } from '../middleware/auth.js';
import { trackOperation } from '../services/operations.js';

const uploadsDir = UPLOADS_DIR;
const router = express.Router();

/**
 * Detect the URL type and extract relevant information
 * Returns: { type: 'youtube' | 'gdrive' | 'dropbox' | 'direct', originalUrl }
 */
function detectUrlType(url) {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();

    if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) {
      return { type: 'youtube', originalUrl: url };
    }
    if (hostname.includes('drive.google.com')) {
      return { type: 'gdrive', originalUrl: url };
    }
    if (hostname.includes('dropbox.com')) {
      return { type: 'dropbox', originalUrl: url };
    }

    // Direct video URL
    return { type: 'direct', originalUrl: url };
  } catch (err) {
    throw new Error('Invalid URL format');
  }
}

/**
 * Convert Google Drive share URL to direct download URL
 * Input: https://drive.google.com/file/d/{FILE_ID}/view
 * Output: https://drive.google.com/uc?export=download&id={FILE_ID}
 */
function convertGdriveUrl(url) {
  const fileIdMatch = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (!fileIdMatch) {
    throw new Error('Invalid Google Drive URL. Expected format: https://drive.google.com/file/d/{FILE_ID}/view');
  }
  const fileId = fileIdMatch[1];
  return `https://drive.google.com/uc?export=download&id=${fileId}`;
}

/**
 * Convert Dropbox share URL to direct download URL
 * Input: https://www.dropbox.com/s/{PATH}?dl=0
 * Output: https://www.dropbox.com/s/{PATH}?dl=1
 */
function convertDropboxUrl(url) {
  return url.replace('?dl=0', '?dl=1').replace('?dl=1', '?dl=1');
}

/**
 * Emit progress event to connected Socket.IO client
 */
function emitProgress(socketId, eventName, payload) {
  const io = getIo();
  const clientSocket = socketId ? io?.sockets.sockets.get(socketId) : null;
  if (clientSocket) {
    clientSocket.emit(eventName, payload);
  }
}

function getEventNames(mediaType) {
  return mediaType === 'audio'
    ? { progress: 'audio-fetch-progress', error: 'audio-fetch-error' }
    : { progress: 'url-fetch-progress', error: 'url-fetch-error' };
}

/**
 * Download from YouTube with @distube/ytdl-core v5 - a pure-JS extractor
 * (no external binary). The original implementation shelled out to the
 * `yt-dlp` CLI, which needs installing system-wide and, like whisper.cpp's
 * local binary, is exactly the kind of unsigned executable Windows Smart App
 * Control blocks with no reliable per-app exception - running entirely
 * inside the already-trusted Node process sidesteps that whole problem.
 *
 * YouTube no longer serves picture and sound together in one format (only
 * separate streams), so a video is fetched as two downloads - the best
 * picture up to 720p and the best sound - and joined with ffmpeg without
 * re-encoding. An audio fetch is just the sound, saved as is.
 */
const youtube = new Ytdl();
// 720p, not 1080p: YouTube sends video slowly (often slower than real
// time), and 720p is about half the size, so a long video arrives about
// twice as fast. Measured on the shorter side so vertical Shorts
// (720x1280) still come in at 720p.
const YOUTUBE_MAX_RESOLUTION = 720;
const YOUTUBE_ERROR = 'The YouTube video could not be downloaded. It may be private, age-restricted or unavailable.';

const isPlainStream = (f) => !f.isLive && !f.isHLS && !f.isDrm && !f.isOtf;

// H.264 in MP4 first: it plays in every browser and in the editor's own
// decoders. Then the tallest picture, then the higher bitrate.
function pickYouTubeVideoFormat(formats) {
  const shortSide = (f) => Math.min(f.width || f.height || 0, f.height || f.width || 0);
  const options = formats.filter((f) => f.hasVideo && !f.hasAudio && isPlainStream(f) && shortSide(f) <= YOUTUBE_MAX_RESOLUTION);
  const isH264 = (f) => /avc1/i.test(f.codecs || f.videoCodec || '') && f.container === 'mp4';
  return options.sort((a, b) => (
    (isH264(b) - isH264(a))
    || (shortSide(b) - shortSide(a))
    || ((b.bitrate || 0) - (a.bitrate || 0))
  ))[0] || null;
}

// AAC in MP4 (m4a) first - it goes into an MP4 next to any picture and
// plays everywhere - then the higher bitrate; the volume-normalised (DRC)
// variants only as a last resort.
function pickYouTubeAudioFormat(formats) {
  const options = formats.filter((f) => f.hasAudio && !f.hasVideo && isPlainStream(f));
  const isAac = (f) => f.container === 'mp4' && /mp4a/i.test(f.codecs || f.audioCodec || '');
  return options.sort((a, b) => (
    (Number(a.isDrc) - Number(b.isDrc))
    || (isAac(b) - isAac(a))
    || ((b.audioBitrate || b.bitrate || 0) - (a.audioBitrate || a.bitrate || 0))
  ))[0] || null;
}

// Streams one format to a file. `onBytes(downloaded)` reports this stream's
// running total so the caller can show combined progress and enforce the
// size cap across both streams.
function downloadYouTubeFormat(info, format, filePath, onBytes) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let stream = null;
    let writeStream = null;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      stream?.destroy();
      writeStream?.destroy();
      reject(err);
    };
    stream = youtube.download(info, {
      format,
      onProgress: ({ downloaded }) => {
        try {
          onBytes(downloaded);
        } catch (err) {
          fail(err);
        }
      },
    });
    writeStream = createWriteStream(filePath);
    stream.on('error', (err) => {
      console.warn('YouTube download failed:', err?.code || '', err?.message || err);
      fail(new Error(YOUTUBE_ERROR));
    });
    writeStream.on('error', fail);
    writeStream.on('finish', () => { if (!settled) { settled = true; resolve(); } });
    stream.pipe(writeStream);
  });
}

async function downloadYouTubeVideo(url, outputPath, socketId, progressEvent, slotId, mediaType) {
  if (!parseVideoId(url)) {
    throw new Error('That doesn\'t look like a valid YouTube video URL.');
  }

  let info;
  try {
    info = await youtube.getInfo(url);
  } catch (err) {
    console.warn('YouTube lookup failed:', err?.code || '', err?.message || err);
    throw new Error(YOUTUBE_ERROR);
  }

  const audioFormat = pickYouTubeAudioFormat(info.formats);
  const videoFormat = mediaType === 'audio' ? null : pickYouTubeVideoFormat(info.formats);
  if (!audioFormat && mediaType === 'audio') {
    throw new Error('This YouTube video has no downloadable audio.');
  }
  if (mediaType !== 'audio' && !videoFormat) {
    throw new Error('This YouTube video has no downloadable video.');
  }

  // Progress over both downloads together (5-88%), leaving room for the
  // join and the duration probe after it.
  const parts = [videoFormat, audioFormat].filter(Boolean);
  const expected = parts.reduce((sum, f) => sum + (f.contentLength || 0), 0);
  const done = new Map();
  let lastPercent = -1;
  const report = (format) => (downloaded) => {
    done.set(format.itag, downloaded);
    const total = [...done.values()].reduce((sum, n) => sum + n, 0);
    if (total > MAX_DOWNLOAD_BYTES) {
      throw new Error(`That video is larger than the ${Math.round(MAX_DOWNLOAD_BYTES / 1024 ** 3)} GB limit for links.`);
    }
    if (!expected) return;
    const percent = 5 + Math.round(Math.min(1, total / expected) * 83);
    if (percent !== lastPercent) {
      lastPercent = percent;
      emitProgress(socketId, progressEvent, { percent, slotId });
    }
  };

  const title = info.videoDetails?.title || '';
  if (mediaType === 'audio') {
    await downloadYouTubeFormat(info, audioFormat, outputPath, report(audioFormat));
    return { title };
  }

  // Picture-only fallback if a video somehow has no separate sound.
  if (!audioFormat) {
    await downloadYouTubeFormat(info, videoFormat, outputPath, report(videoFormat));
    return { title };
  }

  const videoPath = `${outputPath}.v`;
  const audioPath = `${outputPath}.a`;
  try {
    await Promise.all([
      downloadYouTubeFormat(info, videoFormat, videoPath, report(videoFormat)),
      downloadYouTubeFormat(info, audioFormat, audioPath, report(audioFormat)),
    ]);
    emitProgress(socketId, progressEvent, { percent: 89, status: 'Joining picture and sound...', slotId });
    // Stream copy - no re-encode, so this takes seconds even for long videos.
    await runFFmpeg([
      '-y', '-hide_banner', '-loglevel', 'error',
      '-i', videoPath, '-i', audioPath,
      '-map', '0:v:0', '-map', '1:a:0',
      '-c', 'copy', '-movflags', '+faststart',
      '-f', 'mp4', outputPath,
    ], { timeout: 15 * 60 * 1000 });
  } finally {
    [videoPath, audioPath].forEach((file) => fs.promises.unlink(file).catch(() => {}));
  }
  return { title };
}

/**
 * Download video from an HTTP/HTTPS URL with progress tracking - public
 * addresses only, size-capped (see services/safeDownload.js).
 */
async function downloadHttpVideo(url, outputPath, socketId, progressEvent, slotId) {
  let lastPercent = -1;
  try {
    const { name } = await downloadToFile(url, outputPath, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      onProgress: (received, total) => {
        if (!total) return;
        const percent = Math.round((received / total) * 100);
        if (percent !== lastPercent) {
          lastPercent = percent;
          emitProgress(socketId, progressEvent, { percent, slotId });
        }
      },
    });
    return { title: name };
  } catch (err) {
    if (!err?.userFacing) console.warn('Link download failed:', err?.message || err);
    throw new Error(downloadErrorMessage(err));
  }
}

// Drops characters that aren't allowed in file names (and control
// characters), and squeezes the spaces.
function cleanTitle(title) {
  return String(title || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 150);
}

/**
 * Main POST route handler
 */
router.post('/', optionalAuth, trackOperation('link-fetch'), async (req, res) => {
  const { url, socketId, type, slotId } = req.body;
  const mediaType = type === 'audio' ? 'audio' : 'video';
  const events = getEventNames(mediaType);

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid URL parameter' });
  }

  const url_trimmed = url.trim();
  const filename = crypto.randomBytes(16).toString('hex');
  const outputPath = path.join(uploadsDir, filename);

  try {
    emitProgress(socketId, events.progress, { percent: 0, slotId });

    const { type: sourceType, originalUrl } = detectUrlType(url_trimmed);
    let downloadUrl = originalUrl;

    // Convert platform-specific URLs to direct download URLs
    if (sourceType === 'gdrive') {
      downloadUrl = convertGdriveUrl(originalUrl);
      emitProgress(socketId, events.progress, { percent: 5, status: 'Converting Google Drive link...', slotId });
    } else if (sourceType === 'dropbox') {
      downloadUrl = convertDropboxUrl(originalUrl);
      emitProgress(socketId, events.progress, { percent: 5, status: 'Converting Dropbox link...', slotId });
    } else if (sourceType === 'youtube') {
      emitProgress(socketId, events.progress, { percent: 5, status: `Downloading YouTube ${mediaType}...`, slotId });
    }

    // Execute appropriate download method
    let downloaded;
    if (sourceType === 'youtube') {
      downloaded = await downloadYouTubeVideo(downloadUrl, outputPath, socketId, events.progress, slotId, mediaType);
    } else {
      // Google Drive, Dropbox, or direct URLs
      downloaded = await downloadHttpVideo(downloadUrl, outputPath, socketId, events.progress, slotId);
    }

    // Verify file exists and get duration
    if (!fs.existsSync(outputPath)) {
      throw new Error('Download completed but file not found');
    }

    emitProgress(socketId, events.progress, { percent: 90, status: `Probing ${mediaType} duration...`, slotId });
    // ffprobe's own error text names server folders - not passed on.
    const duration = await probeDuration(outputPath).catch(() => {
      throw new Error(`The link didn't lead to a ${mediaType} file that can be opened.`);
    });

    emitProgress(socketId, events.progress, { percent: 100, status: 'Complete', slotId });

    // Return file info
    res.json({
      filePath: outputPath,
      fileName: filename,
      duration,
      type: sourceType,
      // A readable name for the file (the YouTube title, or the name the
      // link's server gave it) - fileName stays the random id.
      title: cleanTitle(downloaded?.title),
    });
  } catch (err) {
    // Clean up partial file if it exists
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }

    const errorMessage = toUserMessage(err, 'That link could not be downloaded. Please check it and try again.');
    emitProgress(socketId, events.error, { error: errorMessage, slotId });

    res.status(400).json({ error: errorMessage });
  }
});

// GET /api/fetch-url-video/file/:name - hands a file fetched by the POST
// above back to the browser, so the Editor (which edits local files in the
// browser) can pull a pasted link straight into its media bin. Only the
// random 32-hex names this route itself creates are accepted, so it can never
// be pointed at anything else in uploads/ or outside it.
router.get('/file/:name', (req, res) => {
  const { name } = req.params;
  if (!/^[a-f0-9]{32}$/.test(name)) {
    res.status(404).json({ error: 'File not found.' });
    return;
  }
  const filePath = path.join(uploadsDir, name);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'That download has expired - fetch the link again.' });
    return;
  }
  res.type(req.query.kind === 'audio' ? 'audio/mpeg' : 'video/mp4');
  res.sendFile(filePath);
});

export default router;
