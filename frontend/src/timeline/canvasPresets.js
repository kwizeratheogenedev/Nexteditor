// Aspect ratio / resolution / fps / platform preset definitions for the
// Editor tab's canvas settings (schema v4+, see usePersistedEditorState.js's
// canvasSize field). Mirrored server-side in backend/routes/exportTimeline.js
// (ALLOWED_ASPECTS/ALLOWED_LONG_EDGES/ALLOWED_FPS) - the server never trusts
// a client-sent width/height directly, only these same preset ids, so keep
// both lists in sync if a preset is ever added/removed here.

export const ASPECT_RATIOS = [
  { id: '16:9', label: 'Landscape', ratio: 16 / 9 },
  { id: '9:16', label: 'Vertical', ratio: 9 / 16 },
  { id: '1:1', label: 'Square', ratio: 1 },
  { id: '4:5', label: 'Portrait', ratio: 4 / 5 },
];

export const RESOLUTIONS = [
  { id: '720p', label: '720p', longEdge: 1280, pro: false },
  { id: '1080p', label: '1080p', longEdge: 1920, pro: false },
  { id: '4k', label: '4K', longEdge: 3840, pro: true },
];

export const FPS_OPTIONS = [24, 30, 60];

export const PLATFORM_PRESETS = [
  { id: 'tiktok-reels-shorts', label: 'TikTok / Reels / Shorts', aspectRatioId: '9:16', resolutionId: '1080p', fps: 30 },
  { id: 'youtube', label: 'YouTube', aspectRatioId: '16:9', resolutionId: '1080p', fps: 30 },
  { id: 'instagram-feed', label: 'Instagram Feed', aspectRatioId: '4:5', resolutionId: '1080p', fps: 30 },
];

// Derives real pixel {width, height} from an aspect ratio + resolution's
// long edge, always rounding to even numbers (required by yuv420p/libx264 -
// an odd dimension makes ffmpeg's encoder reject the output entirely).
export function resolveCanvasDimensions(aspectRatioId, resolutionId) {
  const aspect = ASPECT_RATIOS.find((a) => a.id === aspectRatioId) || ASPECT_RATIOS[0];
  const resolution = RESOLUTIONS.find((r) => r.id === resolutionId) || RESOLUTIONS[1];
  const toEven = (n) => Math.round(n / 2) * 2;
  if (aspect.ratio >= 1) {
    // Landscape or square: long edge is width.
    return { width: toEven(resolution.longEdge), height: toEven(resolution.longEdge / aspect.ratio) };
  }
  // Portrait/vertical: long edge is height.
  return { width: toEven(resolution.longEdge * aspect.ratio), height: toEven(resolution.longEdge) };
}

// Non-16:9 canvases default to cropping source footage to fill the frame
// (CapCut's own vertical-reformat default) rather than letterboxing it -
// matches this repo's existing extractShorts.js/reformatShort.js behavior.
export function defaultFitModeFor(aspectRatioId) {
  return aspectRatioId === '16:9' ? 'contain' : 'cover';
}

export function buildCanvasSize({ aspectRatioId, resolutionId, fps }) {
  const { width, height } = resolveCanvasDimensions(aspectRatioId, resolutionId);
  return { width, height, fps, aspectRatioId, resolutionId, fitMode: defaultFitModeFor(aspectRatioId) };
}
