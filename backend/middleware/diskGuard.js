import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GB = 1024 * 1024 * 1024;

// Refuses new file uploads with a clear, retryable message when the server is
// close to running out of disk, instead of letting a big upload fill the disk
// halfway through and break every other user's renders too.
//
// Settings (all optional):
//   MIN_FREE_DISK_GB    keep at least this much free on the disk (default 5)
//   MAX_STORAGE_GB      cap on uploads/ + clips/ combined (default 40)
//
// If the check itself can't run (unsupported platform, permission error) the
// request is allowed through - a broken guard should never take the site down.

async function defaultFreeBytes(dir) {
  const stats = await fs.promises.statfs(dir);
  return Number(stats.bavail) * Number(stats.bsize);
}

async function defaultDirSize(dirs) {
  let total = 0;
  for (const dir of dirs) {
    let names = [];
    try {
      names = await fs.promises.readdir(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      try {
        const stat = await fs.promises.stat(path.join(dir, name));
        if (stat.isFile()) total += stat.size;
      } catch {
        // file removed between readdir and stat (cleanup job) - ignore
      }
    }
  }
  return total;
}

function readGb(envName, fallback) {
  const value = Number(process.env[envName]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function createDiskGuard({
  dirs = [path.resolve(__dirname, '..', 'uploads'), path.resolve(__dirname, '..', 'clips')],
  minFreeBytes = readGb('MIN_FREE_DISK_GB', 5) * GB,
  maxStorageBytes = readGb('MAX_STORAGE_GB', 40) * GB,
  freeBytes = defaultFreeBytes,
  dirSize = defaultDirSize,
  cacheMs = 10_000,
  now = Date.now,
} = {}) {
  let cached = null; // { at, free, used }

  async function measure() {
    if (cached && now() - cached.at < cacheMs) return cached;
    const [free, used] = await Promise.all([freeBytes(dirs[0]), dirSize(dirs)]);
    cached = { at: now(), free, used };
    return cached;
  }

  return async function diskGuard(req, res, next) {
    const isUpload = req.method === 'POST' && String(req.headers['content-type'] || '').startsWith('multipart/form-data');
    if (!isUpload) {
      next();
      return;
    }

    let reading;
    try {
      reading = await measure();
    } catch {
      next();
      return;
    }

    const incoming = Number(req.headers['content-length']) || 0;
    const tooFull = reading.free - incoming < minFreeBytes || reading.used + incoming > maxStorageBytes;
    if (tooFull) {
      res.setHeader('Retry-After', '120');
      res.status(503).json({
        error: 'The server is temporarily out of space for new uploads. Please try again in a few minutes.',
        code: 'SERVER_BUSY_DISK',
      });
      return;
    }
    next();
  };
}

export function getDiskStatus(options = {}) {
  const dirs = options.dirs || [path.resolve(__dirname, '..', 'uploads'), path.resolve(__dirname, '..', 'clips')];
  return Promise.all([defaultFreeBytes(dirs[0]), defaultDirSize(dirs)]).then(([free, used]) => ({
    freeGb: Math.round((free / GB) * 10) / 10,
    usedByAppGb: Math.round((used / GB) * 10) / 10,
  }));
}
