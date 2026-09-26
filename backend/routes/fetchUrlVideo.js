import express from 'express';
import fs from 'fs';
import path from 'path';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import crypto from 'crypto';
import ytdl from '@distube/ytdl-core';
import { probeDuration } from '../services/ffmpeg.js';
import { getIo } from '../socket.js';
import { UPLOADS_DIR } from '../storagePaths.js';

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
 * Download video from YouTube using @distube/ytdl-core - a pure-JS
 * extractor (no external binary). The original implementation shelled out
 * to the `yt-dlp` CLI, which needs installing system-wide and, like
 * whisper.cpp's local binary, is exactly the kind of unsigned executable
 * Windows Smart App Control blocks with no reliable per-app exception -
 * running entirely inside the already-trusted Node process sidesteps that
 * whole problem.
 */
async function downloadYouTubeVideo(url, outputPath, socketId, progressEvent, slotId, mediaType) {
  if (!ytdl.validateURL(url)) {
    throw new Error('That doesn\'t look like a valid YouTube video URL.');
  }

  const requestOptions = {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    },
  };
  const info = await ytdl.getInfo(url, { requestOptions });
  const format = mediaType === 'audio'
    ? ytdl.chooseFormat(info.formats, { filter: 'audioonly', quality: 'highestaudio' })
    : ytdl.chooseFormat(info.formats, { filter: 'videoandaudio', quality: 'highest' });
  if (!format) {
    throw new Error(`This YouTube video has no downloadable ${mediaType === 'audio' ? 'audio-only' : 'combined video+audio'} format available.`);
  }

  await new Promise((resolve, reject) => {
    const stream = ytdl.downloadFromInfo(info, { format, requestOptions });
    const writeStream = createWriteStream(outputPath);

    stream.on('progress', (_chunkLength, downloaded, total) => {
      if (total > 0) emitProgress(socketId, progressEvent, { percent: Math.round((downloaded / total) * 100), slotId });
    });
    stream.on('error', (err) => reject(new Error(`YouTube download failed: ${err.message}`)));
    writeStream.on('error', reject);
    writeStream.on('finish', resolve);

    stream.pipe(writeStream);
  });
}

/**
 * Download video from HTTP/HTTPS URL using native fetch with progress tracking
 */
async function downloadHttpVideo(url, outputPath, socketId, progressEvent, slotId) {
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    if (!response.ok) {
      if (response.status === 403 || response.status === 401) {
        throw new Error('Access denied. The URL may be private or require authentication.');
      }
      if (response.status === 404) {
        throw new Error('URL not found (404). Please check the link.');
      }
      throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
    }

    const totalLength = response.headers.get('content-length');
    let downloadedLength = 0;

    if (!response.body) {
      throw new Error('No response body received');
    }

    const writeStream = createWriteStream(outputPath);
    
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      downloadedLength += value.length;
      writeStream.write(value);
      
      if (totalLength) {
        const percent = (downloadedLength / parseInt(totalLength)) * 100;
        emitProgress(socketId, progressEvent, { percent: Math.round(percent), slotId });
      }
    }

    writeStream.end();
  } catch (err) {
    if (err.message.includes('Access denied') || err.message.includes('not found')) {
      throw err;
    }
    if (err.cause?.code === 'ENOTFOUND') {
      throw new Error('Invalid domain or network error.');
    }
    throw new Error(`Failed to download video: ${err.message}`);
  }
}

/**
 * Main POST route handler
 */
router.post('/', async (req, res) => {
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
    if (sourceType === 'youtube') {
      await downloadYouTubeVideo(downloadUrl, outputPath, socketId, events.progress, slotId, mediaType);
    } else {
      // Google Drive, Dropbox, or direct URLs
      await downloadHttpVideo(downloadUrl, outputPath, socketId, events.progress, slotId);
    }

    // Verify file exists and get duration
    if (!fs.existsSync(outputPath)) {
      throw new Error('Download completed but file not found');
    }

    emitProgress(socketId, events.progress, { percent: 90, status: `Probing ${mediaType} duration...`, slotId });
    const duration = await probeDuration(outputPath);

    emitProgress(socketId, events.progress, { percent: 100, status: 'Complete', slotId });

    // Return file info
    res.json({
      filePath: outputPath,
      fileName: filename,
      duration,
      type: sourceType,
    });
  } catch (err) {
    // Clean up partial file if it exists
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }

    const errorMessage = err.message || 'Unknown error occurred';
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
