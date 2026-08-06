import './loadEnv.js';
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
import generateCaptionsRouter from './routes/generateCaptions.js';
import exportTimelineRouter from './routes/exportTimeline.js';
import { jobStore, deleteJob } from './services/jobStore.js';
import { initSocket, isOriginAllowed } from './socket.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = 3000;
const ALLOWED_ORIGINS = (process.env.CORS_ORIGIN || 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const isDev = process.env.NODE_ENV !== 'production';

const uploadsDir = path.join(__dirname, 'uploads');
const clipsDir = path.join(__dirname, 'clips');

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

if (!fs.existsSync(clipsDir)) {
  fs.mkdirSync(clipsDir, { recursive: true });
}

// We'll create the server inside startServer so each attempt uses a fresh server
// and we don't call listen more than once on the same Server instance.

app.use(cors({
  origin: (origin, callback) => {
    if (isDev || !origin || isOriginAllowed(origin, ALLOWED_ORIGINS)) {
      callback(null, true);
      return;
    }
    callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
}));
app.use(express.json());
app.use('/clips', express.static(clipsDir));

app.use('/api/convert', convertRouter);
app.use('/api/burn-subtitles', burnSubtitlesRouter);
app.use('/api/generate-captions', generateCaptionsRouter);
app.use('/api/extract-shorts', extractShortsRouter);
app.use('/api/reformat-short', reformatShortRouter);
app.use('/api/fetch-url-video', fetchUrlVideoRouter);
app.use('/api/fetch-url', fetchUrlVideoRouter);
app.use('/api/create-montage', createMontageRouter);
app.use('/api/editor/export', exportTimelineRouter);

app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    const isLargeUpload = req.originalUrl?.startsWith('/api/generate-captions') || req.originalUrl?.startsWith('/api/burn-subtitles');
    return res.status(413).json({ error: `File too large (max ${isLargeUpload ? '2 GB' : '500 MB'})` });
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
      let stats;
      try {
        stats = fs.statSync(filePath);
      } catch (_err) {
        // File vanished between readdir and stat (e.g. concurrent
        // cleanup). Skip it instead of crashing the whole server.
        return;
      }
      if (stats.isDirectory()) {
        return;
      }
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

function startServer(p, attempts = 0,hos ='0.0.0.0') {
  const serverInstance = http.createServer(app);
  const io = initSocket(serverInstance, ALLOWED_ORIGINS.join(','));
  app.set('io', io);

  // Large (up to 2GB) caption/video uploads on slow connections can take
  // longer than Node's default 5-minute request timeout; give them room.
  serverInstance.requestTimeout = 30 * 60 * 1000;
  serverInstance.headersTimeout = 31 * 60 * 1000;

  serverInstance.listen(p, hos)
    .once('listening', () => {
      console.log(`Video processing backend is listening on port ${p}`);
    })
    .once('error', (err) => {
      if (err && err.code === 'EADDRINUSE' && attempts < 5) {
        console.warn(`Port ${p} is in use, trying port ${p + 1}...`);
        try { serverInstance.close(); } catch (_e) {}
        setTimeout(() => startServer(p + 1, attempts + 1), 400);
        return;
      }
      console.error('Server failed to start:', err);
      process.exit(1);
    });
}

startServer(port);
