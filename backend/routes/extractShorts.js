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

function pickShortClipDuration(maxDuration, sourceDuration) {
  const boundedMax = Math.min(maxDuration, sourceDuration);
  const minimumPreferred = Math.min(30, boundedMax);

  if (boundedMax <= minimumPreferred) {
    return boundedMax;
  }

  const tierMinimum = boundedMax <= 60
    ? 30
    : boundedMax <= 120
      ? 60
      : 120;

  const lowerBound = Math.min(tierMinimum, boundedMax);
  return lowerBound + Math.random() * (boundedMax - lowerBound);
}

function emitToClient(req, eventName, payload) {
  const io = getIo();
  const socketId = req.headers['x-socket-id'];
  const clientSocket = socketId ? io?.sockets.sockets.get(socketId) : null;
  if (clientSocket) {
    clientSocket.emit(eventName, payload);
  }
}

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
          'scale=1920:1080:force_original_aspect_ratio=decrease',
          'pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black',
        ]
      : [
          'scale=1080:1920:force_original_aspect_ratio=decrease',
          'pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black',
        ];

    const results = [];

    await Promise.all(
      Array.from({ length: 3 }, async (_value, index) => {
        const clipDur = pickShortClipDuration(maxDuration, sourceDuration);
        const maxStart = Math.max(0, sourceDuration - clipDur);
        const startTime = Math.random() * maxStart;
        const outputPath = path.join(clipsDir, `short_${sessionId}_${index}.mp4`);
        outputFiles.push(outputPath);

        await runFFmpeg(
          [
            '-ss',
            String(startTime),
            '-i',
            managedSourcePath,
            '-t',
            String(clipDur),
            '-vf',
            vFilters.join(','),
            '-c:v',
            'libx264',
            '-preset',
            'veryfast',
            '-crf',
            '23',
            '-c:a',
            'aac',
            outputPath,
          ],
          {
            duration: clipDur,
            onProgress: (progress) => {
              emitToClient(req, 'ffmpeg-progress', progress);
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
