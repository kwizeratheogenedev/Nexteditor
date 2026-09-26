import express from 'express';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import upload from '../middleware/upload.js';
import { requireAuth } from '../middleware/auth.js';
import { runFFmpeg, probeHasAudio } from '../services/ffmpeg.js';
import { getFileSource } from '../services/fileResolve.js';
import { isVideoLikeClip, isImageClip } from '../services/filterGraph/clipKinds.js';
import { clipOutputDuration } from '../services/filterGraph/effects/speedCurve.js';
import { buildCaptionAudioGraph } from '../services/filterGraph/captionAudio.js';
import { transcribeWords } from '../services/captionTranscription.js';

// POST /api/editor/captions - auto-captions for the editor timeline.
// Receives the same multipart upload as an export (timeline JSON plus one
// file per source), mixes just the timeline's audio, transcribes it with
// per-word timing and answers with the words. Turning words into caption
// lines and clips happens in the browser (timeline/captionLines.js), so
// switching caption style re-flows the lines without transcribing again.
const router = express.Router();
const uploadsDir = path.resolve(process.cwd(), 'uploads');
const clipsDir = path.resolve(process.cwd(), 'clips');
const CHUNK_SECONDS = 1200;

// Whisper language codes offered in the editor. '' = auto-detect.
export const CAPTION_LANGUAGES = { auto: '', en: 'en', fr: 'fr', sw: 'sw', es: 'es', de: 'de' };

const progressByJob = new Map();
function setProgress(req, percent, message) {
  const jobId = req.headers['x-job-id'];
  if (jobId) progressByJob.set(String(jobId).slice(0, 80), { percent: Math.round(percent), message, updatedAt: Date.now() });
}
setInterval(() => {
  const cutoff = Date.now() - 15 * 60 * 1000;
  progressByJob.forEach((value, key) => { if (value.updatedAt < cutoff) progressByJob.delete(key); });
}, 60 * 1000).unref?.();

router.get('/progress/:jobId', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(progressByJob.get(req.params.jobId) || { percent: 0, message: 'Uploading…' });
});

function parseClips(raw) {
  let clips;
  try {
    clips = JSON.parse(raw);
  } catch {
    throw Object.assign(new Error('Invalid timeline data.'), { status: 400 });
  }
  if (!Array.isArray(clips)) throw Object.assign(new Error('Invalid timeline data.'), { status: 400 });
  return clips.filter((clip) => clip && typeof clip === 'object' && clip.id && clip.sourceId
    && Number.isFinite(clip.trimmedStart) && Number.isFinite(clip.trimmedEnd) && clip.trimmedEnd > clip.trimmedStart
    && (clip.type === 'audio' || (isVideoLikeClip(clip) && !isImageClip(clip))));
}

router.post('/', requireAuth, upload.any(), async (req, res) => {
  const jobDir = path.join(uploadsDir, `captions-${randomUUID()}`);
  const tempFiles = [];
  try {
    await fsp.mkdir(jobDir, { recursive: true });
    const languageKey = String(req.body.language || 'auto');
    if (!(languageKey in CAPTION_LANGUAGES)) throw Object.assign(new Error('That language is not supported for captions.'), { status: 400 });
    const clips = parseClips(req.body.timeline);
    if (!clips.length) throw Object.assign(new Error('Add a video or audio clip with sound before generating captions.'), { status: 400 });

    setProgress(req, 8, 'Reading your media…');
    const filesBySourceId = new Map((req.files || []).map((file) => [file.fieldname.replace(/^source_/, ''), file]));
    (req.files || []).forEach((file) => tempFiles.push(file.path));
    const inputArgs = [];
    const inputIndexByClipId = new Map();
    const sourceHasAudio = new Map();
    const pathBySourceId = new Map();
    for (const clip of clips) {
      let sourcePath = pathBySourceId.get(clip.sourceId);
      if (!sourcePath) {
        if (clip.sourceKind === 'remote' && clip.remoteFileName) {
          sourcePath = getFileSource(null, path.join(clipsDir, path.basename(clip.remoteFileName)), [clipsDir]);
        } else {
          const uploaded = filesBySourceId.get(clip.sourceId);
          if (!uploaded) throw Object.assign(new Error('One of the clips is missing its media file.'), { status: 400 });
          sourcePath = getFileSource(uploaded, null, [uploadsDir]);
        }
        pathBySourceId.set(clip.sourceId, sourcePath);
        // eslint-disable-next-line no-await-in-loop
        sourceHasAudio.set(clip.sourceId, await probeHasAudio(sourcePath));
      }
      if (!sourceHasAudio.get(clip.sourceId)) continue;
      inputArgs.push('-i', sourcePath);
      inputIndexByClipId.set(clip.id, inputIndexByClipId.size);
    }

    const graph = buildCaptionAudioGraph(clips, inputIndexByClipId, sourceHasAudio);
    if (!graph) throw Object.assign(new Error('None of the clips on the timeline has sound to caption.'), { status: 400 });
    const duration = clips.reduce((max, clip) => Math.max(max, (clip.startTime || 0) + clipOutputDuration(clip)), 0);

    setProgress(req, 15, 'Preparing the audio…');
    // Mono 16 kHz MP3 in 20-minute pieces - each stays well under the
    // transcription API's per-file size limit.
    const chunkPattern = path.join(jobDir, 'speech-%03d.mp3');
    await runFFmpeg([
      '-hide_banner', '-loglevel', 'error', '-y', ...inputArgs,
      '-filter_complex', graph.filterComplex, '-map', `[${graph.audioOutputLabel}]`,
      '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '64k',
      '-f', 'segment', '-segment_time', String(CHUNK_SECONDS), '-reset_timestamps', '1', chunkPattern,
    ], { duration, onProgress: ({ percent }) => setProgress(req, 15 + percent * 0.15, 'Preparing the audio…') });
    const chunks = (await fsp.readdir(jobDir)).filter((name) => name.endsWith('.mp3')).sort().map((name) => path.join(jobDir, name));
    if (!chunks.length) throw new Error('Could not prepare the timeline audio.');

    setProgress(req, 32, 'Transcribing…');
    const result = await transcribeWords(chunks, {
      language: CAPTION_LANGUAGES[languageKey] || undefined,
      chunkSeconds: CHUNK_SECONDS,
      onProgress: (done, total) => setProgress(req, 32 + (done / total) * 66, 'Transcribing…'),
    });
    setProgress(req, 100, 'Done');
    res.json({ words: result.words, language: result.language, duration });
  } catch (err) {
    setProgress(req, 0, 'Failed');
    if (!res.headersSent) res.status(err.status || 500).json({ error: err.message || 'Could not generate captions.' });
  } finally {
    tempFiles.forEach((file) => fs.rm(file, { force: true }, () => {}));
    fs.rm(jobDir, { recursive: true, force: true }, () => {});
  }
});

export default router;
