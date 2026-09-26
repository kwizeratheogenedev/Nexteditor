import express from 'express';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import upload from '../middleware/upload.js';
import { probeHasAudio } from '../services/ffmpeg.js';
import { runWithEncoderFallback } from '../services/encoders.js';
import { getFileSource } from '../services/fileResolve.js';
import { buildEditorExportGraph } from '../services/filterGraph/index.js';
import { isVideoLikeClip, isImageClip } from '../services/filterGraph/clipKinds.js';
import { laneTotalDuration } from '../services/filterGraph/transitionMath.js';
import { clipOutputDuration } from '../services/filterGraph/effects/speedCurve.js';
import { getIo } from '../socket.js';
import { requireAuth } from '../middleware/auth.js';
import { upsertJob } from '../services/jobTracker.js';
import { renderLongMix } from '../services/longMixRender.js';
import { isPro, checkAndConsumeExportQuota, FREE_EXPORT_MAX_SECONDS, FREE_STORAGE_BYTES_LIMIT } from '../services/planLimits.js';

const router = express.Router();
const uploadsDir = path.resolve(process.cwd(), 'uploads');
const clipsDir = path.resolve(process.cwd(), 'clips');

// Mirrors frontend/src/timeline/canvasPresets.js's ASPECT_RATIOS/
// RESOLUTIONS/FPS_OPTIONS - keep both in sync if a preset is ever added or
// removed. The server never reads a client-sent width/height directly, only
// these preset ids, so there's no arbitrary-resolution input to validate.
const ALLOWED_ASPECTS = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1, '4:5': 4 / 5 };
const ALLOWED_LONG_EDGES = { '720p': 1280, '1080p': 1920, '4k': 3840 };
const PRO_ONLY_RESOLUTIONS = new Set(['4k']);
const ALLOWED_FPS = new Set([24, 30, 60]);
const DEFAULT_CANVAS_SIZE = { aspectRatioId: '16:9', resolutionId: '1080p', fps: 30, fitMode: 'contain' };

// Builds the real {width, height, fps, fitMode} the filter graph renders to,
// from the client's requested preset ids - rejects (rather than silently
// clamping) an unrecognized id or a free user requesting a Pro-only
// resolution, before any rendering starts.
function resolveCanvas(rawCanvasSize, userIsPro) {
  let requested;
  try {
    requested = JSON.parse(rawCanvasSize || '');
  } catch {
    requested = DEFAULT_CANVAS_SIZE;
  }
  const aspectRatioId = requested.aspectRatioId || DEFAULT_CANVAS_SIZE.aspectRatioId;
  const resolutionId = requested.resolutionId || DEFAULT_CANVAS_SIZE.resolutionId;
  const fps = requested.fps || DEFAULT_CANVAS_SIZE.fps;
  const fitMode = requested.fitMode === 'cover' ? 'cover' : 'contain';

  const ratio = ALLOWED_ASPECTS[aspectRatioId];
  const longEdge = ALLOWED_LONG_EDGES[resolutionId];
  if (!ratio || !longEdge || !ALLOWED_FPS.has(fps)) {
    const error = new Error('Invalid canvas settings.');
    error.code = 'INVALID_CANVAS';
    throw error;
  }
  if (PRO_ONLY_RESOLUTIONS.has(resolutionId) && !userIsPro) {
    const error = new Error('4K exports are a Pro feature. Choose 720p or 1080p, or upgrade to export in 4K.');
    error.code = 'UPGRADE_REQUIRED';
    throw error;
  }

  const toEven = (n) => Math.round(n / 2) * 2;
  const width = ratio >= 1 ? toEven(longEdge) : toEven(longEdge * ratio);
  const height = ratio >= 1 ? toEven(longEdge / ratio) : toEven(longEdge);
  return { width, height, fps, fitMode };
}

const progressByJob = new Map();

