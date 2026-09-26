import express from 'express';
import fs from 'fs';
import path from 'path';
import { captionBurnUpload } from '../middleware/upload.js';
import { probeDuration, runFFmpeg } from '../services/ffmpeg.js';
import { getIo } from '../socket.js';
import { CLIPS_DIR } from '../storagePaths.js';

const router = express.Router();
const clipsDir = CLIPS_DIR;
const progressByJob = new Map();

function emitToClient(req, eventName, payload) {
  const io = getIo();
  const socketId = req.headers['x-socket-id'];
  const clientSocket = socketId ? io?.sockets.sockets.get(socketId) : null;
  if (clientSocket) {
    clientSocket.emit(eventName, payload);
  }
}

function emitProgress(req, payload) {
  const jobId = req.headers['x-job-id'];
  if (jobId) progressByJob.set(jobId, { ...payload, updatedAt: Date.now() });
  emitToClient(req, 'ffmpeg-progress', payload);
}

router.get('/progress/:jobId', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(progressByJob.get(req.params.jobId) || { percent: 0, currentTime: 'Waiting for upload...' });
});

function captionStyle(position) {
  // Keep this mapping identical to automatic caption rendering.
  const alignments = { top: 5, center: 8, bottom: 2, 'bottom-left': 1, 'bottom-right': 3 };
  const alignment = alignments[position] || 2;
  const marginV = position === 'top' ? 42 : position === 'center' ? 0 : 42;
  return `Alignment=${alignment},MarginV=${marginV},MarginL=36,MarginR=36`;
}

function captionedFileName(originalName) {
  const base = path.parse(originalName || 'video').name.replace(/[^a-zA-Z0-9 _.-]/g, '').trim() || 'video';
  return `${base}-captioned.mp4`;
}

router.post(
  '/',
  captionBurnUpload.fields([
    { name: 'video', maxCount: 1 },
    { name: 'subtitle', maxCount: 1 },
  ]),
  async (req, res) => {
    const tempFiles = [];
    const outputFiles = [];
    const jobId = req.headers['x-job-id'];

    try {
      const files = req.files;
      if (!files?.video || !files?.subtitle) {
        res.status(400).json({ error: 'Missing files. Please upload a video and a subtitle file.' });
        return;
      }

      const videoPath = files.video[0].path;
      const subPath = files.subtitle[0].path;
      tempFiles.push(videoPath, subPath);

      const outputPath = path.join(clipsDir, `subtitled_${Date.now()}.mp4`);
      outputFiles.push(outputPath);
      const taskId = `burn-subtitles-${Date.now()}`;
      const videoDuration = await probeDuration(videoPath);
      
      // Properly escape subtitle path for ffmpeg filter
      // FFmpeg requires escaping of special characters in filter strings
      const escapedSubPath = subPath.replace(/\\/g, '/').replace(/'/g, "\\'").replace(/:/g, '\\:');
      const subtitleFilter = `subtitles='${escapedSubPath}':force_style='${captionStyle(req.body.captionPosition)}'`;

      await runFFmpeg(
        [
          '-hide_banner',
          '-y',
          '-i',
          videoPath,
          '-vf',
          subtitleFilter,
          '-c:v',
          'libx264',
          '-preset',
          process.env.CAPTION_ENCODE_PRESET || 'veryfast',
          '-crf',
          process.env.CAPTION_CRF || '20',
          '-c:a',
          'copy',
          '-movflags',
          '+faststart',
          outputPath,
        ],
        {
          duration: videoDuration,
          onProgress: (progress) => {
            emitProgress(req, progress);
          },
        },
      );

      emitProgress(req, { percent: 100, currentTime: 'Captioned video ready' });
      emitToClient(req, 'ffmpeg-complete', { taskId, status: 'success', outputPath: path.basename(outputPath) });
      res.download(outputPath, captionedFileName(files.video[0].originalname), () => {
        for (const filePath of outputFiles) {
          fs.rm(filePath, { force: true }, () => {});
        }
      });
    } catch (err) {
      console.error(err);
      emitProgress(req, { percent: 0, currentTime: 'Caption burn failed' });
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
      if (jobId) setTimeout(() => progressByJob.delete(jobId), 15 * 60 * 1000);
    }
  },
);

export default router;
