import os from 'os';
import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import ffprobePath from 'ffprobe-static';
import { ffmpegGate } from './renderGate.js';

function resolveBinaryPath(pkgExport) {
  if (typeof pkgExport === 'string') return pkgExport;
  if (pkgExport && typeof pkgExport === 'object') {
    // some packages export an object like { path: '/...'} or default export
    if (typeof pkgExport.path === 'string') return pkgExport.path;
    if (typeof pkgExport.default === 'string') return pkgExport.default;
    if (typeof pkgExport.default === 'object' && typeof pkgExport.default.path === 'string') return pkgExport.default.path;
  }
  return null;
}

const FFMPEG_BINARY = process.env.FFMPEG_PATH || resolveBinaryPath(ffmpegPath) || ffmpegPath;
const FFPROBE_BINARY = process.env.FFPROBE_PATH || resolveBinaryPath(ffprobePath) || ffprobePath;

function parseProgressLine(line) {
  const timeMatch = line.match(/time=(\d{2}:\d{2}:\d{2}(?:\.\d+)?)/);
  return timeMatch ? timeMatch[1] : null;
}

function timecodeToSeconds(timecode) {
  const [hours, minutes, seconds] = timecode.split(':');
  return (Number(hours) * 3600) + (Number(minutes) * 60) + Number(seconds);
}

export function probeDuration(filePath) {
  return new Promise((resolve, reject) => {
    const child = spawn(FFPROBE_BINARY, [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      filePath,
    ]);

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || 'ffprobe failed'));
        return;
      }

      const duration = Number.parseFloat(stdout.trim());
      if (!Number.isFinite(duration)) {
        reject(new Error('Unable to determine media duration'));
        return;
      }

      resolve(duration);
    });
  });
}

export function probeHasAudio(filePath) {
  return new Promise((resolve) => {
    const child = spawn(FFPROBE_BINARY, [
      '-v',
      'error',
      '-select_streams',
      'a',
      '-show_entries',
      'stream=codec_type',
      '-of',
      'csv=p=0',
      filePath,
    ]);

    let stdout = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    // A source with no readable audio stream shouldn't fail the whole
    // export - callers substitute silence for it instead.
    child.on('error', () => resolve(false));
    child.on('close', () => resolve(stdout.trim().length > 0));
  });
}

// `cwd` lets a caller with hundreds of inputs pass short relative file names
// (Windows caps a whole command line at ~32k characters); `signal` kills the
// process when a sibling job fails, so a parallel render doesn't keep
// encoding chunks nobody is going to use.
// `lowPriority` runs the process below normal CPU priority: when a job fans out
// into several encoders, that keeps the single-threaded jobs beside it (the
// audio mix) and the rest of the machine from being starved by them.
//
// Every ffmpeg launch in the app goes through runFFmpeg, so waiting for a free
// slot in the global gate (see renderGate.js) protects all routes at once,
// and all the options above are passed straight through. The kill-switch
// timeout in runFFmpegNow only starts once the process actually spawns, so
// time spent queued never counts against a job.
export async function runFFmpeg(args, options) {
  const release = await ffmpegGate.acquire();
  try {
    // Cancelled while still waiting in line: don't start it at all.
    if (options?.signal?.aborted) throw new Error('Render cancelled.');
    return await runFFmpegNow(args, options);
  } finally {
    release();
  }
}

function runFFmpegNow(args, { duration, onProgress, timeout, cwd, signal, lowPriority } = {}) {
  const FFMPEG_TIMEOUT = timeout || parseInt(process.env.FFMPEG_TIMEOUT || '3600000', 10); // Default 1 hour

  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG_BINARY, args, cwd ? { cwd } : undefined);
    if (lowPriority && child.pid) {
      try {
        os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
      } catch { /* not permitted on this platform - just run at normal priority */ }
    }
    let stderr = '';
    let timeoutId;

    if (signal) {
      const onAbort = () => {
        child.kill('SIGTERM');
        reject(new Error('Render cancelled.'));
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
      child.on('close', () => signal.removeEventListener('abort', onAbort));
    }

    // Set timeout to kill ffmpeg if it takes too long
    timeoutId = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`FFmpeg timeout exceeded (${FFMPEG_TIMEOUT}ms)`));
    }, FFMPEG_TIMEOUT);

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;

      if (!onProgress || !duration) {
        return;
      }

      for (const line of text.split(/\r?\n/)) {
        const currentTime = parseProgressLine(line);
        if (!currentTime) {
          continue;
        }

        const percent = Math.max(
          0,
          Math.min(100, (timecodeToSeconds(currentTime) / duration) * 100),
        );
        onProgress({ percent, currentTime });
      }
    });

    child.on('error', (error) => {
      clearTimeout(timeoutId);
      reject(error);
    });

    child.on('close', (code) => {
      clearTimeout(timeoutId);
      if (code !== 0) {
        reject(new Error(stderr.trim() || 'ffmpeg failed'));
        return;
      }
      resolve();
    });
  });
}
