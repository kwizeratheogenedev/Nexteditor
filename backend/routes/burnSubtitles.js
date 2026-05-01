import express from 'express';
import fs from 'fs';
import path from 'path';
import upload from '../middleware/upload.js';
import { probeDuration, runFFmpeg } from '../services/ffmpeg.js';
import { deleteJob, registerJob, resolveJob } from '../services/jobStore.js';
import { getIo } from '../socket.js';

const router = express.Router();
const clipsDir = path.resolve(process.cwd(), 'clips');

function emitToClient(req, eventName, payload) {
  const io = getIo();
  const socketId = req.headers['x-socket-id'];
  const clientSocket = socketId ? io?.sockets.sockets.get(socketId) : null;
  if (clientSocket) {
    clientSocket.emit(eventName, payload);
  }
}

router.post(
  '/',
  upload.fields([
    { name: 'video', maxCount: 1 },
    { name: 'subtitle', maxCount: 1 },
  ]),
  async (req, res) => {
    const tempFiles = [];
    const outputFiles = [];

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
      const subtitleFilter = `subtitles='${escapedSubPath}'`;

      await runFFmpeg(
        [
          '-i',
          videoPath,
          '-vf',
          subtitleFilter,
          '-c:a',
          'copy',
          outputPath,
        ],
        {
          duration: videoDuration,
          onProgress: (progress) => {
            emitToClient(req, 'ffmpeg-progress', progress);
          },
        },
      );

      emitToClient(req, 'ffmpeg-complete', { taskId, status: 'success', outputPath: path.basename(outputPath) });
      res.download(outputPath, 'subtitled_video.mp4', () => {
        for (const filePath of outputFiles) {
          fs.rm(filePath, { force: true }, () => {});
        }
      });
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
  },
);

export default router;
