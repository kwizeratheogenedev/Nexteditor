import express from 'express';
import { ffmpegGate } from '../services/renderGate.js';
import { getDiskStatus } from '../middleware/diskGuard.js';
import { currentVideoEncoder } from '../services/encoders.js';

// GET /health/details - a snapshot for monitoring dashboards and for you when
// asking "is the server busy or full?". No paths, keys or user data in it.
// (The plain /health endpoint stays as the simple liveness probe.)
const router = express.Router();
const startedAt = Date.now();

router.get('/', async (_req, res) => {
  const render = ffmpegGate.stats();
  let disk = null;
  try {
    disk = await getDiskStatus();
  } catch {
    // statfs unsupported here - report the rest without it
  }
  const minFreeGb = Number(process.env.MIN_FREE_DISK_GB) >= 0 && process.env.MIN_FREE_DISK_GB !== undefined
    ? Number(process.env.MIN_FREE_DISK_GB)
    : 5;
  const lowDisk = disk ? disk.freeGb < minFreeGb : false;

  res.json({
    status: lowDisk ? 'low_disk' : 'ok',
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    render,
    // null until the first editor export triggers detection
    exportEncoder: currentVideoEncoder(),
    disk,
  });
});

export default router;
