import { runFFmpeg } from './ffmpeg.js';
import { logger } from './logger.js';

// Picks the fastest H.264 encoder that actually works on this machine for
// editor exports.
//
// ffmpeg lists hardware encoders it was *built* with (NVIDIA, Intel, AMD,
// Apple) even on machines without that hardware or driver, so the list alone
// means nothing - each candidate is proven with a real one-frame-burst test
// encode, in order, and the first one that succeeds wins. libx264 (the
// previous, CPU-only behavior) is always the fallback.
//
// EXPORT_ENCODER=auto (default) detects; EXPORT_ENCODER=libx264 forces the old
// CPU encoder; EXPORT_ENCODER=h264_qsv (etc.) prefers that one, still falling
// back to libx264 if it fails its test.

const SOFTWARE = 'libx264';

// Every entry returns the complete pixel-format + codec + quality arguments,
// tuned to land close to libx264 -crf 20 in visual quality. The same
// arguments are used for the detection test, so an encoder that passes
// detection is known to accept exactly what the export will send it.
const ENCODER_ARGS = {
  h264_nvenc: () => ['-pix_fmt', 'yuv420p', '-c:v', 'h264_nvenc', '-preset', 'p4', '-tune', 'hq', '-rc', 'vbr', '-cq', '21', '-b:v', '0'],
  h264_qsv: () => ['-pix_fmt', 'nv12', '-c:v', 'h264_qsv', '-preset', 'veryfast', '-global_quality', '21'],
  h264_amf: () => ['-pix_fmt', 'nv12', '-c:v', 'h264_amf', '-quality', 'balanced', '-rc', 'cqp', '-qp_i', '20', '-qp_p', '22', '-qp_b', '24'],
  h264_videotoolbox: () => ['-pix_fmt', 'nv12', '-c:v', 'h264_videotoolbox', '-q:v', '65'],
  [SOFTWARE]: () => [
    '-pix_fmt', 'yuv420p', '-c:v', SOFTWARE,
    '-preset', process.env.EXPORT_ENCODE_PRESET || 'veryfast',
    '-crf', process.env.EXPORT_CRF || '20',
  ],
};

const HARDWARE_ORDER = ['h264_nvenc', 'h264_qsv', 'h264_amf', 'h264_videotoolbox'];

export function videoEncoderArgs(name) {
  return (ENCODER_ARGS[name] || ENCODER_ARGS[SOFTWARE])();
}

function probeArgs(name) {
  return [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=1',
    ...videoEncoderArgs(name),
    '-f', 'null', '-',
  ];
}

export function createEncoderDetector({ run = runFFmpeg, log = logger, env = process.env } = {}) {
  let detection = null;
  let detected = null;

  async function works(name) {
    try {
      await run(probeArgs(name), { timeout: 20000 });
      return true;
    } catch {
      return false;
    }
  }

  async function detect() {
    const wanted = (env.EXPORT_ENCODER || 'auto').trim();
    if (wanted === SOFTWARE) return SOFTWARE;

    if (wanted !== 'auto') {
      if (!ENCODER_ARGS[wanted]) {
        log.warn('Unknown EXPORT_ENCODER, using libx264', { wanted });
        return SOFTWARE;
      }
      if (await works(wanted)) return wanted;
      log.warn('EXPORT_ENCODER failed its test encode, using libx264', { wanted });
      return SOFTWARE;
    }

    for (const name of HARDWARE_ORDER) {
      // One at a time, in preference order - they're cheap (~0.2s each).
      // eslint-disable-next-line no-await-in-loop
      if (await works(name)) return name;
    }
    return SOFTWARE;
  }

  return {
    // Resolves once per process; later calls reuse the answer.
    getVideoEncoder() {
      if (!detection) {
        detection = detect().then((name) => {
          detected = name;
          log.info('Export video encoder selected', { encoder: name });
          return name;
        });
      }
      return detection;
    },
    // Synchronous peek for /health/details - null until the first export.
    current() {
      return detected;
    },
  };
}

const defaultDetector = createEncoderDetector();
export const getVideoEncoder = () => defaultDetector.getVideoEncoder();
export const currentVideoEncoder = () => defaultDetector.current();

// Runs an encode with the detected encoder. If a hardware encoder fails
// mid-export (driver hiccup, GPU session limit reached under load), the
// export is retried once with libx264 rather than failing the user's job.
// A timeout or a cancellation is never retried - those aren't encoder faults.
export async function runWithEncoderFallback(buildArgs, options, {
  run = runFFmpeg,
  getEncoder = getVideoEncoder,
  log = logger,
} = {}) {
  const encoder = await getEncoder();
  try {
    return await run(buildArgs(videoEncoderArgs(encoder)), options);
  } catch (error) {
    const message = String(error?.message || '');
    const notEncoderFault = /timeout exceeded|cancelled/i.test(message) || options?.signal?.aborted;
    if (encoder === SOFTWARE || notEncoderFault) throw error;
    log.warn('Hardware encode failed, retrying with libx264', { encoder, err: error });
    return run(buildArgs(videoEncoderArgs(SOFTWARE)), options);
  }
}
