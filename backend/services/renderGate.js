import { MAX_PARALLEL_ENCODES } from './cpuBudget.js';

// A first-in-first-out concurrency limiter. runFFmpeg (services/ffmpeg.js)
// acquires a slot before spawning, so no matter how many montages, exports or
// caption jobs arrive at once, only `max` ffmpeg processes ever run together;
// the rest wait their turn instead of exhausting CPU/RAM and taking the whole
// server down.
export function createGate(max) {
  let limit = Math.max(1, Math.floor(max));
  let active = 0;
  const waiting = [];

  function startNext() {
    while (active < limit && waiting.length > 0) {
      const next = waiting.shift();
      active += 1;
      next(makeRelease());
    }
  }

  function makeRelease() {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      active -= 1;
      startNext();
    };
  }

  return {
    acquire() {
      return new Promise((resolve) => {
        waiting.push(resolve);
        startNext();
      });
    },
    stats() {
      return { active, queued: waiting.length, max: limit };
    },
  };
}

// Default: one process per CPU core (never fewer than 2). A single montage
// already fans out to cpus-1 clip encodes, so this lets one job use the
// machine fully while still capping the total when several arrive together.
// In a container (Render) the real CPU/memory limits decide instead - see
// cpuBudget.js. Override with FFMPEG_MAX_CONCURRENT.
const configured = Number(process.env.FFMPEG_MAX_CONCURRENT);
const defaultMax = Number.isFinite(configured) && configured > 0
  ? configured
  : MAX_PARALLEL_ENCODES;

export const ffmpegGate = createGate(defaultMax);
