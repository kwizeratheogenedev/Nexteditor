import express from 'express';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { captionUpload } from '../middleware/upload.js';
import { probeDuration, runFFmpeg } from '../services/ffmpeg.js';
import { transcribeChunks } from '../services/captionTranscription.js';
import { getIo } from '../socket.js';

const router = express.Router();
const clipsDir = path.resolve(process.cwd(), 'clips');
const uploadsDir = path.resolve(process.cwd(), 'uploads');
const LANGUAGE_CODES = { 'English (US)': 'en', 'English (UK)': 'en', Spanish: 'es', French: 'fr', German: 'de' };
const progressByJob = new Map();

function emitProgress(req, percent, currentTime) {
  const jobId = req.headers['x-job-id'];
  if (jobId) progressByJob.set(jobId, { percent: Math.round(percent), currentTime, updatedAt: Date.now() });
  const socketId = req.headers['x-socket-id'];
  const socket = socketId ? getIo()?.sockets.sockets.get(socketId) : null;
  socket?.emit('ffmpeg-progress', { percent: Math.round(percent), currentTime });
}

router.get('/progress/:jobId', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(progressByJob.get(req.params.jobId) || { percent: 0, currentTime: 'Waiting for upload...' });
});

function escapeSubtitlePath(filePath) {
  return filePath.replace(/\\/g, '/').replace(/'/g, "\\'").replace(/:/g, '\\:');
}

function captionStyle(position) {
  // This bundled Windows libass build renders the vertical 5/8 alignment
  // values opposite to their documented ASS labels, so calibrate them here.
  const alignments = { top: 5, center: 8, bottom: 2, 'bottom-left': 1, 'bottom-right': 3 };
  const alignment = alignments[position] || 2;
  const marginV = position === 'top' ? 42 : position === 'center' ? 0 : 42;
  return `Alignment=${alignment},MarginV=${marginV},MarginL=36,MarginR=36`;
}

const FILLER_WORD_PATTERN = /\b(um+|uh+|erm+|hm+|you know|i mean)\b[,.]?\s*/gi;

function removeFillerWords(srtText) {
  return srtText
    .split('\n')
    .map((line) => {
      // Skip index lines and timestamp lines (e.g. "00:00:01,000 --> 00:00:03,000").
      if (/^\d+$/.test(line.trim()) || line.includes('-->')) return line;
      const cleaned = line.replace(FILLER_WORD_PATTERN, ' ').replace(/\s{2,}/g, ' ').trim();
      return cleaned;
    })
    .join('\n');
}

function captionedFileName(originalName) {
  const base = path.parse(originalName || 'video').name.replace(/[^a-zA-Z0-9 _.-]/g, '').trim() || 'video';
  return `${base}-captioned.mp4`;
}

router.post('/', captionUpload.single('video'), async (req, res) => {
  const jobId = randomUUID();
  const jobDir = path.join(uploadsDir, `captions-${jobId}`);
  const outputPath = path.join(clipsDir, `captioned-${jobId}.mp4`);
  let downloadStarted = false;

  try {
    if (!req.file) return res.status(400).json({ error: 'Please upload a video.' });
    await fsp.mkdir(jobDir, { recursive: true });
    const duration = await probeDuration(req.file.path);
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('The uploaded video has no readable duration.');

    emitProgress(req, 12, 'Extracting speech audio...');
    const chunkPattern = path.join(jobDir, 'speech-%03d.wav');
    await runFFmpeg([
      '-hide_banner', '-loglevel', 'error', '-i', req.file.path,
      '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le',
      '-f', 'segment', '-segment_time', '1200', '-reset_timestamps', '1', chunkPattern,
    ], { duration, onProgress: (value) => emitProgress(req, 12 + value.percent * 0.13, 'Extracting speech audio...') });

    const chunks = (await fsp.readdir(jobDir)).filter((name) => name.endsWith('.wav')).sort().map((name) => path.join(jobDir, name));
    if (!chunks.length) throw new Error('No audio track was found in this video.');

    emitProgress(req, 26, req.body.mode === 'lyrics' ? 'Recognizing lyrics with Whisper...' : 'Recognizing speech with Whisper...');
    const language = LANGUAGE_CODES[req.body.language] || req.body.language || undefined;
    const prompt = req.body.mode === 'lyrics' ? 'Transcribe sung lyrics accurately, preserving line breaks.' : undefined;
    const srt = await transcribeChunks(chunks, {
      language,
      prompt,
      onProgress: (done, total) => emitProgress(req, 26 + (done / total) * 44, `${req.body.mode === 'lyrics' ? 'Transcribing lyrics' : 'Transcribing speech'} ${done}/${total}...`),
    });
    const finalSrt = req.body.removeFillers === 'true' ? removeFillerWords(srt) : srt;
    const subtitlePath = path.join(jobDir, 'captions.srt');
    await fsp.writeFile(subtitlePath, finalSrt, 'utf8');

    emitProgress(req, 71, 'Adding captions to video...');
    await runFFmpeg([
      '-hide_banner', '-y', '-i', req.file.path,
      '-vf', `subtitles='${escapeSubtitlePath(subtitlePath)}':force_style='${captionStyle(req.body.captionPosition)}'`,
      '-c:v', 'libx264', '-preset', process.env.CAPTION_ENCODE_PRESET || 'veryfast', '-crf', process.env.CAPTION_CRF || '20',
      '-c:a', 'copy', '-movflags', '+faststart', outputPath,
    ], { duration, onProgress: (value) => emitProgress(req, 71 + value.percent * 0.28, 'Rendering captioned video...') });

    emitProgress(req, 100, 'Captioned video ready');
    if (req.headers['x-job-id']) setTimeout(() => progressByJob.delete(req.headers['x-job-id']), 15 * 60 * 1000);
    downloadStarted = true;
    res.download(outputPath, captionedFileName(req.file.originalname), (error) => {
      if (error && !res.headersSent) res.status(500).json({ error: 'Unable to download the generated video.' });
      fsp.rm(outputPath, { force: true }).catch(() => {});
    });
  } catch (error) {
    console.error('Caption generation failed:', error);
    emitProgress(req, 0, 'Caption generation failed');
    if (req.headers['x-job-id']) setTimeout(() => progressByJob.delete(req.headers['x-job-id']), 15 * 60 * 1000);
    if (!res.headersSent) res.status(500).json({ error: error.message || 'Unable to generate captions.' });
  } finally {
    if (req.file?.path) fsp.rm(req.file.path, { force: true }).catch(() => {});
    fsp.rm(jobDir, { recursive: true, force: true }).catch(() => {});
    if (!downloadStarted && fs.existsSync(outputPath)) fsp.rm(outputPath, { force: true }).catch(() => {});
  }
});

export default router;
