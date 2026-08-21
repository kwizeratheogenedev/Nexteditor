// Client-side video frame-capture for the timeline's clip filmstrip -
// extracts a handful of frames across a source's FULL duration once (an
// offscreen <video> + canvas, separate from the live playback pool so it
// never interferes with actual playback state), caches them by sourceId,
// then a clip's current trim window just picks the cached frames that fall
// inside it. Frames are cached keyed by source, not by clip, so duplicate/
// split clips sharing a source reuse the same captures instead of
// re-extracting.

const FRAME_COUNT = 12; // frames spread across the full source - enough for a filmstrip at typical clip widths without over-decoding
const THUMB_WIDTH = 96;
const THUMB_HEIGHT = 54;
const MAX_CACHED_SOURCES = 40; // LRU cap so a long session with many unique sources doesn't grow this cache unbounded

const stripCache = new Map(); // sourceId -> Promise<{ frames: [{time, dataUrl}], duration } | null>

function touchCacheEntry(key) {
  const value = stripCache.get(key);
  if (value === undefined) return;
  stripCache.delete(key);
  stripCache.set(key, value);
  if (stripCache.size > MAX_CACHED_SOURCES) {
    const oldestKey = stripCache.keys().next().value;
    stripCache.delete(oldestKey);
  }
}

function captureFrame(video, canvas, ctx) {
  ctx.drawImage(video, 0, 0, THUMB_WIDTH, THUMB_HEIGHT);
  return canvas.toDataURL('image/jpeg', 0.5);
}

function seekTo(video, time) {
  return new Promise((resolve, reject) => {
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      resolve();
    };
    const onError = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      reject(new Error('video seek failed'));
    };
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError);
    video.currentTime = time;
  });
}

async function extractStrip(clip) {
  const src = clip.file ? URL.createObjectURL(clip.file) : (clip.url || clip.remoteUrl);
  if (!src) return null;

  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.muted = true;
  video.preload = 'auto';
  video.src = src;

  const canvas = document.createElement('canvas');
  canvas.width = THUMB_WIDTH;
  canvas.height = THUMB_HEIGHT;
  const ctx = canvas.getContext('2d');

  try {
    await new Promise((resolve, reject) => {
      video.addEventListener('loadedmetadata', resolve, { once: true });
      video.addEventListener('error', () => reject(new Error('video metadata load failed')), { once: true });
    });

    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) return null;

    const frames = [];
    const count = Math.max(1, Math.min(FRAME_COUNT, Math.ceil(duration)));
    for (let i = 0; i < count; i += 1) {
      // Slightly inset from each bucket's exact edges so the very first/last
      // captured frame isn't a black pre-roll/post-roll edge frame.
      const time = Math.min(duration - 0.05, (i + 0.5) * (duration / count));
      // eslint-disable-next-line no-await-in-loop
      await seekTo(video, time);
      frames.push({ time, dataUrl: captureFrame(video, canvas, ctx) });
    }
    return { frames, duration };
  } catch {
    return null;
  } finally {
    if (clip.file) URL.revokeObjectURL(src);
  }
}

// Returns a Promise for the clip source's full-duration frame strip, cached
// by sourceId.
export function getThumbnailStripForClip(clip) {
  const key = clip.sourceId || clip.id;
  if (!stripCache.has(key)) {
    stripCache.set(key, extractStrip(clip).catch(() => null));
  }
  touchCacheEntry(key);
  return stripCache.get(key);
}

// Picks the cached frames whose capture time falls within the clip's current
// trim window - no re-extraction needed as trim changes, just a different
// slice of the same cached strip.
export function framesForTrimWindow(strip, trimmedStart, trimmedEnd) {
  if (!strip) return [];
  return strip.frames.filter((frame) => frame.time >= trimmedStart && frame.time <= trimmedEnd);
}
