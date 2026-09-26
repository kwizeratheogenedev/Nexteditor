import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { runFFmpeg, probeDuration } from '../services/ffmpeg.js';
import { getFileSource as resolveFileSource } from '../services/fileResolve.js';
import { getIo } from '../socket.js';
import { optionalAuth } from '../middleware/auth.js';
import { upsertJob } from '../services/jobTracker.js';
import pLimit from 'p-limit';
import { UPLOADS_DIR, CLIPS_DIR } from '../storagePaths.js';
import { IS_LIMITED, EFFECTIVE_CPUS, MAX_PARALLEL_ENCODES } from '../services/cpuBudget.js';


const router = express.Router();
const uploadsDir = UPLOADS_DIR;
const clipsDir = CLIPS_DIR;
const MIN_CLIP_DURATION = 3;
const MAX_CLIP_DURATION = 4;
const DEFAULT_SKIP_INPUT_VIDEO_SECONDS = 40;
const MAX_SKIP_INPUT_VIDEO_SECONDS = 600;

// Configure multer for video and audio uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${randomUUID()}-${file.originalname}`;
    // Ensure multer file object includes consistent path info for downstream handlers
    try {
      file.destination = UPLOADS_DIR;
      file.filename = uniqueName;
      file.path = path.join(file.destination, uniqueName);
    } catch (e) {}
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
});

// Handle both file uploads and URL-based file paths
function getFileSource(file, filePath) {
  return resolveFileSource(file, filePath, [uploadsDir]);
}

// Latest progress/error payload per JOB id (not socket id - a socket
// connection is reused across every montage a browser tab creates in one
// session, so keying this by socketId let a second "Create new" montage's
// early polls read the FIRST montage's stale terminal 100%/"Complete" entry
// before the new run's own first progress update overwrote it; combined
// with the frontend's monotonic Math.max(current, incoming) progress guard,
// that stale 100% permanently latched the bar even though the real second
// render was still in progress). jobId is fresh per request, so no two
// separate montage runs can ever collide here.
const progressByJob = new Map();

function emitToClient(jobId, socketId, eventName, payload) {
  if (jobId && (eventName === 'montage-progress' || eventName === 'montage-error')) {
    progressByJob.set(jobId, { eventName, payload, updatedAt: Date.now() });
  }

  const io = getIo();
  const clientSocket = socketId ? io?.sockets.sockets.get(socketId) : null;
  if (clientSocket) {
    clientSocket.emit(eventName, payload);
  }
  // No broadcast fallback: broadcasting to every connected socket would leak
  // this job's progress/errors into other users' sessions whenever the
  // socket id is stale (e.g. after a reconnect).
}

setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [jobId, entry] of progressByJob.entries()) {
    if (entry.updatedAt < cutoff) progressByJob.delete(jobId);
  }
}, 15 * 60 * 1000);

router.get('/progress/:jobId', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const entry = progressByJob.get(req.params.jobId);
  if (!entry) {
    res.json({ percent: 0, currentTime: '' });
    return;
  }
  res.json(entry.eventName === 'montage-error' ? { percent: 0, currentTime: '', error: entry.payload.error } : entry.payload);
});

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

function parseSkipSeconds(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_SKIP_INPUT_VIDEO_SECONDS;
  return Math.min(parsed, MAX_SKIP_INPUT_VIDEO_SECONDS);
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

  const weightMin = Math.min(baseWeight.min, tempoAdjustment.min);
  return Math.random() < weightMin ? MIN_CLIP_DURATION : MAX_CLIP_DURATION;
}

