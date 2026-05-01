import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';
import convertRouter from './routes/convert.js';
import burnSubtitlesRouter from './routes/burnSubtitles.js';
import extractShortsRouter from './routes/extractShorts.js';
import reformatShortRouter from './routes/reformatShort.js';
import createMontageRouter from './routes/createMontage.js';
import fetchUrlVideoRouter from './routes/fetchUrlVideo.js';
import { jobStore, deleteJob } from './services/jobStore.js';
import { initSocket } from './socket.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = 3000;
const ALLOWED_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';

const uploadsDir = path.join(__dirname, 'uploads');
const clipsDir = path.join(__dirname, 'clips');

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

if (!fs.existsSync(clipsDir)) {
  fs.mkdirSync(clipsDir, { recursive: true });
}

const server = http.createServer(app);
const io = initSocket(server, ALLOWED_ORIGIN);
app.set('io', io);

app.use(cors({ origin: ALLOWED_ORIGIN, credentials: true }));
app.use(express.json());
app.use('/clips', express.static(clipsDir));

app.use('/api/convert', convertRouter);
app.use('/api/burn-subtitles', burnSubtitlesRouter);
app.use('/api/extract-shorts', extractShortsRouter);
app.use('/api/reformat-short', reformatShortRouter);
app.use('/api/fetch-url-video', fetchUrlVideoRouter);
app.use('/api/fetch-url', fetchUrlVideoRouter);
app.use('/api/create-montage', createMontageRouter);

app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File too large (max 500 MB)' });
  }
  if (err.code === 'LIMIT_FILE_COUNT') {
    return res.status(400).json({ error: 'Too many files' });
  }
  if (err instanceof Error && !res.headersSent) {
    return res.status(400).json({ error: err.message });
  }
  return next(err);
});

setInterval(() => {
  const now = Date.now();

  [clipsDir, uploadsDir].forEach((dir) => {
    if (!fs.existsSync(dir)) {
      return;
    }

    fs.readdirSync(dir).forEach((file) => {
      const filePath = path.join(dir, file);
      const stats = fs.statSync(filePath);
      if (now - stats.mtime.getTime() > 60 * 60 * 1000) {
        try {
          fs.unlinkSync(filePath);
        } catch (_err) {}
      }
    });
  });

  for (const [jobId, entry] of jobStore.entries()) {
    if (now - entry.createdAt > 60 * 60 * 1000) {
      deleteJob(jobId);
    }
  }
}, 15 * 60 * 1000);

server.listen(port, () => {
  console.log(`Video processing backend is listening on port ${port}`);
});
