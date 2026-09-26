import crypto from 'crypto';
import path from 'path';
import multer from 'multer';
import { UPLOADS_DIR } from '../storagePaths.js';

// Created by storagePaths.js (a temp-dir location on read-only hosts).
const uploadsDir = UPLOADS_DIR;

export const VIDEO_MIME = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo'];
// An explicit allow-list here kept rejecting real songs LongMix Studio users
// actually have - m4a alone shows up as audio/x-m4a, audio/mp4, audio/m4a or
// audio/x-m4-a depending on OS/browser, and that's before flac/opus/aiff.
// ffmpeg decodes far more containers than any short list would enumerate, so
// the fileFilter below now accepts anything the browser reports as audio/*
// and keeps this list only as a fallback for the rare client that sends a
// generic octet-stream mimetype for an audio file.
export const AUDIO_MIME = ['audio/mpeg', 'audio/wav', 'audio/aac', 'audio/ogg', 'audio/x-m4a', 'audio/mp4', 'audio/m4a', 'audio/flac', 'audio/x-flac', 'audio/opus', 'audio/webm', 'audio/x-wav', 'audio/vnd.wave', 'audio/aiff', 'audio/x-aiff'];
// Still images are first-class timeline media (a `type: 'image'` clip - see
// backend/services/filterGraph/clipKinds.js), so the editor export route has
// to accept them alongside video/audio. Deliberately no image/gif: an
// animated GIF would arrive here looking like a still but decode as a
// multi-frame stream, which the `-loop 1 -t` input flags an image clip gets
// would then fight with.
export const IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
export const SUBTITLE_MIME = ['text/plain', 'application/octet-stream'];

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (_req, _file, cb) => {
    const name = crypto.randomBytes(16).toString('hex');
    // Ensure the file object has consistent storage info for downstream handlers
    try {
      _file.destination = uploadsDir;
      _file.filename = name;
      _file.path = path.join(uploadsDir, name);
    } catch (e) {}
    cb(null, name);
  },
});

// `files` is a per-REQUEST cap, not a per-project one. A long-mix project (a
// whole folder of songs plus scene images, see
// frontend/src/timeline/longMix.js) posts one file per unique source in a
// single request, and a several-hours mix built from individually-uploaded
// (non-looped) songs can legitimately need many hundreds - raised well past
// that so a genuinely long mix never gets cut off here; it stays finite only
// to keep a malformed request from allocating unbounded disk handles.
function createUpload({ fileSize = 500 * 1024 * 1024, files = 2000 } = {}) {
  return multer({
    storage,
    limits: { fileSize, files },
    fileFilter(_req, file, cb) {
      // Audio containers are too varied for a fixed list to keep up with
      // (see the note on AUDIO_MIME) - any audio/* mimetype is accepted
      // outright, and the explicit list only backstops browsers that send
      // something generic like application/octet-stream for a real audio
      // file.
      if (file.mimetype?.startsWith('audio/')) {
        cb(null, true);
        return;
      }
      const allowed = [...VIDEO_MIME, ...AUDIO_MIME, ...IMAGE_MIME, ...SUBTITLE_MIME];
      if (!allowed.includes(file.mimetype)) {
        cb(new Error(`Unsupported file type: ${file.mimetype || 'unknown'}`));
        return;
      }
      cb(null, true);
    },
  });
}

const upload = createUpload();

// Caption generation accepts larger source videos, but still streams them to
// disk so the Node process never holds the full upload in memory.
export const captionUpload = createUpload({ fileSize: 2 * 1024 * 1024 * 1024, files: 1 });

// Burning a user-supplied subtitle file onto a video uploads two files (video +
// subtitle) but should honor the same large-video limit the UI advertises.
export const captionBurnUpload = createUpload({ fileSize: 2 * 1024 * 1024 * 1024, files: 2 });

export default upload;
