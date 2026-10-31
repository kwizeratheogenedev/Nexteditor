import express from 'express';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import upload from '../middleware/upload.js';
import { probeDuration, probeHasAudio, runFFmpeg } from '../services/ffmpeg.js';
import { buildAudioMergeArgs, planAudioMerge } from '../services/audioMerge.js';
import { CLIPS_DIR } from '../storagePaths.js';
import { toUserMessage } from '../services/userMessage.js';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/admin.js';
import { trackOperation } from '../services/operations.js';

const router = express.Router();

// Audio Merge is admin-only for now. Checked before upload, so nobody else
// can put files on the server through this route.
router.use(requireAuth, requireAdmin);

// A real file download, for the same reason as exportTimeline.js's: a
// `download` attribute on a /clips link is ignored from another origin.
router.get('/download/:fileName', (req, res) => {
  const { fileName } = req.params;
  if (!/^audio-merge-[a-f0-9-]+\.(mp3|wav)$/.test(fileName)) {
    res.status(400).json({ error: 'Invalid file name.' });
    return;
  }
  const filePath = path.join(CLIPS_DIR, fileName);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'This file is no longer on the server - merge the audios again.' });
    return;
  }
  const base = typeof req.query.name === 'string' ? req.query.name.replace(/[^\p{L}\p{N} _.()-]/gu, '').trim().slice(0, 120) : '';
  res.download(filePath, `${base || 'audio-merge-8min'}${path.extname(fileName)}`);
});

router.post(
  '/',
  upload.fields([
    { name: 'first', maxCount: 1 },
    { name: 'second', maxCount: 1 },
  ]),
  trackOperation('audio-merge'),
  async (req, res) => {
    const firstPath = req.files?.first?.[0]?.path;
    const secondPath = req.files?.second?.[0]?.path;
    const outputName = `audio-merge-${randomUUID()}`;
    const mp3Path = path.join(CLIPS_DIR, `${outputName}.mp3`);
    const wavPath = path.join(CLIPS_DIR, `${outputName}.wav`);

    try {
      if (!firstPath || !secondPath) {
        res.status(400).json({ error: 'Please add both audio files.' });
        return;
      }
      if (!(await probeHasAudio(firstPath)) || !(await probeHasAudio(secondPath))) {
        res.status(400).json({ error: 'One of these files has no audio in it.' });
        return;
      }

      const [firstDuration, secondDuration] = await Promise.all([probeDuration(firstPath), probeDuration(secondPath)]);
      const plan = planAudioMerge(firstDuration, secondDuration);
      if (plan.error) {
        res.status(400).json({ error: plan.error });
        return;
      }

      await runFFmpeg(buildAudioMergeArgs(firstPath, secondPath, plan.secondSeconds, { mp3Path, wavPath }));
      res.json({ mp3: path.basename(mp3Path), wav: path.basename(wavPath) });
    } catch (err) {
      console.error(err);
      for (const filePath of [mp3Path, wavPath]) fs.rm(filePath, { force: true }, () => {});
      if (!res.headersSent) {
        res.status(500).json({ error: toUserMessage(err, 'These audios could not be merged. Please try again.') });
      }
    } finally {
      for (const filePath of [firstPath, secondPath]) {
        if (filePath) fs.rm(filePath, { force: true }, () => {});
      }
    }
  },
);

export default router;
