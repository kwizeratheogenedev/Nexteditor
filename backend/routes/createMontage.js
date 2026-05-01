import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { runFFmpeg, probeDuration } from '../services/ffmpeg.js';
import { getIo } from '../socket.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();
const uploadsDir = path.resolve(process.cwd(), 'uploads');
const clipsDir = path.resolve(process.cwd(), 'clips');
const MIN_CLIP_DURATION = 3;
const MAX_CLIP_DURATION = 4;

// Validate that a file path is within allowed directories
function validateFilePath(filePath, allowedBasePath = uploadsDir) {
  if (!filePath || typeof filePath !== 'string') {
    return false;
  }
  const resolvedPath = path.resolve(filePath);
  const resolvedBase = path.resolve(allowedBasePath);
  return resolvedPath.startsWith(resolvedBase) && resolvedPath !== resolvedBase;
}

// Configure multer for video and audio uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadsDir = path.join(__dirname, '..', 'uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${randomUUID()}-${file.originalname}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
});

// Handle both file uploads and URL-based file paths
function getFileSource(file, filePath) {
  if (file && file.path) {
    if (!validateFilePath(file.path)) {
      throw new Error('Invalid file path');
    }
    return file.path;
  }
  if (filePath) {
    if (!validateFilePath(filePath)) {
      throw new Error('Invalid file path');
    }
    return filePath;
  }
  return null;
}

function emitToClient(socketId, eventName, payload) {
  const io = getIo();
  const clientSocket = socketId ? io?.sockets.sockets.get(socketId) : null;
  if (clientSocket) {
    clientSocket.emit(eventName, payload);
    return;
  }

  // Fallback so progress is still visible even if the request started before
  // the frontend finished establishing its socket connection.
  io?.emit(eventName, payload);
}

function sanitizeDownloadName(name) {
  const baseName = path.parse(name || 'audio-track').name || 'audio-track';
  const cleaned = baseName
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return `${cleaned || 'audio-track'}.mp4`;
}

function pickClipDuration(remainingDuration) {
  if (remainingDuration <= MIN_CLIP_DURATION) {
    return remainingDuration;
  }
  if (remainingDuration <= MAX_CLIP_DURATION) {
    return remainingDuration;
  }
  return Math.random() < 0.5 ? MIN_CLIP_DURATION : MAX_CLIP_DURATION;
}

function pickRandomStart(duration, clipDuration, usedRanges) {
  if (duration <= clipDuration) {
    return 0;
  }

  const maxStart = Math.max(0, duration - clipDuration);
  const safetyGap = 1;

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const candidate = Math.random() * maxStart;
    const overlaps = usedRanges.some((range) => (
      candidate < (range.end + safetyGap) && (candidate + clipDuration) > (range.start - safetyGap)
    ));

    if (!overlaps) {
      usedRanges.push({ start: candidate, end: candidate + clipDuration });
      return candidate;
    }
  }

  const fallback = Math.random() * maxStart;
  usedRanges.push({ start: fallback, end: fallback + clipDuration });
  return fallback;
}

function buildClipArgs(inputFile, startTime, clipDuration, outputFile) {
  return [
    '-ss', String(startTime),
    '-i', inputFile,
    '-t', String(clipDuration),
    '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p',
    '-an',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '23',
    '-y',
    outputFile,
  ];
}