function pickRandomStart(duration, clipDuration, usedRanges, skipSeconds = 0) {
  if (duration <= clipDuration) {
    const fallback = 0;
    usedRanges.push({ start: fallback, end: fallback + clipDuration });
    return fallback;
  }

  const minStart = Math.min(skipSeconds, Math.max(0, duration - clipDuration));
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

function getQualitySettings(videoQuality){
  const map = {
    low: { preset: 'veryfast', crf: '28' },
    medium: { preset: 'faster', crf: '24' },
    high: { preset: 'fast', crf: '21' },
    ultra: { preset: 'medium', crf: '18' },
  };
  return map[videoQuality] || map.high;
}

function buildClipArgs(inputFile, startTime, clipDuration, outputFile, { beautyStyle, enhanceMotion, colorBoost, smoothTransitions, contrastPolish, videoQuality }, isIntermediate = true) {
  const quality = isIntermediate ? { preset: 'ultrafast', crf: '18' } : getQualitySettings(videoQuality);
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
  if (enhanceMotion) {
    filters.push('unsharp=luma_msize_x=5:luma_msize_y=5:luma_amount=0.5');
  }

  const filterChain = filters.join(',');

  return [
    // -ss before -i is fast input-side seeking (the demuxer jumps straight
    // to the nearest keyframe); -ss after -i forces ffmpeg to decode every
    // frame from position 0 up to startTime first. A prior change flipped
    // this to "accurate" output-side seeking, which meant every one of the
    // ~100+ clips in a montage re-decoded from the start of its source
    // video (up to 600s of skipped intro, or any random offset elsewhere in
    // the file) before it could even begin cutting - the actual cause of
    // renders taking far longer than before. These are randomly-sampled
    // background clips, not frame-precise edits, so snapping to the nearest
    // keyframe is imperceptible and worth the massive speedup.
    '-ss', String(startTime),
    '-i', inputFile,
    '-t', String(clipDuration),
    '-vf', filterChain,
    '-an',
    '-c:v', 'libx264',
    '-preset', quality.preset,
    '-crf', quality.crf,
    '-pix_fmt', 'yuv420p',
    '-y',
    outputFile,
  ];
}

router.post('/', optionalAuth, upload.any(), async (req, res) => {
  let concatListPath = '';
  const temporaryInputFiles = [];
  const generatedClipFiles = [];
  const socketId = req.headers['x-socket-id'];
  // A fresh id per request - must NOT fall back to socketId, since a single
  // browser tab reuses the same socket connection across every "Create new"
  // montage in a session; keying progress tracking by socketId let a new
  // run's early polls read the previous run's stale terminal state (see the
  // progressByJob comment above).
  const jobId = req.headers['x-job-id'] || `montage-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const ownerId = req.user?._id;

  if (ownerId) upsertJob(ownerId, { jobId, kind: 'montage', status: 'running', progress: 0, message: 'Starting montage...' });

  try {
    console.log('createMontage: incoming request', { filesCount: req.files?.length || 0, bodyKeys: Object.keys(req.body || {}) });
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
        console.log(`video${i} source:`, { fieldname: videoFile?.fieldname, path: videoFile?.path, videoPath, sourcePath });
        if (sourcePath) {
          videoFiles.push(sourcePath);
          if (videoFile) {
            const uploadedPath = (typeof videoFile.path === 'string' && videoFile.path.length > 0)
              ? videoFile.path
              : (typeof videoFile.destination === 'string' && typeof videoFile.filename === 'string'
                ? path.join(videoFile.destination, videoFile.filename)
                : null);
            if (uploadedPath) temporaryInputFiles.push(uploadedPath);
          }
        }
      } else {
        console.log(`video${i} missing file and path`);
      }
    }

    if (videoFiles.length < 2) {
      return res.status(400).json({ error: 'At least 2 videos are required to create a montage' });
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
      return res.status(400).json({ error: 'At least one audio track is required to create a montage' });
    }

    // Normalize to resolved file paths
    const audioSources = rawAudioInputs.map((item) => {
      if (typeof item === 'string') return getFileSource(null, item);
      return getFileSource(item, null);
    }).filter(Boolean);

    if (audioSources.length === 0) {
      return res.status(400).json({ error: 'No valid audio sources found' });
    }

    // Everything needed to start is validated - respond now instead of
    // holding this one connection open for the entire render (which can
    // take several minutes). A screen lock/sleep, a backgrounded tab being
    // throttled, or any network blip during that window would otherwise
    // kill the connection and surface as a hard failure even though the
    // render was working fine - processing continues below regardless, and
    // progress/result land in progressByJob (and, if signed in, the Job
    // model) for the frontend to poll/resume watching.
    res.status(202).json({ jobId });

    // For each audio source, trim the first 40 seconds and produce trimmed files
    const audioLimit = pLimit(2);
    const trimmedAudioFiles = await Promise.all(
      audioSources.map((src) => audioLimit(async () => {
        const trimmed = path.join(uploadsDir, `trimmed-audio-${randomUUID()}.m4a`);
        await runFFmpeg([
          '-i', src,
          '-vn',
          '-c:a', 'aac',
          '-b:a', '192k',
          '-y',
          trimmed,
        ]);
        temporaryInputFiles.push(trimmed);
        return trimmed;
      })),
    );

    // If multiple trimmed audio files, concatenate them into one audio track
    let mergedAudioPath = trimmedAudioFiles[0];
    if (trimmedAudioFiles.length > 1) {
      const audioConcatList = path.join(uploadsDir, `audio-concat-${randomUUID()}.txt`);
      const listContent = trimmedAudioFiles.map(p => `file '${p.replace(/\\/g, '/')}'`).join('\n');
      fs.writeFileSync(audioConcatList, listContent);
      const merged = path.join(uploadsDir, `merged-audio-${randomUUID()}.m4a`);
      await runFFmpeg([
        '-f', 'concat',
        '-safe', '0',
        '-i', audioConcatList,
        '-c', 'copy',
        '-y',
        merged,
      ]);
      mergedAudioPath = merged;
      temporaryInputFiles.push(audioConcatList);
      temporaryInputFiles.push(merged);
    }

    // Generate output filename
    const outputFileName = sanitizeDownloadName(req.body.audioLabel || `montage-${Date.now()}`);
    const outputPath = path.join(outputDir, outputFileName);
    const downloadName = outputFileName;

    // The montage always runs the full length of the audio track - an
    // 8-minute song produces an 8-minute video, not a truncated one.
    const [audioDuration, ...videoDurations] = await Promise.all([
      probeDuration(mergedAudioPath),
      ...videoFiles.map((videoPath) => probeDuration(videoPath)),
    ]);

    emitToClient(jobId, socketId, 'montage-progress', { percent: 5, currentTime: 'Analyzing source media...' });
    if (ownerId) upsertJob(ownerId, { jobId, progress: 5, message: 'Analyzing source media...' });

    const montageStartTime = Date.now();
    const syncMode = req.body.syncMode || 'beat';
    const tempoSensitivity = req.body.tempoSensitivity || 'medium';
    const beautyStyle = req.body.beautyStyle || 'cinematic';
    const enhanceMotion = parseBoolean(req.body.enhanceMotion, true);
    const colorBoost = parseBoolean(req.body.colorBoost, false);
    const smoothTransitions = parseBoolean(req.body.smoothTransitions, true);
    const contrastPolish = parseBoolean(req.body.contrastPolish, true);
    const videoQuality = req.body.videoQuality || 'high';
    const skipInputVideoSeconds = parseSkipSeconds(req.body.skipStartSeconds);

    const clipPlan = [];
    const usedRangesByPath = new Map();
    let remainingDuration = audioDuration;
    let sourceIndex = 0;

    while (remainingDuration > 0.05) {
      const clipDuration = pickClipDuration(remainingDuration, syncMode, tempoSensitivity);
      const videoDuration = videoDurations[sourceIndex];
      const rangeKey = videoFiles[sourceIndex];
      const usedRanges = usedRangesByPath.get(rangeKey) || [];
      const startTime = pickRandomStart(videoDuration, clipDuration, usedRanges, skipInputVideoSeconds);
      usedRangesByPath.set(rangeKey, usedRanges);

      clipPlan.push({
        sourceIndex,
        startTime,
        clipDuration,
      });

      remainingDuration -= clipDuration;
      sourceIndex = (sourceIndex + 1) % videoFiles.length;
    }

    emitToClient(jobId, socketId, 'montage-progress', { percent: 10, currentTime: 'Creating random clips...' });

    // One core held back for the event loop/other requests; the rest run
    // clip encodes in parallel - was hardcoded to at most 4 regardless of
    // how many cores the machine actually has, which left real hardware
    // idle and slowed renders for no reason (output length/quality are
    // unaffected either way, this only changes how many clips render at
    // the same time).
    // In a container the instance's real limits decide (see cpuBudget.js).
    const clipLimit = pLimit(IS_LIMITED ? MAX_PARALLEL_ENCODES : Math.max(2, EFFECTIVE_CPUS - 1));
    let completedClips = 0;
    const totalClips = clipPlan.length;
    const clipRangeStart = 10;
    const clipRangeEnd = 55;
    const clipRange = clipRangeEnd - clipRangeStart;
    const segmentSize = totalClips > 0 ? clipRange / totalClips : clipRange;
    const clipStartTime = Date.now();
    let estimatedTotalTime = 0;

    const clipPromises = clipPlan.map((plan, i) =>
      clipLimit(async () => {
        const clipPath = path.join(clipsDir, `montage-clip-${randomUUID()}.mp4`);
        generatedClipFiles.push(clipPath);

        const segmentStart = clipRangeStart + (i * segmentSize);
        const segmentEnd = segmentStart + segmentSize;

        emitToClient(jobId, socketId, 'montage-progress', {
          percent: Math.round(segmentStart),
          currentTime: `Preparing clip ${i + 1}/${totalClips}...`,
        });

        await runFFmpeg(
          buildClipArgs(videoFiles[plan.sourceIndex], plan.startTime, plan.clipDuration, clipPath, {
            beautyStyle,
            enhanceMotion,
            colorBoost,
            smoothTransitions,
            contrastPolish,
            videoQuality,
          }, true),
          {
            duration: plan.clipDuration,
            onProgress: (progress) => {
              const clipProgress = Math.max(0, Math.min(1, progress.percent / 100));
              const overallPercent = segmentStart + (clipProgress * segmentSize);
              emitToClient(jobId, socketId, 'montage-progress', {
                percent: Math.round(overallPercent),
                currentTime: `Creating clip ${i + 1}/${totalClips}...`,
              });
            },
          },
        );

        completedClips += 1;
        const now = Date.now();
        const clipElapsed = now - clipStartTime;
        const avgTimePerClip = completedClips > 0 ? clipElapsed / completedClips : 0;
        const remainingClips = totalClips - completedClips;
        const timeLeftClips = remainingClips > 0 && avgTimePerClip > 0 ? remainingClips * avgTimePerClip : 0;
        const totalEstimatedClipsTime = totalClips > 0 && avgTimePerClip > 0 ? totalClips * avgTimePerClip : clipElapsed * 2;
        estimatedTotalTime = totalEstimatedClipsTime + Math.max(15000, totalEstimatedClipsTime * 0.15);
        const timeLeft = timeLeftClips + Math.max(15000, totalEstimatedClipsTime * 0.15);

        emitToClient(jobId, socketId, 'montage-progress', {
          percent: Math.round(segmentEnd),
          currentTime: `Created clip ${completedClips}/${totalClips}`,
          totalEstimatedTime: Math.round(estimatedTotalTime / 1000),
          timeSpent: Math.round((now - montageStartTime) / 1000),
          timeLeft: Math.round(timeLeft / 1000),
        });

        return clipPath;
      }),
    );

    await Promise.all(clipPromises);

    concatListPath = path.join(uploadsDir, `concat-${randomUUID()}.txt`);
    const concatList = generatedClipFiles.map((filePath) => `file '${filePath.replace(/\\/g, '/')}'`).join('\n');
    fs.writeFileSync(concatListPath, concatList);

    // Join the generated clips with the selected audio track. We explicitly map
    // the video stream from the concat input and the audio stream from the
    // provided audio source to avoid attached image/audio-only streams.
    const mergeStartTime = Date.now();
    emitToClient(jobId, socketId, 'montage-progress', { percent: 60, currentTime: 'Joining clips with audio...', totalEstimatedTime: Math.round(estimatedTotalTime / 1000), timeSpent: Math.round((Date.now() - montageStartTime) / 1000) });
    if (ownerId) upsertJob(ownerId, { jobId, progress: 60, message: 'Joining clips with audio...' });

    const finalQuality = getQualitySettings(videoQuality);
    console.log('Starting final ffmpeg merge', { concatListPath, mergedAudioPath, outputPath, audioDuration, finalQuality });
    try {
      await runFFmpeg(
        [
          '-f', 'concat',
          '-safe', '0',
          '-i', concatListPath,
          '-i', mergedAudioPath,
          '-t', String(audioDuration),
          '-map', '0:v:0',
          '-map', '1:a:0',
          '-c:v', 'libx264',
          '-preset', finalQuality.preset,
          '-crf', finalQuality.crf,
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
            const mergeElapsed = Date.now() - mergeStartTime;
            const mergeProgress = Math.max(0, Math.min(1, progress.percent / 100));
            const remainingMergePercent = 1 - mergeProgress;
            const estimatedTotalMergeTime = mergeProgress > 0.05 ? mergeElapsed / mergeProgress : mergeElapsed * 2;
            const timeLeft = remainingMergePercent * estimatedTotalMergeTime;
            emitToClient(jobId, socketId, 'montage-progress', {
              percent: Math.round(scaledPercent),
              currentTime: progress.currentTime || 'Merging clips...',
              totalEstimatedTime: Math.round(estimatedTotalTime / 1000),
              timeSpent: Math.round((Date.now() - montageStartTime) / 1000),
              timeLeft: Math.round(timeLeft / 1000),
            });
          },
        },
      );
      console.log('Final ffmpeg merge completed', { outputPath });
    } catch (err) {
      console.error('Final ffmpeg merge failed', err && (err.stack || err));
      throw err;
    }

    emitToClient(jobId, socketId, 'montage-progress', { percent: 98, currentTime: 'Finalizing montage...', totalEstimatedTime: Math.round(estimatedTotalTime / 1000), timeSpent: Math.round((Date.now() - montageStartTime) / 1000), timeLeft: 0 });

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

    const result = {
      filePath: outputPath,
      fileName: outputFileName,
      downloadName,
      duration: outputDuration,
      size: stats.size,
    };
    // The client already got its response (202) when the job started - the
    // result now travels via the live socket push and the polling endpoint
    // (both read from the same progressByJob entry this writes), which is
    // what a client reconnecting after a dropped connection picks back up.
    emitToClient(jobId, socketId, 'montage-progress', { percent: 100, currentTime: 'Complete', totalEstimatedTime: Math.round(estimatedTotalTime / 1000), timeSpent: Math.round((Date.now() - montageStartTime) / 1000), timeLeft: 0, result });
    if (ownerId) upsertJob(ownerId, { jobId, status: 'done', progress: 100, message: 'Complete', result });
  } catch (error) {
    console.error('Montage creation error:', error && (error.stack || error));
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
    emitToClient(jobId, socketId, 'montage-error', { error: error.message || 'Failed to create montage', stack: error.stack });
    if (ownerId) upsertJob(ownerId, { jobId, status: 'error', error: error.message || 'Failed to create montage' });
    // Once the early 202 has gone out, this request's own response is
    // already spent - the emitToClient/upsertJob calls above are what
    // actually reach the client now. Only a validation failure that threw
    // before that early response (none currently do, but keep this
    // defensive) would still have a response left to send.
    if (!res.headersSent) {
      const response = { error: error.message || 'Failed to create montage' };
      if (process.env.NODE_ENV !== 'production') response.stack = error.stack;
      res.status(500).json(response);
    }
  }
});

export default router;
