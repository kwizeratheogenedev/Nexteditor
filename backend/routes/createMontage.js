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
const uploadsDir = path.resolve(__dirname, '..', 'uploads');
const clipsDir = path.resolve(__dirname, '..', 'clips');
const MIN_CLIP_DURATION = 3;
const MAX_CLIP_DURATION = 4;
const SKIP_INPUT_VIDEO_SECONDS = 40;

class RequestError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'RequestError';
    this.status = status;
  }
}

function isPathInside(filePath, basePath) {
  const relative = path.relative(basePath, filePath);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

// Validate that a file path is within allowed directories
function validateFilePath(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    return false;
  }
  try {
    const resolvedPath = fs.realpathSync(path.resolve(filePath));
    const resolvedUploads = fs.realpathSync(uploadsDir);
    const resolvedClips = fs.realpathSync(clipsDir);
    return fs.statSync(resolvedPath).isFile()
      && (isPathInside(resolvedPath, resolvedUploads) || isPathInside(resolvedPath, resolvedClips));
  } catch (_error) {
    return false;
  }
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
    const safeOriginalName = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
    const uniqueName = `${randomUUID()}-${safeOriginalName || 'media'}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024, files: 10 }, // 500MB per file
  fileFilter: (_req, file, cb) => {
    const hasSupportedField = /^video[1-3]$/.test(file.fieldname) || /^audio\d*$/.test(file.fieldname);
    const hasSupportedMime = file.mimetype.startsWith('video/')
      || file.mimetype.startsWith('audio/')
      || file.mimetype === 'application/octet-stream';
    if (hasSupportedField && hasSupportedMime) {
      cb(null, true);
      return;
    }
    cb(new RequestError('Only video and audio files are supported'));
  },
});

const montageUpload = upload.any();

function uploadMontageMedia(req, res, next) {
  montageUpload(req, res, (error) => {
    if (!error) {
      next();
      return;
    }
    for (const uploadedFile of req.files || []) {
      try {
        if (uploadedFile.path && fs.existsSync(uploadedFile.path)) {
          fs.unlinkSync(uploadedFile.path);
        }
      } catch (_cleanupError) {}
    }
    next(error);
  });
}

// Handle both file uploads and URL-based file paths
function getFileSource(file, filePath) {
  if (file) {
    // multer usually provides `file.path` as a string. If it's missing,
    // try to construct from destination+filename. Be defensive about types.
    if (typeof file.path === 'string' && file.path.length > 0) {
      if (!validateFilePath(file.path)) {
        throw new RequestError('Invalid or missing media file');
      }
      return file.path;
    }
    if (typeof file.destination === 'string' && typeof file.filename === 'string') {
      const constructed = path.join(file.destination, file.filename);
      if (!validateFilePath(constructed)) {
        throw new RequestError('Invalid or missing media file');
      }
      return constructed;
    }
  }
  if (filePath) {
    if (!validateFilePath(filePath)) {
      throw new RequestError('This media file is no longer available. Fetch or upload it again.', 410);
    }
    const resolvedPath = fs.realpathSync(path.resolve(filePath));
    const now = new Date();
    fs.utimesSync(resolvedPath, now, now);
    return resolvedPath;
  }
  return null;
}

function emitToClient(socketId, eventName, payload) {
  const io = getIo();
  const clientSocket = socketId ? io?.sockets.sockets.get(socketId) : null;
  if (clientSocket) {
    clientSocket.emit(eventName, payload);
  }
}

function sanitizeDownloadName(name) {
  const baseName = path.parse(name || 'audio-track').name || 'audio-track';
  const cleaned = baseName
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return `${cleaned || 'audio-track'}.mp4`;
}

function parseBoolean(value, defaultValue = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value === 'true' || value === '1';
  return defaultValue;
}

function pickClipDuration(remainingDuration, syncMode, tempoSensitivity) {
  if (remainingDuration <= MIN_CLIP_DURATION) {
    return remainingDuration;
  }
  if (remainingDuration <= MAX_CLIP_DURATION) {
    return remainingDuration;
  }

  const baseWeight = {
    beat: { min: 0.65, max: 0.35 },
    scene: { min: 0.35, max: 0.65 },
    auto: { min: 0.5, max: 0.5 },
  }[syncMode] || { min: 0.5, max: 0.5 };

  const tempoAdjustment = {
    gentle: { min: 0.35, max: 0.65 },
    medium: { min: 0.5, max: 0.5 },
    aggressive: { min: 0.75, max: 0.25 },
  }[tempoSensitivity] || { min: 0.5, max: 0.5 };

  const minDurationProbability = (baseWeight.min + tempoAdjustment.min) / 2;
  return Math.random() < minDurationProbability ? MIN_CLIP_DURATION : MAX_CLIP_DURATION;
}

function pickRandomStart(duration, clipDuration, usedRanges, skipSeconds = 0) {
  if (duration <= clipDuration) {
    const fallback = 0;
    usedRanges.push({ start: fallback, end: fallback + clipDuration });
    return fallback;
  }

  // Adjust skipSeconds if duration is too short to skip that much
  const actualSkip = duration > (skipSeconds + clipDuration + 2) ? skipSeconds : 0;

  const minStart = Math.min(actualSkip, Math.max(0, duration - clipDuration));
  const maxStart = Math.max(minStart, duration - clipDuration);
  const safetyGap = 1;

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const candidate = minStart + (Math.random() * (maxStart - minStart));
    const overlaps = usedRanges.some((range) => (
      candidate < (range.end + safetyGap) && (candidate + clipDuration) > (range.start - safetyGap)
    ));

    if (!overlaps) {
      usedRanges.push({ start: candidate, end: candidate + clipDuration });
      return candidate;
    }
  }

  const fallback = minStart + (Math.random() * (maxStart - minStart));
  usedRanges.push({ start: fallback, end: fallback + clipDuration });
  return fallback;
}

function getQualitySettings(videoQuality) {
  const map = {
    low: { preset: 'veryfast', crf: '28' },
    medium: { preset: 'faster', crf: '24' },
    high: { preset: 'fast', crf: '21' },
    ultra: { preset: 'medium', crf: '18' },
  };
  return map[videoQuality] || map.high;
}

function buildClipArgs(inputFile, startTime, clipDuration, outputFile, { beautyStyle, enhanceMotion, colorBoost, smoothTransitions, contrastPolish, videoQuality }) {
  const quality = getQualitySettings(videoQuality);
  const filters = [
    'scale=1280:720:force_original_aspect_ratio=decrease',
    'pad=1280:720:(ow-iw)/2:(oh-ih)/2',
    'setsar=1',
    'fps=30',
  ];

  if (beautyStyle === 'cinematic') {
    filters.push('eq=saturation=1.12:contrast=1.08:gamma_r=1.02:gamma_g=1.02:gamma_b=1.02');
  } else if (beautyStyle === 'vivid') {
    filters.push('eq=saturation=1.25:contrast=1.1:brightness=0.02');
  } else if (beautyStyle === 'glow') {
    filters.push('gblur=sigma=2,eq=brightness=0.05:contrast=1.04:saturation=1.1');
  }

  if (colorBoost) {
    filters.push('eq=saturation=1.18:contrast=1.08');
  }
  if (contrastPolish) {
    filters.push('eq=contrast=1.06:gamma=1.02');
  }
  if (smoothTransitions) {
    const fadeDuration = Math.min(0.25, clipDuration / 4);
    const fadeOutStart = Math.max(0, clipDuration - fadeDuration);
    filters.push(`fade=t=in:st=0:d=${fadeDuration},fade=t=out:st=${fadeOutStart}:d=${fadeDuration}`);
  }
  if (enhanceMotion) {
    filters.push('unsharp=luma_msize_x=5:luma_msize_y=5:luma_amount=0.5');
  }
  filters.push('format=yuv420p');

  const filterChain = filters.join(',');

  return [
    '-stream_loop', '-1',
    '-ss', String(startTime),
    '-i', inputFile,
    '-t', String(clipDuration),
    '-vf', filterChain,
    '-an',
    '-c:v', 'libx264',
    '-preset', quality.preset,
    '-crf', quality.crf,
    '-y',
    outputFile,
  ];
}

router.post('/', uploadMontageMedia, async (req, res) => {
  let concatListPath = '';
  let outputPath = '';
  const temporaryInputFiles = [];
  const generatedClipFiles = [];
  const socketId = req.headers['x-socket-id'];
  const startedAt = Date.now();
  let latestProgress = { percent: 0, currentTime: 'Request received. Preparing media...' };
  const reportProgress = (percent, currentTime) => {
    latestProgress = { percent, currentTime };
    emitToClient(socketId, 'montage-progress', latestProgress);
  };
  const heartbeatId = setInterval(() => {
    const elapsedSeconds = Math.max(1, Math.floor((Date.now() - startedAt) / 1000));
    emitToClient(socketId, 'montage-progress', {
      ...latestProgress,
      currentTime: `${latestProgress.currentTime} · ${elapsedSeconds}s elapsed`,
    });
  }, 5000);
  heartbeatId.unref?.();

  try {
    reportProgress(1, 'Validating source media...');
    const outputDir = clipsDir;

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    for (const uploadedFile of req.files || []) {
      if (typeof uploadedFile.path === 'string') {
        temporaryInputFiles.push(uploadedFile.path);
      }
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
        }
      }
    }

    if (videoFiles.length < 2) {
      throw new RequestError('At least 2 videos are required to create a montage');
    }

    // Handle audio inputs: support multiple uploaded audio fields named
    // `audio`, `audio1`, `audio2`, or form fields `audioPath`, `audioPath1`, etc.
    const audioFilesUploaded = (req.files || []).filter(f => /^audio\d*$/.test(f.fieldname));
    const audioPathKeys = Object.keys(req.body || {}).filter(k => /^audioPath\d*$/.test(k));
    const audioPathValues = audioPathKeys.map(k => req.body[k]);
    const rawAudioInputs = [
      ...audioFilesUploaded,
      ...audioPathValues,
    ].filter(Boolean);

    if (rawAudioInputs.length === 0) {
      throw new RequestError('At least one audio track is required to create a montage');
    }

    // Normalize to resolved file paths
    const audioSources = rawAudioInputs.map((item) => {
      if (typeof item === 'string') return getFileSource(null, item);
      return getFileSource(item, null);
    }).filter(Boolean);

    if (audioSources.length === 0) {
      throw new RequestError('No valid audio sources found');
    }

    // Normalize every source to AAC so uploaded and URL-based audio behaves consistently.
    reportProgress(3, 'Preparing audio track...');
    const normalizedAudioFiles = [];
    for (let i = 0; i < audioSources.length; i += 1) {
      const src = audioSources[i];
      const normalized = path.join(uploadsDir, `normalized-audio-${randomUUID()}.m4a`);
      temporaryInputFiles.push(normalized);
      await runFFmpeg([
        '-i', src,
        '-vn',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-y',
        normalized,
      ]);
      normalizedAudioFiles.push(normalized);
    }

    // If multiple audio files were supplied, concatenate them in request order.
    let mergedAudioPath = normalizedAudioFiles[0];
    if (normalizedAudioFiles.length > 1) {
      const audioConcatList = path.join(uploadsDir, `audio-concat-${randomUUID()}.txt`);
      const listContent = normalizedAudioFiles.map(p => `file '${p.replace(/'/g, "'\\''").replace(/\\/g, '/')}'`).join('\n');
      fs.writeFileSync(audioConcatList, listContent);
      temporaryInputFiles.push(audioConcatList);
      const merged = path.join(uploadsDir, `merged-audio-${randomUUID()}.m4a`);
      temporaryInputFiles.push(merged);
      await runFFmpeg([
        '-f', 'concat',
        '-safe', '0',
        '-i', audioConcatList,
        '-c', 'copy',
        '-y',
        merged,
      ]);
      mergedAudioPath = merged;
    }

    // Generate output filename
    const outputFileName = `montage-${Date.now()}.mp4`;
    outputPath = path.join(outputDir, outputFileName);
    const downloadName = sanitizeDownloadName(req.body.audioLabel || outputFileName);

    const [audioDuration, ...videoDurations] = await Promise.all([
      probeDuration(mergedAudioPath),
      ...videoFiles.map((videoPath) => probeDuration(videoPath)),
    ]);

    if (!Number.isFinite(audioDuration) || audioDuration <= 0) {
      throw new RequestError('The selected audio track has no playable duration');
    }
    if (videoDurations.some((duration) => !Number.isFinite(duration) || duration <= 0)) {
      throw new RequestError('One or more selected videos has no playable duration');
    }

    reportProgress(5, 'Analyzing source media...');

    const syncMode = req.body.syncMode || 'beat';
    const tempoSensitivity = req.body.tempoSensitivity || 'medium';
    const beautyStyle = req.body.beautyStyle || 'cinematic';
    const enhanceMotion = parseBoolean(req.body.enhanceMotion, true);
    const colorBoost = parseBoolean(req.body.colorBoost, false);
    const smoothTransitions = parseBoolean(req.body.smoothTransitions, true);
    const contrastPolish = parseBoolean(req.body.contrastPolish, true);
    const videoQuality = req.body.videoQuality || 'high';

    const clipPlan = [];
    const usedRangesByPath = new Map();
    let remainingDuration = audioDuration;
    let sourceIndex = 0;

    while (remainingDuration > 0.05) {
      const clipDuration = pickClipDuration(remainingDuration, syncMode, tempoSensitivity);
      const videoDuration = videoDurations[sourceIndex];
      const rangeKey = videoFiles[sourceIndex];
      const usedRanges = usedRangesByPath.get(rangeKey) || [];
      const startTime = pickRandomStart(videoDuration, clipDuration, usedRanges, SKIP_INPUT_VIDEO_SECONDS);
      usedRangesByPath.set(rangeKey, usedRanges);

      clipPlan.push({
        sourceIndex,
        startTime,
        clipDuration,
      });

      remainingDuration -= clipDuration;
      sourceIndex = (sourceIndex + 1) % videoFiles.length;
    }

    reportProgress(10, 'Creating random clips...');

    for (let i = 0; i < clipPlan.length; i += 1) {
      const plan = clipPlan[i];
      const clipPath = path.join(clipsDir, `montage-clip-${randomUUID()}.mp4`);
      generatedClipFiles.push(clipPath);
      const clipStartPercent = 10 + ((i / clipPlan.length) * 45);

      reportProgress(Math.round(clipStartPercent), `Preparing clip ${i + 1}/${clipPlan.length}...`);

      await runFFmpeg(
        buildClipArgs(videoFiles[plan.sourceIndex], plan.startTime, plan.clipDuration, clipPath, {
          beautyStyle,
          enhanceMotion,
          colorBoost,
          smoothTransitions,
          contrastPolish,
          videoQuality,
        }),
        {
          duration: plan.clipDuration,
          onProgress: (progress) => {
            const scaledPercent = 10 + (((i + (progress.percent / 100)) / clipPlan.length) * 45);
            reportProgress(Math.round(scaledPercent), `Creating clip ${i + 1}/${clipPlan.length}...`);
          },
        },
      );

      const clipCompletePercent = 10 + (((i + 1) / clipPlan.length) * 45);
      reportProgress(Math.round(clipCompletePercent), `Created clip ${i + 1}/${clipPlan.length}`);
    }

    concatListPath = path.join(uploadsDir, `concat-${randomUUID()}.txt`);
    const concatList = generatedClipFiles.map((filePath) => `file '${filePath.replace(/\\/g, '/')}'`).join('\n');
    fs.writeFileSync(concatListPath, concatList);

    // Join the generated clips with the selected audio track. We explicitly map
    // the video stream from the concat input and the audio stream from the
    // provided audio source to avoid attached image/audio-only streams.
    reportProgress(60, 'Joining clips with audio...');

    await runFFmpeg(
        [
          '-f', 'concat',
          '-safe', '0',
          '-i', concatListPath,
          '-i', mergedAudioPath,
          '-t', String(audioDuration),
          '-map', '0:v:0',
          '-map', '1:a:0',
          '-c:v', 'copy',
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
            reportProgress(Math.round(scaledPercent), 'Joining clips with audio...');
          },
        },
      );

    reportProgress(98, 'Finalizing montage...');

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

    reportProgress(100, 'Complete');
    clearInterval(heartbeatId);
    res.json({
      filePath: outputPath,
      fileName: outputFileName,
      downloadName,
      duration: outputDuration,
      size: stats.size,
    });
  } catch (error) {
    clearInterval(heartbeatId);
    if ((error.status || 500) >= 500) {
      console.error('Montage creation error:', error && (error.stack || error));
    } else {
      console.warn(`Montage request rejected: ${error.message}`);
    }
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
    if (outputPath && fs.existsSync(outputPath)) {
      try {
        fs.unlinkSync(outputPath);
      } catch (_error) {}
    }
    emitToClient(socketId, 'montage-error', { error: error.message || 'Failed to create montage' });
    const response = { error: error.message || 'Failed to create montage' };
    if (process.env.NODE_ENV !== 'production' && (error.status || 500) >= 500) response.stack = error.stack;
    res.status(error.status || 500).json(response);
  }
});

export default router;
