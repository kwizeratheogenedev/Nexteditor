import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsDir = path.resolve(__dirname, '../uploads');

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

export const VIDEO_MIME = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo'];
export const AUDIO_MIME = ['audio/mpeg', 'audio/wav', 'audio/aac', 'audio/ogg'];
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

function createUpload({ fileSize = 500 * 1024 * 1024, files = 6 } = {}) {
  return multer({
    storage,
    limits: { fileSize, files },
    fileFilter(_req, file, cb) {
      const allowed = [...VIDEO_MIME, ...AUDIO_MIME, ...SUBTITLE_MIME];
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

export default upload;
