import fs from 'fs';
import os from 'os';

// How much of the machine this process may really use. Inside a container
// (Render, Docker) os.cpus() lists the HOST's cores - often 8 to 64 - not
// the instance's share, so sizing ffmpeg work by it on a 0.5 CPU / 512 MB
// instance starts many multi-threaded encodes at once and the instance is
// killed for running out of memory. The container's cgroup limits are the
// real budget. Outside a container there are no such limits and everything
// here falls back to the old os.cpus()-based behaviour.

function read(file) {
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    return null;
  }
}

function cgroupCpuLimit() {
  const v2 = read('/sys/fs/cgroup/cpu.max'); // "50000 100000" or "max 100000"
  if (v2) {
    const [quota, period] = v2.split(/\s+/);
    return quota !== 'max' && Number(period) > 0 ? Number(quota) / Number(period) : null;
  }
  const quota = Number(read('/sys/fs/cgroup/cpu/cpu.cfs_quota_us'));
  const period = Number(read('/sys/fs/cgroup/cpu/cpu.cfs_period_us'));
  return quota > 0 && period > 0 ? quota / period : null;
}

function cgroupMemoryLimit() {
  const v2 = read('/sys/fs/cgroup/memory.max');
  if (v2) return v2 === 'max' ? null : Number(v2);
  // cgroup v1 reports a huge number when there is no limit.
  const v1 = Number(read('/sys/fs/cgroup/memory/memory.limit_in_bytes'));
  return v1 > 0 && v1 < os.totalmem() ? v1 : null;
}

const MB = 1024 * 1024;
const hostCpus = (os.cpus() || []).length || 1;
const cpuLimit = cgroupCpuLimit();
const memoryLimit = cgroupMemoryLimit();

// True when running with less than the whole machine (a container).
export const IS_LIMITED = (cpuLimit !== null && cpuLimit < hostCpus) || memoryLimit !== null;

// Cores this process can actually use (whole cores, at least 1).
export const EFFECTIVE_CPUS = IS_LIMITED
  ? Math.max(1, Math.min(hostCpus, Math.ceil(cpuLimit ?? hostCpus)))
  : hostCpus;

// How many ffmpeg encodes fit at once: one per usable core, but no more
// than memory allows at roughly 300 MB per 1080p encode (plus ~150 MB for
// Node itself).
export const MAX_PARALLEL_ENCODES = IS_LIMITED
  ? Math.max(1, Math.min(EFFECTIVE_CPUS, Math.floor(((memoryLimit ?? os.totalmem()) - 150 * MB) / (300 * MB))))
  : Math.max(2, hostCpus);

// Threads per ffmpeg process. Only capped in a container (or when
// FFMPEG_THREADS is set) - left to ffmpeg's own choice everywhere else.
const configuredThreads = Number(process.env.FFMPEG_THREADS);
export const FFMPEG_THREADS = Number.isInteger(configuredThreads) && configuredThreads > 0
  ? configuredThreads
  : IS_LIMITED ? Math.max(1, EFFECTIVE_CPUS) : null;

export function describeBudget() {
  return {
    limited: IS_LIMITED,
    hostCpus,
    cpuLimit,
    memoryLimitMB: memoryLimit ? Math.round(memoryLimit / MB) : null,
    effectiveCpus: EFFECTIVE_CPUS,
    maxParallelEncodes: MAX_PARALLEL_ENCODES,
    ffmpegThreads: FFMPEG_THREADS,
  };
}