function emitProgress(req, percent, currentTime, extra = {}) {
  const payload = { percent: Math.round(percent), currentTime, ...extra };
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

// Serves a finished export as a real file download (Content-Disposition:
// attachment). Linking straight at /clips/<file> with a `download` attribute
// only works same-origin - from the dev frontend (a different port) the
// browser ignores it and just plays the video in the tab, which is what made
// the LongMix Download button look dead. It also streams from disk with
// range support, so a multi-gigabyte mix never gets buffered in the browser.
// The name is a server-generated uuid, so like /clips itself it isn't
// enumerable; the pattern check keeps it from ever leaving clipsDir.
router.get('/download/:fileName', (req, res) => {
  const { fileName } = req.params;
  if (!/^[a-zA-Z0-9-]+\.mp4$/.test(fileName)) {
    res.status(400).json({ error: 'Invalid file name.' });
    return;
  }
  const filePath = path.join(clipsDir, fileName);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'This file is no longer on the server - render it again.' });
    return;
  }
  res.download(filePath, sanitizeDownloadName(req.query.name));
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
  // Clip ids key the per-clip ffmpeg input list (see the input loop below),
  // so a missing or duplicated id would silently point two clips at one
  // input - exactly the shared-input case that costs memory, and with the
  // wrong trim window on top. Cheap to reject up front.
  const seenIds = new Set();
  clips.forEach((clip, index) => {
    if (!clip || typeof clip !== 'object') throw new Error(`Clip ${index + 1} is invalid.`);
    if (!clip.id || seenIds.has(clip.id)) throw new Error(`Clip ${index + 1} has a missing or duplicate id.`);
    seenIds.add(clip.id);
    if (clip.type !== 'text' && clip.type !== 'adjustment' && !clip.sourceId) throw new Error(`Clip ${index + 1} is missing its source.`);
    if (!Number.isFinite(clip.trimmedStart) || !Number.isFinite(clip.trimmedEnd) || clip.trimmedEnd <= clip.trimmedStart) {
      throw new Error(`Clip ${index + 1} has an invalid trim range.`);
    }
  });
  if (!clips.some((clip) => isVideoLikeClip(clip) && (clip.trackIndex || 0) === 0)) {
    throw new Error('Add at least one clip to the base video track before exporting - overlay tracks alone can\'t be rendered yet.');
  }
  return clips;
}

// LongMix Studio sends its own compact description alongside the timeline
// clips: the songs in the order they were added, the background scenes, and
// the mix settings. Absent means an ordinary editor export (null). Everything
// is re-validated and coerced here - none of it is trusted to be well formed.
const SCENE_MODES = new Set(['single', 'per-song', 'interval']);
const LONGMIX_FPS_OPTIONS = new Set([15, 24, 30]);

function parseLongMix(raw) {
  if (!raw) return null;
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error('Invalid long mix data.');
  }
  if (!data || !Array.isArray(data.songs) || !Array.isArray(data.scenes) || data.songs.length === 0) {
    throw new Error('A long mix needs at least one song.');
  }
  const songs = data.songs.map((song, index) => {
    if (!song || typeof song.sourceId !== 'string') throw new Error(`Song ${index + 1} is missing its source.`);
    return {
      sourceId: song.sourceId,
      title: String(song.title || `Track ${index + 1}`).slice(0, 200),
      clientDuration: Number(song.duration) > 0 ? Number(song.duration) : 1,
    };
  });
  const scenes = data.scenes.map((scene, index) => {
    if (!scene || typeof scene.sourceId !== 'string') throw new Error(`Scene ${index + 1} is missing its source.`);
    return {
      sourceId: scene.sourceId,
      kind: scene.kind === 'video' ? 'video' : 'image',
      clientDuration: Number(scene.duration) > 0 ? Number(scene.duration) : 0,
    };
  });
  if (scenes.length === 0) throw new Error('A long mix needs at least one background scene.');
  const raw2 = data.settings || {};
  const settings = {
    crossfade: Math.min(30, Math.max(0, Number(raw2.crossfade) || 0)),
    sceneMode: SCENE_MODES.has(raw2.sceneMode) ? raw2.sceneMode : 'per-song',
    sceneIntervalMinutes: Math.max(1, Number(raw2.sceneIntervalMinutes) || 5),
    motionPresetId: String(raw2.motionPresetId || ''),
    targetMinutes: Math.max(0, Number(raw2.targetMinutes) || 0),
    // The render's own frame rate, independent of the editor canvas's 30.
    // Encoding cost is per frame, and a music mix's slow camera move gains
    // nothing from 30 - 15 renders several times faster (see longMixRender).
    fps: LONGMIX_FPS_OPTIONS.has(Number(raw2.fps)) ? Number(raw2.fps) : 15,
  };
  return { songs, scenes, settings };
}

