import express from 'express';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import upload from '../middleware/upload.js';
import { probeDuration, runFFmpeg } from '../services/ffmpeg.js';
import { getFileSource } from '../services/fileResolve.js';
import { downloadErrorMessage, downloadToFile } from '../services/safeDownload.js';
import { getIo } from '../socket.js';
import { CLIPS_DIR, UPLOADS_DIR } from '../storagePaths.js';
import { toUserMessage } from '../services/userMessage.js';

const router = express.Router();
const clipsDir = CLIPS_DIR;

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

// Public addresses only, size-capped - see services/safeDownload.js.
async function downloadRemoteVideo(url, outputPath) {
  try {
    await downloadToFile(url, outputPath);
  } catch (err) {
    throw new Error(`One of the video links failed: ${downloadErrorMessage(err)}`);
  }
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
      const files = req.files || {};
      const sourceMode = req.body.videoSourceMode;
      
      // Handle different source modes: 'upload', 'link', 'path'
      let videoPaths = [];
      let audioPath = '';
      // Random, so files waiting in the public clips folder can't be guessed.
      const sessionId = randomUUID();

      if (sourceMode === 'path') {
        // Use file paths directly from URL fetches (YouTube, Drive, etc.)
        const video1Path = req.body.video1Path;
        const video2Path = req.body.video2Path;
        const video3Path = req.body.video3Path;
        const audioPathVal = req.body.audioPath;

        if (!video1Path || !video2Path || !video3Path || !audioPathVal) {
          res.status(400).json({ error: 'Missing file paths for videos or audio.' });
          return;
        }

        // Only files the link fetcher (uploads/) or an earlier job (clips/)
        // put on this server - never any other path on disk.
        const resolved = [];
        for (const [label, candidate] of [['Video 1', video1Path], ['Video 2', video2Path], ['Video 3', video3Path], ['Audio', audioPathVal]]) {
          let sourcePath = null;
          try {
            sourcePath = getFileSource(null, candidate, [UPLOADS_DIR, CLIPS_DIR]);
          } catch {
            sourcePath = null;
          }
          if (!sourcePath || !fs.existsSync(sourcePath)) {
            res.status(400).json({ error: `${label}: that file is no longer on the server - fetch the link again.` });
            return;
          }
          resolved.push(sourcePath);
        }

        videoPaths = resolved.slice(0, 3);
        audioPath = resolved[3];
        
        emitToClient(req, 'ffmpeg-progress', { percent: 5, currentTime: 'Files verified...' });
      } else if (sourceMode === 'link') {
        // Download from URLs
        const videoLinks = [
          req.body.video1Link?.trim(),
          req.body.video2Link?.trim(),
          req.body.video3Link?.trim(),
        ];

        if (videoLinks.some((link) => !link)) {
          res.status(400).json({ error: 'Please provide links for Video Tracks 1, 2, and 3.' });
          return;
        }

        if (!files?.audio?.[0]?.path) {
          res.status(400).json({ error: 'Please upload an audio track.' });
          return;
        }

        audioPath = files.audio[0].path;
        tempFiles.push(audioPath);

        for (const [index, link] of videoLinks.entries()) {
          const outputPath = path.join(clipsDir, `linked_video_${sessionId}_${index + 1}.mp4`);
          tempFiles.push(outputPath);
          await downloadRemoteVideo(link, outputPath);
          videoPaths.push(outputPath);
        }
        
        emitToClient(req, 'ffmpeg-progress', { percent: 5, currentTime: 'Videos downloaded...' });
      } else {
        // Default: upload mode
        if (!files?.video1?.[0]?.path || !files?.video2?.[0]?.path || !files?.video3?.[0]?.path) {
          res.status(400).json({ error: 'Please upload Video Tracks 1, 2, and 3.' });
          return;
        }

        if (!files?.audio?.[0]?.path) {
          res.status(400).json({ error: 'Please upload an audio track.' });
          return;
        }

        videoPaths = [
          files.video1[0].path,
          files.video2[0].path,
          files.video3[0].path,
        ];
        audioPath = files.audio[0].path;
        tempFiles.push(...videoPaths, audioPath);
        
        emitToClient(req, 'ffmpeg-progress', { percent: 5, currentTime: 'Files ready...' });
      }

      // Get durations
      const audioDuration = await probeDuration(audioPath);
      const vDurations = await Promise.all(videoPaths.map((videoPath) => probeDuration(videoPath)));
      
      emitToClient(req, 'ffmpeg-progress', { percent: 10, currentTime: 'Analyzing videos...' });

      const numClips = Math.ceil(audioDuration / 3);
      const clipPaths = [];

      // Create clips from videos
      for (let i = 0; i < numClips; i += 1) {
        const vIndex = i % 3;
        const duration = vDurations[vIndex];
        const startTime = duration > 3 ? Math.random() * (duration - 3) : 0;
        const clipPath = path.join(clipsDir, `clip_${sessionId}_${i}.mp4`);
        outputFiles.push(clipPath);

        await runFFmpeg(clipArgs(videoPaths[vIndex], startTime, clipPath), {
          duration: 3,
          onProgress: (progress) => {
            // Scale progress: 10-40% for clip creation
            const scaledPercent = Math.min(40, 10 + (i / numClips) * 30 + ((progress.percent / numClips) * 30) / 100);
            emitToClient(req, 'ffmpeg-progress', { 
              percent: Math.round(scaledPercent), 
              currentTime: `Creating clip ${i + 1}/${numClips}...` 
            });
          },
        });

        clipPaths.push(`file '${clipPath.replace(/\\/g, '/')}'`);
      }

      // Create concat file
      const concatTxtPath = path.join(clipsDir, `concat_${sessionId}.txt`);
      const outputPath = path.join(clipsDir, `final_${sessionId}.mp4`);
      outputFiles.push(concatTxtPath, outputPath);
      fs.writeFileSync(concatTxtPath, clipPaths.join('\n'));

      emitToClient(req, 'ffmpeg-progress', { percent: 45, currentTime: 'Merging videos...' });

      // Merge videos and add audio
      // Note: Using re-encoding because videos may have different codecs
      await runFFmpeg(
        [
          '-f',
          'concat',
          '-safe',
          '0',
          '-i',
          concatTxtPath,
          '-i',
          audioPath,
          '-t',
          String(audioDuration),
          '-c:v',
          'libx264',
          '-preset',
          'fast',
          '-crf',
          '23',
          '-c:a',
          'aac',
          '-b:a',
          '192k',
          '-shortest',
          outputPath,
        ],
        {
          duration: audioDuration,
          onProgress: (progress) => {
            // Scale progress: 45-90% for merge
            const scaledPercent = Math.min(90, 45 + (progress.percent * 0.45));
            emitToClient(req, 'ffmpeg-progress', { 
              percent: Math.round(scaledPercent), 
              currentTime: progress.currentTime || 'Merging...' 
            });
          },
        },
      );

      emitToClient(req, 'ffmpeg-progress', { percent: 95, currentTime: 'Finalizing...' });
      emitToClient(req, 'ffmpeg-complete', { taskId: `convert-${sessionId}`, status: 'success', outputPath: path.basename(outputPath) });

      // Send the file
      res.download(outputPath, 'montage_video.mp4', (err) => {
        if (err) {
          console.error('Download error:', err);
        }
        // Cleanup files
        for (const filePath of [...outputFiles, ...tempFiles]) {
          fs.rm(filePath, { force: true }, () => {});
        }
      });
    } catch (err) {
      console.error('Montage error:', err);
      emitToClient(req, 'ffmpeg-progress', { percent: 0, currentTime: '' });
      emitToClient(req, 'ffmpeg-complete', { taskId: `convert-${Date.now()}`, status: 'error', error: toUserMessage(err, 'The videos could not be merged. Please try again.') });
      
      for (const filePath of [...outputFiles, ...tempFiles]) {
        fs.rm(filePath, { force: true }, () => {});
      }
      
      if (!res.headersSent) {
        res.status(500).json({ error: toUserMessage(err, 'The videos could not be merged. Please try again.') });
      }
    }
  },
);

export default router;
