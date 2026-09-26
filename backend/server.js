import './loadEnv.js';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
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
import youtubeRouter from './routes/youtube.js';
import authRouter from './routes/auth.js';
import projectsRouter from './routes/projects.js';
import jobsRouter from './routes/jobs.js';
import billingMomoRouter from './routes/billingMomo.js';
import billingCardsRouter from './routes/billingCards.js';
import accountRouter from './routes/account.js';
import adminRouter from './routes/admin.js';
import analyticsRouter from './routes/analytics.js';
import adminAnalyticsRouter from './routes/adminAnalytics.js';
import editorCaptionsRouter from './routes/editorCaptions.js';
import { jobStore, deleteJob } from './services/jobStore.js';
import { initSocket, isOriginAllowed } from './socket.js';
import { connectDB } from './db.js';
import { ownerEmails } from './services/owners.js';
import { securityHeaders, configureProxyTrust, applyRateLimits } from './middleware/security.js';
import { createDiskGuard } from './middleware/diskGuard.js';
import { requestLogger } from './middleware/requestLog.js';
import { installCrashHandlers } from './services/crashHandlers.js';
import healthRouter from './routes/health.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
installCrashHandlers();
configureProxyTrust(app);
app.use(securityHeaders);
app.use(requestLogger());
// Hosting platforms (Render, Fly.io, etc.) assign the listen port via PORT
// and expect the app to bind exactly to it - only fall back to auto-picking
// a free port (see the EADDRINUSE retry in startServer) when PORT wasn't
// explicitly given, i.e. local dev.
const explicitPort = process.env.PORT ? Number(process.env.PORT) : null;
const port = explicitPort || 3000;
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
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
}));
app.use(cookieParser());
app.use(express.json());
applyRateLimits(app);
app.use(createDiskGuard());
app.use('/clips', express.static(clipsDir));

// Used by hosting platforms for restart/zero-downtime-deploy health checks.
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.use('/health/details', healthRouter);

app.use('/api/convert', convertRouter);
app.use('/api/burn-subtitles', burnSubtitlesRouter);
app.use('/api/generate-captions', generateCaptionsRouter);
app.use('/api/extract-shorts', extractShortsRouter);
app.use('/api/reformat-short', reformatShortRouter);
app.use('/api/fetch-url-video', fetchUrlVideoRouter);
app.use('/api/fetch-url', fetchUrlVideoRouter);
app.use('/api/create-montage', createMontageRouter);
app.use('/api/editor/export', exportTimelineRouter);
app.use('/api/editor/captions', editorCaptionsRouter);
app.use('/api/youtube', youtubeRouter);
app.use('/api/auth', authRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/jobs', jobsRouter);
app.use('/api/billing/momo', billingMomoRouter);
app.use('/api/billing/cards', billingCardsRouter);
app.use('/api/account', accountRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/admin/analytics', adminAnalyticsRouter);
app.use('/api/admin', adminRouter);

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

// Finished renders stay downloadable for a day by default: a long LongMix
// render can finish while the user is away, and deleting it an hour later
// (the old blanket limit) meant coming back to a Download button that led
// nowhere. Temporary uploads still go after an hour.
const CLIPS_RETENTION_MS = (Number(process.env.CLIPS_RETENTION_HOURS) > 0 ? Number(process.env.CLIPS_RETENTION_HOURS) : 24) * 60 * 60 * 1000;
const UPLOADS_RETENTION_MS = 60 * 60 * 1000;

setInterval(() => {
  const now = Date.now();

  [[clipsDir, CLIPS_RETENTION_MS], [uploadsDir, UPLOADS_RETENTION_MS]].forEach(([dir, retentionMs]) => {
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
      if (now - stats.mtime.getTime() > retentionMs) {
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
  connectDB();
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
      // Printed at startup so "why am I being charged free-tier limits?"
      // is answerable by looking at the terminal instead of guessing: if
      // this line is empty, OWNER_EMAILS never reached the process.
      const owners = ownerEmails();
      console.log(owners.length
        ? `Owner accounts (no free-tier limits): ${owners.join(', ')}`
        : 'No owner accounts configured - set OWNER_EMAILS in backend/.env to exempt your own account from free-tier limits.');
    })
    .once('error', (err) => {
      if (err && err.code === 'EADDRINUSE' && !explicitPort && attempts < 5) {
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
