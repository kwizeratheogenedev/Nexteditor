import { spawn } from 'child_process';

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
    const child = spawn('ffprobe', [
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

export function runFFmpeg(args, { duration, onProgress } = {}) {
  const FFMPEG_TIMEOUT = parseInt(process.env.FFMPEG_TIMEOUT || '3600000', 10); // Default 1 hour
  
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args);
    let stderr = '';
    let timeoutId;

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
