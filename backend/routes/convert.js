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

function clipArgs(inputFile, startTime, outputFile) {
  return [
    '-ss',
    String(startTime),
    '-i',
    inputFile,
    '-t',
    '3',
    '-vf',
    'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30',
    '-an',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    outputFile,
  ];
}

router.post(
  '/',
  upload.fields([
    { name: 'video1', maxCount: 1 },
    { name: 'video2', maxCount: 1 },
    { name: 'video3', maxCount: 1 },
    { name: 'audio', maxCount: 1 },
  ]),
  async (req, res) => {
    const tempFiles = [];
    const outputFiles = [];

    try {
      const files = req.files;
      if (!files || !files.video1 || !files.video2 || !files.video3 || !files.audio) {
        res.status(400).json({ error: 'Missing files. Please upload 3 videos and 1 audio.' });
        return;
      }

      const v1 = files.video1[0].path;
      const v2 = files.video2[0].path;
      const v3 = files.video3[0].path;
      const audio = files.audio[0].path;

      tempFiles.push(v1, v2, v3, audio);

      const taskId = `convert-${Date.now()}`;
      const audioDuration = await probeDuration(audio);
      const vDurations = await Promise.all([probeDuration(v1), probeDuration(v2), probeDuration(v3)]);
      const vPaths = [v1, v2, v3];
      const numClips = Math.ceil(audioDuration / 3);
      const clipPaths = [];
      const sessionId = Date.now();

      for (let i = 0; i < numClips; i += 1) {
        const vIndex = i % 3;
        const duration = vDurations[vIndex];
        const startTime = duration > 3 ? Math.random() * (duration - 3) : 0;
        const clipPath = path.join(clipsDir, `clip_${sessionId}_${i}.mp4`);
        outputFiles.push(clipPath);

        await runFFmpeg(clipArgs(vPaths[vIndex], startTime, clipPath), {
          duration: 3,
          onProgress: (progress) => {
            emitToClient(req, 'ffmpeg-progress', progress);
          },
        });

        emitToClient(req, 'ffmpeg-complete', { taskId: `${taskId}-subclip-${path.basename(clipPath)}`, status: 'success' });
        clipPaths.push(`file '${clipPath.replace(/\\/g, '/')}'`);
      }

      const concatTxtPath = path.join(clipsDir, `concat_${sessionId}.txt`);
      const outputPath = path.join(clipsDir, `final_${sessionId}.mp4`);
      outputFiles.push(concatTxtPath, outputPath);
      fs.writeFileSync(concatTxtPath, clipPaths.join('\n'));

      await runFFmpeg(
        [
          '-f',
          'concat',
          '-safe',
          '0',
          '-i',
          concatTxtPath,
          '-i',
          audio,
          '-c:a',
          'aac',
          '-t',
          String(audioDuration),
          '-c:v',
          'copy',
          outputPath,
        ],
        {
          duration: audioDuration,
          onProgress: (progress) => {
            emitToClient(req, 'ffmpeg-progress', progress);
          },
        },
      );

      emitToClient(req, 'ffmpeg-complete', { taskId, status: 'success', outputPath: `final_${sessionId}.mp4` });
      res.download(outputPath, 'final_video.mp4', () => {
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