router.post('/', upload.any(), async (req, res) => {
  let concatListPath = '';
  const temporaryInputFiles = [];
  const generatedClipFiles = [];
  const socketId = req.headers['x-socket-id'];

  try {
    const outputDir = clipsDir;

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Collect video files
    const videoFiles = [];
    
    // Handle uploaded files
    for (let i = 1; i <= 3; i++) {
      const videoFile = req.files?.find(f => f.fieldname === `video${i}`);
      const videoPath = req.body[`video${i}Path`];
      
      if (videoFile || videoPath) {
        const sourcePath = getFileSource(videoFile, videoPath);
        if (sourcePath) {
          videoFiles.push(sourcePath);
          if (videoFile?.path) {
            temporaryInputFiles.push(videoFile.path);
          }
        }
      }
    }

    if (videoFiles.length !== 3) {
      return res.status(400).json({ error: 'Exactly 3 videos are required to create a montage' });
    }

    // Handle audio file
    const audioFile = req.files?.find(f => f.fieldname === 'audio');
    const audioPath = req.body.audioPath;
    const audioLabel = req.body.audioLabel;
    const audioSource = getFileSource(audioFile, audioPath);
    if (audioFile?.path) {
      temporaryInputFiles.push(audioFile.path);
    }

    if (!audioSource) {
      return res.status(400).json({ error: 'An audio track is required to create a montage' });
    }

    // Generate output filename
    const outputFileName = `montage-${Date.now()}.mp4`;
    const outputPath = path.join(outputDir, outputFileName);
    const downloadName = sanitizeDownloadName(audioFile?.originalname || audioLabel || outputFileName);

    const [audioDuration, ...videoDurations] = await Promise.all([
      probeDuration(audioSource),
      ...videoFiles.map((videoPath) => probeDuration(videoPath)),
    ]);

    emitToClient(socketId, 'montage-progress', { percent: 5, currentTime: 'Analyzing source media...' });

    const clipPlan = [];
    const usedRangesByPath = new Map();
    let remainingDuration = audioDuration;
    let sourceIndex = 0;

    while (remainingDuration > 0.05) {
      const clipDuration = pickClipDuration(remainingDuration);
      const videoDuration = videoDurations[sourceIndex];
      const rangeKey = videoFiles[sourceIndex];
      const usedRanges = usedRangesByPath.get(rangeKey) || [];
      const startTime = pickRandomStart(videoDuration, clipDuration, usedRanges);
      usedRangesByPath.set(rangeKey, usedRanges);

      clipPlan.push({
        sourceIndex,
        startTime,
        clipDuration,
      });

      remainingDuration -= clipDuration;
      sourceIndex = (sourceIndex + 1) % videoFiles.length;
    }

    emitToClient(socketId, 'montage-progress', { percent: 10, currentTime: 'Creating random clips...' });

    for (let i = 0; i < clipPlan.length; i += 1) {
      const plan = clipPlan[i];
      const clipPath = path.join(clipsDir, `montage-clip-${randomUUID()}.mp4`);
      generatedClipFiles.push(clipPath);
      const clipStartPercent = 10 + ((i / clipPlan.length) * 45);

      emitToClient(socketId, 'montage-progress', {
        percent: Math.round(clipStartPercent),
        currentTime: `Preparing clip ${i + 1}/${clipPlan.length}...`,
      });

      await runFFmpeg(
        buildClipArgs(videoFiles[plan.sourceIndex], plan.startTime, plan.clipDuration, clipPath),
        {
          duration: plan.clipDuration,
          onProgress: (progress) => {
            const scaledPercent = 10 + (((i + (progress.percent / 100)) / clipPlan.length) * 45);
            emitToClient(socketId, 'montage-progress', {
              percent: Math.round(scaledPercent),
              currentTime: `Creating clip ${i + 1}/${clipPlan.length}...`,
            });
          },
        },
      );

      const clipCompletePercent = 10 + (((i + 1) / clipPlan.length) * 45);
      emitToClient(socketId, 'montage-progress', {
        percent: Math.round(clipCompletePercent),
        currentTime: `Created clip ${i + 1}/${clipPlan.length}`,
      });
    }

    concatListPath = path.join(uploadsDir, `concat-${randomUUID()}.txt`);
    const concatList = generatedClipFiles.map((filePath) => `file '${filePath.replace(/\\/g, '/')}'`).join('\n');
    fs.writeFileSync(concatListPath, concatList);

    emitToClient(socketId, 'montage-progress', { percent: 60, currentTime: 'Joining clips with audio...' });

    await runFFmpeg(
      [
        '-f', 'concat',
        '-safe', '0',
        '-i', concatListPath,
        '-i', audioSource,
        '-t', String(audioDuration),
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '23',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-movflags', '+faststart',
        '-shortest',
        '-y',
        outputPath,
      ],
      {
        duration: audioDuration,
        onProgress: (progress) => {
          const scaledPercent = 60 + (progress.percent * 0.35);
          emitToClient(socketId, 'montage-progress', {
            percent: Math.round(scaledPercent),
            currentTime: progress.currentTime || 'Merging clips...',
          });
        },
      },
    );

    emitToClient(socketId, 'montage-progress', { percent: 98, currentTime: 'Finalizing montage...' });

    // Clean up concat list file
    if (concatListPath && fs.existsSync(concatListPath)) {
      fs.unlinkSync(concatListPath);
      concatListPath = '';
    }

    generatedClipFiles.forEach((clipPath) => {
      try {
        if (fs.existsSync(clipPath)) {
          fs.unlinkSync(clipPath);
        }
      } catch (_error) {}
    });

    // Get output file info
    const stats = fs.statSync(outputPath);
    let outputDuration = 0;
    try {
      outputDuration = await probeDuration(outputPath);
    } catch (e) {
      console.warn('Could not probe output duration:', e.message);
    }

    // Clean up only files uploaded as part of this request.
    temporaryInputFiles.forEach(f => {
      try {
        if (fs.existsSync(f)) {
          fs.unlinkSync(f);
        }
      } catch (e) {}
    });

    res.json({
      filePath: outputPath,
      fileName: outputFileName,
      downloadName,
      duration: outputDuration,
      size: stats.size,
    });
    emitToClient(socketId, 'montage-progress', { percent: 100, currentTime: 'Complete' });
  } catch (error) {
    console.error('Montage creation error:', error);
    if (concatListPath && fs.existsSync(concatListPath)) {
      try {
        fs.unlinkSync(concatListPath);
      } catch (_error) {}
    }
    generatedClipFiles.forEach((clipPath) => {
      try {
        if (fs.existsSync(clipPath)) {
          fs.unlinkSync(clipPath);
        }
      } catch (_error) {}
    });
    temporaryInputFiles.forEach((filePath) => {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (_error) {}
    });
    emitToClient(socketId, 'montage-error', { error: error.message || 'Failed to create montage' });
    res.status(500).json({ error: error.message || 'Failed to create montage' });
  }
});

export default router;
