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
    cb(null, crypto.randomBytes(16).toString('hex'));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024, files: 6 },
  fileFilter(_req, file, cb) {
    const allowed = [...VIDEO_MIME, ...AUDIO_MIME, ...SUBTITLE_MIME];
    cb(null, allowed.includes(file.mimetype));
  },
});

export default upload;