function sanitizeDownloadName(name) {
  const base = path.parse(name || 'nexeditor-export').name.replace(/[^a-zA-Z0-9 _.-]/g, '').trim() || 'nexeditor-export';
  return `${base}.mp4`;
}

router.post('/', requireAuth, upload.any(), async (req, res) => {
  const tempFiles = [];
  const outputFiles = [];
  const jobDir = path.join(uploadsDir, `export-${randomUUID()}`);
  fs.mkdirSync(jobDir, { recursive: true });
  const jobId = req.headers['x-job-id'] || `export-${randomUUID()}`;
  const ownerId = req.user._id;
  upsertJob(ownerId, { jobId, kind: 'export', status: 'running', progress: 0, message: 'Preparing timeline...' });

  try {
    const clips = parseTimeline(req.body.timeline);
    const filesBySourceId = new Map((req.files || []).map((file) => [file.fieldname.replace(/^source_/, ''), file]));

    const userIsPro = isPro(req.user);
    // Resolved before the input list is built (rather than just before
    // rendering, as it used to be) because an image source's own -i flags
    // need the project's real frame rate - a still has no intrinsic
    // duration or frame rate of its own, so ffmpeg has to be told both.
    // resolveCanvas itself throws UPGRADE_REQUIRED for a free user
    // requesting 4K, which now happens even earlier than before - still
    // well ahead of buildEditorExportGraph/runFFmpeg, so that rejection is
    // immediate instead of following a full-cost render that
    // freeTierLimits.js would only downscale anyway.
    const CANVAS = resolveCanvas(req.body.canvasSize, userIsPro);

    // The one place a finished render is recorded, whichever pipeline made
    // it. The 202 already went out before rendering started (see below), so
    // the result reaches the caller only through progressByJob/the Job model.
    const finishExport = async (outputName, outputPath, totalDuration, extra = {}) => {
      const stats = fs.statSync(outputPath);
      const result = {
        fileName: outputName,
        filePath: `/clips/${outputName}`,
        downloadName: sanitizeDownloadName(req.body.projectName),
        duration: totalDuration,
        size: stats.size,
        ...extra,
      };
      req.user.usage.storageBytesUsed += stats.size;
      await req.user.save();
      emitProgress(req, 100, 'Export complete', { result });
      upsertJob(ownerId, { jobId, status: 'done', progress: 100, message: 'Export complete', result });
    };

    // LongMix Studio projects take a purpose-built, parallel pipeline instead
    // of the general timeline graph - see services/longMixRender.js for why
    // (measured ~9x faster, and it lays the songs out in the order they were
    // added from their real durations). Free-tier accounts keep the general
    // path, which carries the watermark and the free-plan caps.
    const longMix = userIsPro ? parseLongMix(req.body.longMix) : null;
    if (longMix) {
      const sourcePaths = new Map();
      const pathFor = (sourceId) => {
        if (!sourcePaths.has(sourceId)) {
          const uploaded = filesBySourceId.get(sourceId);
          if (!uploaded) throw new Error('One of the songs or scenes is missing its uploaded file.');
          const sourcePath = getFileSource(uploaded, null, [uploadsDir]);
          tempFiles.push(sourcePath);
          sourcePaths.set(sourceId, sourcePath);
        }
        return sourcePaths.get(sourceId);
      };
      const songs = longMix.songs.map((song) => ({ ...song, path: pathFor(song.sourceId) }));
      const scenes = longMix.scenes.map((scene) => ({ ...scene, path: pathFor(scene.sourceId) }));

      const outputName = `longmix-${randomUUID()}.mp4`;
      const outputPath = path.join(clipsDir, outputName);
      outputFiles.push(outputPath);

      // Same early answer as the general path below: a mix can render for
      // hours, so it must not depend on this connection staying open.
      res.status(202).json({ jobId });
      emitProgress(req, 2, 'Analyzing your songs...');
      const rendered = await renderLongMix({
        songs,
        scenes,
        settings: longMix.settings,
        canvas: { ...CANVAS, fps: longMix.settings.fps },
        workDir: jobDir,
        outputPath,
        onProgress: (percent, text) => emitProgress(req, percent, text),
      });
      await finishExport(outputName, outputPath, rendered.duration, {
        chapters: rendered.chapters,
        songDurations: rendered.songDurations,
      });
      return;
    }

    const inputArgs = [];
    // One -i per CLIP, not per source file - see the note on
    // buildEditorExportGraph for why sharing an input between two clips that
    // play far apart is what made long projects exhaust memory.
    const inputIndexByClipId = new Map();
    const sourceHasAudio = new Map();
    const pathBySourceId = new Map();
    let nextInputIndex = 0;

    for (const clip of clips) {
      if (clip.type === 'text' || clip.type === 'adjustment') continue;

      // The file itself is still resolved (and probed) once per source -
      // it's only the ffmpeg input that's per clip.
      let sourcePath = pathBySourceId.get(clip.sourceId);
      if (!sourcePath) {
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
        pathBySourceId.set(clip.sourceId, sourcePath);
        // An image never has an audio stream, so this resolves false for
        // one and the graph substitutes silence - no image-specific branch
        // needed.
        // eslint-disable-next-line no-await-in-loop
        sourceHasAudio.set(clip.sourceId, await probeHasAudio(sourcePath));
      }

      if (isImageClip(clip)) {
        // A still is opened as an endlessly repeating single frame
        // (`-loop 1`), so ffmpeg needs an explicit `-t` to know when that
        // input ends - otherwise the looped stream never does and the
        // export hangs. `-framerate` gives the still the project's own
        // frame rate, which it has no opinion of its own about. The bound
        // is how far into the image this clip reads, plus a small margin so
        // a trim landing exactly on the end still has a frame to read.
        const loopDuration = ((clip.trimmedEnd || 0) + 0.5).toFixed(3);
        inputArgs.push('-loop', '1', '-framerate', String(CANVAS.fps), '-t', loopDuration, '-i', sourcePath);
      } else {
        inputArgs.push('-i', sourcePath);
      }
      inputIndexByClipId.set(clip.id, nextInputIndex);
      nextInputIndex += 1;
    }

    emitProgress(req, 5, 'Preparing timeline...');

    // Text and audio-track clips play on their own parallel mini-timelines
    // and don't extend the program length - matches the frontend's
    // editorTotalDuration. Only trackIndex 0 renders (see index.js) so the
    // program length is that lane's own furthest clip end.
    const laneZeroVideoClips = clips.filter((clip) => isVideoLikeClip(clip) && (clip.trackIndex || 0) === 0);
    const totalDuration = laneTotalDuration(laneZeroVideoClips, clipOutputDuration);

    if (!userIsPro && totalDuration > FREE_EXPORT_MAX_SECONDS) {
      const error = new Error(`Free plan exports are limited to ${FREE_EXPORT_MAX_SECONDS / 60} minutes. Upgrade to Pro for longer exports.`);
      error.code = 'UPGRADE_REQUIRED';
      throw error;
    }
    if (!userIsPro && clips.some((clip) => clip.type === 'adjustment')) {
      const error = new Error('Adjustment layers are a Pro feature. Remove them or upgrade to export.');
      error.code = 'UPGRADE_REQUIRED';
      throw error;
    }
    if (!userIsPro && req.user.usage.storageBytesUsed >= FREE_STORAGE_BYTES_LIMIT) {
      const error = new Error('Free plan storage limit (2GB) reached. Upgrade to Pro for more storage.');
      error.code = 'UPGRADE_REQUIRED';
      throw error;
    }
    const quota = await checkAndConsumeExportQuota(req.user);
    if (!quota.allowed) {
      const error = new Error(quota.reason);
      error.code = 'UPGRADE_REQUIRED';
      throw error;
    }

    const { filterComplex, videoOutputLabel, audioOutputLabel } = buildEditorExportGraph(
      clips,
      inputIndexByClipId,
      sourceHasAudio,
      CANVAS,
      jobDir,
      { freeTier: !userIsPro },
    );

    const outputName = `editor-export-${randomUUID()}.mp4`;
    const outputPath = path.join(clipsDir, outputName);
    outputFiles.push(outputPath);

    // A long-mix project (dozens of songs plus a dozen-plus Ken Burns'd
    // scene images - see frontend/src/timeline/longMix.js) builds a
    // filter_complex string far longer than the ~128KB a single argv entry
    // can hold on Linux (MAX_ARG_STRLEN), which fails as a confusing
    // "argument list too long" spawn error rather than anything about the
    // timeline. ffmpeg's own answer is -filter_complex_script, which reads
    // the identical graph from a file - used past a threshold well below
    // the real limit, so the normal (easier to debug from a process list)
    // inline form still covers every ordinary project. jobDir is created
    // and cleaned up per export already.
    const FILTER_ARG_LIMIT = 60000;
    const filterArgs = filterComplex.length > FILTER_ARG_LIMIT
      ? ['-filter_complex_script', (() => {
        const scriptPath = path.join(jobDir, 'filter_complex.txt');
        fs.writeFileSync(scriptPath, filterComplex);
        return scriptPath;
      })()]
      : ['-filter_complex', filterComplex];

    // Everything that can reject the request outright (bad timeline, an
    // unsupported canvas, a free-tier/quota gate) has already run - answer
    // now instead of holding this one connection open for the render
    // itself, which for a LongMix Studio project can run for hours (see
    // runFFmpeg's scaled timeout above). Without this, a refreshed tab, a
    // sleeping laptop or a network blip during that window doesn't just
    // stop this tab from watching - res.json(result) below would throw on
    // the now-dead socket, which used to send a render that had actually
    // *finished* straight into the catch block, which deletes outputFiles.
    // The video was really rendered and then deleted only because the
    // response failed to send. Progress and the final result now land in
    // progressByJob (this tab's own polling) and the Job model
    // (JobsResumeBanner / a resumed poll after reload) regardless of
    // whether this connection survives - same pattern as createMontage.js.
    res.status(202).json({ jobId });

    // Video encoder args come from services/encoders.js: a hardware encoder
    // (NVIDIA/Intel/AMD/Apple) when this machine has a working one, else
    // libx264 with the same EXPORT_ENCODE_PRESET/EXPORT_CRF as before.
    await runWithEncoderFallback(
      (videoEncoderArgs) => [
        '-y',
        ...inputArgs,
        ...filterArgs,
        '-map',
        `[${videoOutputLabel}]`,
        '-map',
        `[${audioOutputLabel}]`,
        '-r',
        String(CANVAS.fps),
        ...videoEncoderArgs,
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
        // ffmpeg.js's own default kill-switch is a flat 1 hour, sized for
        // ordinary clips - a LongMix Studio project can run to 4 hours of
        // output (see frontend/src/timeline/longMix.js targetMinutes) with
        // per-frame Ken Burns scaling on every scene (see
        // filterGraph/effects/transform.js's eval=frame path), which is slow
        // enough to encode that a long mix can legitimately take longer than
        // an hour of wall-clock time. Scale the ceiling to the program's own
        // length instead of the flat default, so a real long render isn't
        // killed partway through and thrown away - the flat default still
        // applies (as a floor) to catch a genuinely stuck process on short
        // exports.
        timeout: Math.max(
          parseInt(process.env.FFMPEG_TIMEOUT || '3600000', 10),
          totalDuration * 1000 * 6,
        ),
      },
    );

    await finishExport(outputName, outputPath, totalDuration);
  } catch (error) {
    const isUpgradeRequired = error.code === 'UPGRADE_REQUIRED';
    if (!isUpgradeRequired) console.error('Editor export failed:', error);
    emitProgress(req, 0, 'Export failed', { error: error.message || 'Failed to export the timeline.', code: error.code });
    upsertJob(ownerId, { jobId, status: 'error', error: error.message || 'Failed to export the timeline.' });
    for (const filePath of outputFiles) {
      fs.rm(filePath, { force: true }, () => {});
    }
    // Only reachable when the failure happened before the early 202 (a
    // validation/quota/canvas error) - once that's gone out, this
    // request's response is already spent and emitProgress/upsertJob above
    // are what actually reach the client.
    if (!res.headersSent) {
      res.status(isUpgradeRequired ? 403 : 500).json({ error: error.message || 'Failed to export the timeline.', ...(isUpgradeRequired ? { code: 'UPGRADE_REQUIRED' } : {}) });
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
