import express from 'express';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import upload from '../middleware/upload.js';
import { runFFmpeg, probeHasAudio } from '../services/ffmpeg.js';
import { getFileSource } from '../services/fileResolve.js';
import { buildEditorExportGraph } from '../services/filterGraph/index.js';
import { laneTotalDuration } from '../services/filterGraph/transitionMath.js';
import { clipOutputDuration } from '../services/filterGraph/effects/speedCurve.js';
import { getIo } from '../socket.js';

const router = express.Router();
const uploadsDir = path.resolve(process.cwd(), 'uploads');
const clipsDir = path.resolve(process.cwd(), 'clips');

// Fixed for M1 - matches the "1080p / 16:9" canvas already shown in the
// Editor tab's player footer. Becomes a per-project setting once the UI
// exposes canvas/aspect controls.
const CANVAS = { width: 1920, height: 1080, fps: 30 };

const progressByJob = new Map();

function emitProgress(req, percent, currentTime) {
  const payload = { percent: Math.round(percent), currentTime };
  const jobId = req.headers['x-job-id'];
  if (jobId) progressByJob.set(jobId, { ...payload, updatedAt: Date.now() });
  const socketId = req.headers['x-socket-id'];
  const socket = socketId ? getIo()?.sockets.sockets.get(socketId) : null;
  socket?.emit('export-progress', payload);
}

router.get('/progress/:jobId', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(progressByJob.get(req.params.jobId) || { percent: 0, currentTime: 'Waiting for upload...' });
});

function parseTimeline(raw) {
  let clips;
  try {
    clips = JSON.parse(raw);
  } catch {
    throw new Error('Invalid timeline data.');
  }
  if (!Array.isArray(clips) || clips.length === 0) {
    throw new Error('Timeline is empty - add at least one clip before exporting.');
  }
  clips.forEach((clip, index) => {
    if (!clip || typeof clip !== 'object') throw new Error(`Clip ${index + 1} is invalid.`);
    if (clip.type !== 'text' && clip.type !== 'adjustment' && !clip.sourceId) throw new Error(`Clip ${index + 1} is missing its source.`);
    if (!Number.isFinite(clip.trimmedStart) || !Number.isFinite(clip.trimmedEnd) || clip.trimmedEnd <= clip.trimmedStart) {
      throw new Error(`Clip ${index + 1} has an invalid trim range.`);
    }
  });
  if (!clips.some((clip) => (clip.type === 'video' || !clip.type) && (clip.trackIndex || 0) === 0)) {
    throw new Error('Add at least one clip to the base video track before exporting - overlay tracks alone can\'t be rendered yet.');
  }
  return clips;
}

function sanitizeDownloadName(name) {
  const base = path.parse(name || 'nexeditor-export').name.replace(/[^a-zA-Z0-9 _.-]/g, '').trim() || 'nexeditor-export';
  return `${base}.mp4`;
}

router.post('/', upload.any(), async (req, res) => {
  const tempFiles = [];
  const outputFiles = [];
  const jobDir = path.join(uploadsDir, `export-${randomUUID()}`);
  fs.mkdirSync(jobDir, { recursive: true });

  try {
    const clips = parseTimeline(req.body.timeline);
    const filesBySourceId = new Map((req.files || []).map((file) => [file.fieldname.replace(/^source_/, ''), file]));

    const inputArgs = [];
    const inputIndexBySourceId = new Map();
    const sourceHasAudio = new Map();
    let nextInputIndex = 0;

    for (const clip of clips) {
      if (clip.type === 'text' || clip.type === 'adjustment' || inputIndexBySourceId.has(clip.sourceId)) continue;

      let sourcePath;
      if (clip.sourceKind === 'remote' && clip.remoteFileName) {
        sourcePath = getFileSource(null, path.join(clipsDir, path.basename(clip.remoteFileName)), [clipsDir]);
      } else {
        const uploadedFile = filesBySourceId.get(clip.sourceId);
        if (!uploadedFile) {
          throw new Error('One of the clips is missing its uploaded video file.');
        }
        sourcePath = getFileSource(uploadedFile, null, [uploadsDir]);
        tempFiles.push(sourcePath);
      }

      inputArgs.push('-i', sourcePath);
      inputIndexBySourceId.set(clip.sourceId, nextInputIndex);
      nextInputIndex += 1;
      // eslint-disable-next-line no-await-in-loop
      sourceHasAudio.set(clip.sourceId, await probeHasAudio(sourcePath));
    }

    emitProgress(req, 5, 'Preparing timeline...');

    const { filterComplex, videoOutputLabel, audioOutputLabel } = buildEditorExportGraph(
      clips,
      inputIndexBySourceId,
      sourceHasAudio,
      CANVAS,
      jobDir,
    );

    // Text and audio-track clips play on their own parallel mini-timelines
    // and don't extend the program length - matches the frontend's
    // editorTotalDuration. Only trackIndex 0 renders (see index.js) so the
    // program length is that lane's own furthest clip end.
    const laneZeroVideoClips = clips.filter((clip) => (clip.type === 'video' || !clip.type) && (clip.trackIndex || 0) === 0);
    const totalDuration = laneTotalDuration(laneZeroVideoClips, clipOutputDuration);

    const outputName = `editor-export-${randomUUID()}.mp4`;
    const outputPath = path.join(clipsDir, outputName);
    outputFiles.push(outputPath);

    await runFFmpeg(
      [
        '-y',
        ...inputArgs,
        '-filter_complex',
        filterComplex,
        '-map',
        `[${videoOutputLabel}]`,
        '-map',
        `[${audioOutputLabel}]`,
        '-r',
        String(CANVAS.fps),
        '-pix_fmt',
        'yuv420p',
        '-c:v',
        'libx264',
        '-preset',
        process.env.EXPORT_ENCODE_PRESET || 'veryfast',
        '-crf',
        process.env.EXPORT_CRF || '20',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-movflags',
        '+faststart',
        outputPath,
      ],
      {
        duration: totalDuration,
        onProgress: (progress) => emitProgress(req, 5 + progress.percent * 0.94, progress.currentTime || 'Rendering...'),
      },
    );

    const stats = fs.statSync(outputPath);
    emitProgress(req, 100, 'Export complete');

    res.json({
      fileName: outputName,
      filePath: `/clips/${outputName}`,
      downloadName: sanitizeDownloadName(req.body.projectName),
      duration: totalDuration,
      size: stats.size,
    });
  } catch (error) {
    console.error('Editor export failed:', error);
    emitProgress(req, 0, 'Export failed');
    for (const filePath of outputFiles) {
      fs.rm(filePath, { force: true }, () => {});
    }
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || 'Failed to export the timeline.' });
    }
  } finally {
    for (const filePath of tempFiles) {
      fs.rm(filePath, { force: true }, () => {});
    }
    fs.rm(jobDir, { recursive: true, force: true }, () => {});
    const jobId = req.headers['x-job-id'];
    if (jobId) setTimeout(() => progressByJob.delete(jobId), 15 * 60 * 1000);
  }
});

export default router;
