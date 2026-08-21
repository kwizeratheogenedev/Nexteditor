import express from 'express';
import Job from '../models/Job.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

router.use(requireAuth);

// Lets the frontend ask "what did I leave running?" right after login -
// covers both still-running jobs and ones that finished/errored while the
// user was logged out, so results aren't silently lost.
router.get('/mine', async (req, res) => {
  const { status } = req.query;
  try {
    const query = { owner: req.user._id };
    if (status) query.status = status;
    const jobs = await Job.find(query).sort({ updatedAt: -1 }).limit(20);
    res.json({ jobs });
  } catch (err) {
    console.error('Failed to list jobs:', err);
    res.status(500).json({ error: 'Failed to load jobs.' });
  }
});

router.post('/:jobId/ack', async (req, res) => {
  try {
    await Job.deleteOne({ owner: req.user._id, jobId: req.params.jobId });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to dismiss job.' });
  }
});

export default router;
