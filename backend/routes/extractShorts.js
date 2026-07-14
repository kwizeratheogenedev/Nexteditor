import express from 'express';
import fs from 'fs';
import path from 'path';
import upload from '../middleware/upload.js';
import { probeDuration, runFFmpeg } from '../services/ffmpeg.js';
import { deleteJob, registerJob, resolveJob } from '../services/jobStore.js';
import { getIo } from '../socket.js';

const router = express.Router();
const clipsDir = path.resolve(process.cwd(), 'clips');
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';
const progressByJob = new Map();

function createClipPlan(maxDuration, sourceDuration) {
  const clipCount = Math.min(3, Math.max(1, Math.floor(sourceDuration / 10)));
  const availablePerClip = sourceDuration / clipCount;
  const clipDuration = Math.min(maxDuration, Math.max(10, availablePerClip * 0.82));
  return Array.from({ length: clipCount }, (_, index) => {
    const sectionStart = index * availablePerClip;
    const centeredStart = sectionStart + Math.max(0, (availablePerClip - clipDuration) / 2);
    return { index, startTime: Math.min(centeredStart, Math.max(0, sourceDuration - clipDuration)), duration: Math.min(clipDuration, sourceDuration) };
  });
}

function emitToClient(req, eventName, payload) {
  const io = getIo();
  const socketId = req.headers['x-socket-id'];
  const clientSocket = socketId ? io?.sockets.sockets.get(socketId) : null;
  if (clientSocket) {
    clientSocket.emit(eventName, payload);
  }
}

function emitProgress(req, percent, currentTime) {
  const payload = { percent: Math.round(percent), currentTime };
  const jobId = req.headers['x-job-id'];
  if (jobId) progressByJob.set(jobId, { ...payload, updatedAt: Date.now() });
  emitToClient(req, 'ffmpeg-progress', payload);
}

router.get('/progress/:jobId', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(progressByJob.get(req.params.jobId) || { percent: 0, currentTime: 'Waiting for upload...' });
});

router.post('/', upload.single('video'), async (req, res) => {
  const tempFiles = [];
  const outputFiles = [];
  let sourceJobId = null;
  let shouldKeepOutputs = false;

  try {
    if (!req.file) {
      res.status(400).json({ error: 'Missing video file.' });
      return;
    }

    const videoPath = req.file.path;
    tempFiles.push(videoPath);

    const durationSetting = req.body.duration || '60';
    const maxDuration = Number.parseInt(durationSetting, 10);
    const aspectRatio = req.body.aspectRatio || '9:16';
    const mainTaskId = `extract-shorts-${Date.now()}`;
    emitProgress(req, 12, 'Analyzing source video...');

    if (!Number.isFinite(maxDuration) || maxDuration <= 0) {
      res.status(400).json({ error: 'Invalid shorts duration.' });
      return;
    }

    const sourceDuration = await probeDuration(videoPath);
    if (sourceDuration < 10) {
      res.status(400).json({ error: 'Video is too short for shorts extraction.' });
      return;
    }

    const sessionId = Date.now();
    const managedSourcePath = path.join(clipsDir, `source_${sessionId}${path.extname(req.file.originalname) || '.mp4'}`);
    await fs.promises.copyFile(videoPath, managedSourcePath);
    outputFiles.push(managedSourcePath);
    sourceJobId = registerJob(path.resolve(managedSourcePath));

    const vFilters = aspectRatio === '16:9'
      ? [
          'scale=1280:720:force_original_aspect_ratio=increase',
          'crop=1280:720',
        ]
      : [
          'scale=720:1280:force_original_aspect_ratio=increase',
          'crop=720:1280',
        ];

    const results = [];
    const clipPlan = createClipPlan(maxDuration, sourceDuration);
    const clipProgress = new Array(clipPlan.length).fill(0);
    emitProgress(req, 18, `Creating ${clipPlan.length} shorts...`);

    await Promise.all(
      clipPlan.map(async ({ index, startTime, duration: clipDur }) => {
        const outputPath = path.join(clipsDir, `short_${sessionId}_${index}.mp4`);
        outputFiles.push(outputPath);

        await runFFmpeg(
          [
            '-hide_banner',
            '-y',
            '-ss',
            String(startTime),
            '-i',
            managedSourcePath,
            '-t',
            String(clipDur),
            '-vf',
            vFilters.join(','),
            '-map',
            '0:v:0',
            '-map',
            '0:a?',
            '-sn',
            '-dn',
            '-c:v',
            'libx264',
            '-preset',
            process.env.SHORTS_ENCODE_PRESET || 'veryfast',
            '-crf',
            process.env.SHORTS_CRF || '22',
            '-pix_fmt',
            'yuv420p',
            '-c:a',
            'aac',
            '-b:a',
            '128k',
            '-movflags',
            '+faststart',
            outputPath,
          ],
          {
            duration: clipDur,
            onProgress: (progress) => {
              clipProgress[index] = progress.percent;
              const average = clipProgress.reduce((sum, value) => sum + value, 0) / clipProgress.length;
              emitProgress(req, 18 + average * 0.79, `Rendering short ${index + 1} of ${clipPlan.length}...`);
            },
          },
        );

        emitToClient(req, 'ffmpeg-complete', { taskId: `${mainTaskId}-short-${index}`, status: 'success', outputPath: path.basename(outputPath) });
        results[index] = {
          id: `short_${sessionId}_${index}`,
          url: `${BACKEND_URL}/clips/short_${sessionId}_${index}.mp4`,
          formatStrategy: 'letterbox',
          aspectRatio,
          startTime,
          duration: clipDur,
          jobId: sourceJobId,
        };
      }),
    );

    shouldKeepOutputs = true;
    emitProgress(req, 100, `${results.length} shorts ready`);
    if (req.headers['x-job-id']) setTimeout(() => progressByJob.delete(req.headers['x-job-id']), 15 * 60 * 1000);
    res.json({ shorts: results });
  } catch (err) {
    console.error(err);
    for (const filePath of outputFiles) {
      fs.rm(filePath, { force: true }, () => {});
    }
    if (sourceJobId) {
      deleteJob(sourceJobId);
    }
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
    emitProgress(req, 0, 'Shorts generation failed');
  } finally {
    for (const filePath of tempFiles) {
      fs.rm(filePath, { force: true }, () => {});
    }
    if (!shouldKeepOutputs) {
      for (const filePath of outputFiles) {
        fs.rm(filePath, { force: true }, () => {});
      }
    }
  }
});

export default router;
