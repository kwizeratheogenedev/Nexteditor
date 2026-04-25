import express from 'express';
import fs from 'fs';
import path from 'path';
import { probeDuration, runFFmpeg } from '../services/ffmpeg.js';
import { deleteJob, registerJob, resolveJob } from '../services/jobStore.js';
import { getIo } from '../socket.js';

const router = express.Router();
const clipsDir = path.resolve(process.cwd(), 'clips');
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';

function emitToClient(req, eventName, payload) {
  const io = getIo();
  const socketId = req.headers['x-socket-id'];
  const clientSocket = socketId ? io?.sockets.sockets.get(socketId) : null;
  if (clientSocket) {
    clientSocket.emit(eventName, payload);
  }
}

router.post('/', async (req, res) => {
  const tempFiles = [];
  const outputFiles = [];

  try {
    const { jobId, startTime, duration, formatStrategy, id, aspectRatio } = req.body;

    if (!jobId || startTime == null || duration == null || !formatStrategy || !id) {
      res.status(400).json({ error: 'Missing arguments for re-formatting.' });
      return;
    }

    const originalVideo = resolveJob(jobId);
    if (!originalVideo) {
      res.status(400).json({ error: 'Unknown or expired job' });
      return;
    }

    const taskId = `reformat-short-${Date.now()}`;
    const newId = `${id}_edit_${Date.now()}`;
    const outputPath = path.join(clipsDir, `${newId}.mp4`);
    outputFiles.push(outputPath);

    const vFilters = formatStrategy === 'crop'
      ? aspectRatio === '16:9'
        ? ['scale=1920:-1', 'crop=1920:1080']
        : ['scale=-1:1920', 'crop=1080:1920']
      : aspectRatio === '16:9'
        ? [
            'scale=1920:1080:force_original_aspect_ratio=decrease',
            'pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black',
          ]
        : [
            'scale=1080:1920:force_original_aspect_ratio=decrease',
            'pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black',
          ];

    await runFFmpeg(
      [
        '-ss',
        String(startTime),
        '-i',
        originalVideo,
        '-t',
        String(duration),
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
        duration: Number(duration),
        onProgress: (progress) => {
          emitToClient(req, 'ffmpeg-progress', progress);
        },
      },
    );

    res.json({
      id: newId,
      url: `${BACKEND_URL}/clips/${newId}.mp4`,
      formatStrategy,
      aspectRatio,
      startTime,
      duration,
      jobId,
    });
    emitToClient(req, 'ffmpeg-complete', { taskId, status: 'success', outputPath: path.basename(outputPath) });
  } catch (err) {
    console.error(err);
    for (const filePath of outputFiles) {
      fs.rm(filePath, { force: true }, () => {});
    }
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  } finally {
    for (const filePath of tempFiles) {
      fs.rm(filePath, { force: true }, () => {});
    }
  }
});

export default router;
